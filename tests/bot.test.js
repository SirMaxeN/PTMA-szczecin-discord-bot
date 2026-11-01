import { forumNotification } from '../src/discord/messages/forumNotification.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { load } from 'cheerio';
import { Database } from '../src/storage/Database.js';
import { ForumMonitor } from '../src/forum/ForumMonitor.js';
import { ForumClient } from '../src/forum/ForumClient.js';
import { parsePostDate } from '../src/forum/parsing/parsePostDate.js';
import { parsePosts } from '../src/forum/parsing/parsePosts.js';
import { ForumFetchCommand } from '../src/discord/commands/ForumFetchCommand.js';
import { Commands } from '../src/discord/Commands.js';
import { InteractionServer } from '../src/http/InteractionServer.js';
import { ForumSchedule } from '../src/forum/ForumSchedule.js';
import { DiscordApi } from '../src/discord/DiscordApi.js';

// Monitor tests isolate scanning/deduplication from Discord thread routing,
// which has its own integration tests in threads.test.js.
function createMonitor(database, forum, discord) {
  return new ForumMonitor(database, forum, discord, {
    beginCheck() {},
    deliver: (guild, channel, post) => discord.send(channel, guild, post),
  });
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'forum-test-'));
  const db = new Database(join(dir, 'test.sqlite'));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}
const post = (id) => ({
  id,
  title: 'Nowy temat',
  author: 'Jan',
  url: `https://example.org/forum/topic/test/#postid-${id}`,
});

test('post text keeps image markers and excludes hidden quote copies', () => {
  const $ = load(
    '<div id="af-wrapper"><h1 class="main-title-topic">Zdjęcia</h1><div class="post-element" id="postid-42"><div class="post-author-block-name"><a class="profile-link">Anna</a></div><div class="forum-post-date"><a href="#postid-42">#1</a></div><div class="post-message"><div id="post-quote-container-42" style="display: none">Hidden<img src="secret.jpg"></div><p>Niebo<img src="sky.jpg"></p></div></div></div>',
  );
  const [parsed] = parsePosts($, 'https://example.org/forum/topic/test/', 'https://example.org');
  assert.match(parsed.content, /Niebo.*\[zdjęcie\]/s);
  assert.doesNotMatch(parsed.content, /Hidden|secret/);
});

test('notification content is opt-in and keeps section and direct post link', async (t) => {
  const db = fixture(t);
  assert.equal(db.showContent('1'), false);
  const commands = new Commands(db, {}, {}, '1');
  const i = {
    type: 3,
    guild_id: '1',
    member: { user: { id: '9' }, permissions: '8' },
    data: { custom_id: 'setup:9:content-on' },
  };
  await commands.handle(i);
  assert.equal(db.showContent('1'), true);
  const api = new DiscordApi('unused');
  let payload;
  api.request = async (_, __, data) => {
    payload = data;
  };
  const item = {
    ...post(101),
    forum: 'Spotkania',
    content: 'Niebo [zdjęcie]',
    publishedAt: '24.10.2026, 00:04',
  };
  await api.send('2', '1', item);
  assert.doesNotMatch(payload.embeds[0].description, /Niebo/);
  await api.send('2', '1', { ...item, showContent: true });
  assert.match(payload.embeds[0].description, /Spotkania/);
  assert.match(payload.embeds[0].description, /zdjęcie/);
  assert.equal(payload.embeds[0].url, item.url);
  assert.match(payload.embeds[0].description, /Dział:/);
  assert.doesNotMatch(payload.embeds[0].description, /Przejd|https:/);
  assert.equal(payload.embeds[0].footer.text, 'Forum · 24.10.2026, 00:04');
  i.data.custom_id = 'setup:9:content-off';
  await commands.handle(i);
  assert.equal(db.showContent('1'), false);
});

test('custom schedules cover intervals, overnight windows and saved UI selections', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  const commands = new Commands(db, {}, {}, '1');
  const i = {
    type: 3,
    guild_id: '1',
    member: { user: { id: '9' }, permissions: '8' },
    data: { custom_id: 'setup:9:interval', values: ['30'] },
  };
  assert.equal((await commands.handle(i)).type, 7);
  assert.equal(db.schedule('1').interval, 30);
  const now = (time) => new Date(`2026-07-15T${time}:00Z`);
  const half = { start: 10, end: 22, interval: 30 };
  assert.equal(ForumSchedule.slot(now('08:29'), half), ForumSchedule.slot(now('08:00'), half));
  assert.notEqual(ForumSchedule.slot(now('08:30'), half), ForumSchedule.slot(now('08:00'), half));
  for (const interval of [60, 120, 240]) {
    const s = { ...half, interval };
    assert.equal(ForumSchedule.slot(now('08:59'), s), ForumSchedule.slot(now('08:00'), s));
  }
  const night = { start: 22, end: 6, interval: 120 };
  assert.ok(ForumSchedule.slot(now('21:00'), night));
  assert.equal(ForumSchedule.slot(now('10:00'), night), null);
  assert.throws(() => db.setSchedule('1', 'interval', 90));
  assert.throws(() => db.setSchedule('1', 'end', 24));
  let scans = 0;
  const monitor = createMonitor(
    db,
    {
      scan: async () => {
        scans++;
        return { maxId: 10, posts: [] };
      },
    },
    {},
  );
  await monitor.hourly(now('08:00'));
  await monitor.hourly(now('08:01'));
  await monitor.hourly(now('08:30'));
  assert.equal(scans, 2);
});

test('all commands require administrator or configured role; only admins can delegate access', async (t) => {
  const db = fixture(t);
  const commands = new Commands(db, {}, {}, '1');
  const i = {
    type: 2,
    guild_id: '1',
    member: { user: { id: '9' }, permissions: '8192', roles: ['20'] },
    data: { name: 'setup' },
  };
  assert.match((await commands.handle(i)).data.content, /administrator/);
  i.member.permissions = '8';
  i.type = 3;
  i.data = { custom_id: 'setup:9:roles', values: ['20'] };
  assert.equal((await commands.handle(i)).type, 7);
  assert.deepEqual(db.commandRoles('1'), ['20']);
  i.member.permissions = '0';
  i.type = 2;
  i.data = { name: 'setup' };
  assert.match((await commands.handle(i)).data.content, /Ustawienia/);
  i.type = 3;
  i.data = { custom_id: 'setup:9:roles', values: ['30'] };
  assert.match((await commands.handle(i)).data.content, /Tylko administrator/);
  assert.deepEqual(db.commandRoles('1'), ['20']);
  db.setCommandRoles('1', []);
  i.data = { custom_id: 'setup:9:forum' };
  assert.match((await commands.handle(i)).data.content, /administrator/);
  i.type = 2;
  i.data = { name: 'forum', options: [{ name: 'fetch' }] };
  assert.match((await commands.handle(i)).data.content, /administrator/);
});

test('empty manual checks and previews return a private completion message', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  db.baseline('1', 100);
  const commands = new Commands(db, { check: async () => ({ posts: [], sent: 0 }) }, {}, '1');
  const i = { guild_id: '1', member: { user: { id: '9' }, permissions: '8' } };
  for (const preview of [false, true]) {
    const deferred = new ForumFetchCommand(db, {
      check: async () => ({ posts: [], sent: 0 }),
    }).execute(i, preview);
    assert.equal(deferred.response.data.flags, 64);
    assert.equal((await deferred.complete()).content, 'Brak nowych postów na forum.');
  }
});

test('setup menu opens forum settings; pause persists, manual checks work and clear preserves history', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  db.baseline('1', 100);
  let scans = 0;
  const monitor = createMonitor(
    db,
    {
      scan: async () => {
        scans++;
        return { maxId: 100, posts: [] };
      },
    },
    {},
  );
  const commands = new Commands(db, monitor, {}, '1');
  const i = {
    type: 2,
    guild_id: '1',
    member: { user: { id: '9' }, permissions: '8' },
    data: { name: 'setup' },
  };
  const menu = await commands.handle(i);
  assert.equal(menu.data.components[0].components[0].label, 'Forum fetch');
  i.type = 3;
  i.data = { custom_id: 'setup:9:forum' };
  assert.match((await commands.handle(i)).data.content, /10:00/);
  i.data.custom_id = 'setup:9:pause';
  await commands.handle(i);
  assert.equal(db.settings('1').paused, 1);
  await monitor.hourly(new Date('2026-10-23T12:00:00Z'));
  assert.equal(scans, 0);
  await monitor.check('1', true);
  assert.equal(scans, 1);
  i.data.custom_id = 'setup:9:resume';
  await commands.handle(i);
  await monitor.hourly(new Date('2026-10-23T13:00:00Z'));
  assert.equal(scans, 2);
  i.data.custom_id = 'setup:9:clear';
  await commands.handle(i);
  assert.equal(db.settings('1').channel, null);
  assert.equal(db.settings('1').baseline, 100);
  await monitor.hourly(new Date('2026-10-23T14:00:00Z'));
  assert.equal(scans, 2);
});

test('pausing during an automatic scan prevents delivery', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  db.baseline('1', 100);
  let sends = 0;
  const monitor = createMonitor(
    db,
    {
      scan: async () => {
        db.pause('1', true);
        return { maxId: 101, posts: [post(101)] };
      },
    },
    {
      send: async () => {
        sends++;
      },
    },
  );
  await monitor.check('1', false, true);
  assert.equal(sends, 0);
  assert.equal(db.sent('1', 101), false);
});

test('baseline suppresses archive; preview never consumes posts; sends only once', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  let snapshot = { maxId: 100, posts: [] };
  const sent = [];
  const monitor = createMonitor(
    db,
    { scan: async () => snapshot },
    { send: async (_, __, p) => sent.push(p.id), nonce: () => 'nonce' },
  );
  await monitor.check('1', true);
  assert.equal(db.settings('1').baseline, null);
  await monitor.check('1');
  assert.equal(db.settings('1').baseline, 100);
  assert.deepEqual(sent, []);
  snapshot = { maxId: 102, posts: [post(101), post(102)] };
  assert.equal((await monitor.check('1', true)).posts.length, 2);
  assert.deepEqual(sent, []);
  await monitor.check('1');
  await monitor.check('1');
  assert.deepEqual(sent, [101, 102]);
  db.configure('3', '4');
  await monitor.check('3');
  assert.equal(db.settings('3').baseline, 102);
});
test('partial delivery retains retry for unsent posts', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  db.baseline('1', 100);
  let fail = true;
  const sent = [];
  const monitor = createMonitor(
    db,
    { scan: async () => ({ posts: [post(101), post(102)], maxId: 102 }) },
    {
      nonce: () => 'nonce',
      send: async (_, __, p) => {
        if (p.id === 102 && fail) throw Error('HTTP');
        sent.push(p.id);
      },
    },
  );
  await assert.rejects(() => monitor.check('1'));
  fail = false;
  await monitor.check('1');
  assert.deepEqual(sent, [101, 102]);
});
test('database locks exclude overlapping processes and hourly cron is idempotent', async (t) => {
  const db = fixture(t);
  assert.equal(db.acquire('forum', 'a'), true);
  assert.equal(db.acquire('forum', 'b'), false);
  db.release('forum', 'b');
  assert.equal(db.acquire('forum', 'c'), false);
  db.release('forum', 'a');
  db.configure('1', '2');
  let scans = 0;
  const monitor = createMonitor(
    db,
    {
      scan: async () => {
        scans++;
        return { maxId: 10, posts: [] };
      },
    },
    {},
  );
  await monitor.hourly(new Date('2026-10-25T09:00:00Z'));
  await monitor.hourly(new Date('2026-10-25T09:01:00Z'));
  await monitor.hourly(new Date('2026-10-25T10:00:00Z'));
  assert.equal(scans, 2);
});
test('moderator permissions are checked on slash commands and components', async (t) => {
  const commands = new Commands(fixture(t), {}, {}, '1');
  const i = {
    type: 2,
    guild_id: '1',
    member: { user: { id: '9' }, permissions: '0' },
    data: { name: 'setup' },
  };
  assert.match((await commands.handle(i)).data.content, /administrator/);
  i.member.permissions = '8';
  assert.match((await commands.handle(i)).data.content, /Forum Bot/);
  i.type = 3;
  i.data = { custom_id: 'setup:8:fetch' };
  assert.match((await commands.handle(i)).data.content, /własny/);
  i.member.permissions = '0';
  i.data.custom_id = 'setup:9:fetch';
  assert.match((await commands.handle(i)).data.content, /administrator/);
});
test('Asgaros parser returns individual reply authors and canonical post links', () => {
  const $ = load(
    `<div id="af-wrapper"><h1 class="main-title-topic">Temat &amp; obserwacje</h1><div class="post-element" id="postid-42"><div class="post-author-block-name"><a class="profile-link">Anna</a></div><div class="forum-post-date"><a href="/forum/topic/test/?part=2#postid-42">#2</a></div></div></div>`,
  );
  $('#af-wrapper').prepend(
    '<div id="forum-breadcrumbs"><span><a href="/forum/forum/spotkania/">Spotkania</a></span></div>',
  );
  assert.deepEqual(parsePosts($, 'https://example.org/forum/topic/test/', 'https://example.org'), [
    {
      id: 42,
      title: 'Temat & obserwacje',
      forum: 'Spotkania',
      content: '',
      author: 'Anna',
      url: 'https://example.org/forum/topic/test/?part=2#postid-42',
    },
  ]);
});
test('crawler follows topic/list pagination and finds every new reply', async () => {
  const forum = new ForumClient({ url: 'https://example.org/forum/', sessionPath: 'missing' });
  const pages = {
    '/forum/': '<a href="/forum/forum/one/">One</a><a href="/forum/topic/t/#postid-12">Latest</a>',
    '/forum/forum/one/':
      '<div class="topic"><div class="topic-name"><a href="/forum/topic/t/">T</a></div><a href="/forum/topic/t/?part=2#postid-12">Latest</a></div>',
    '/forum/topic/t/':
      '<h1 class="main-title-topic">T</h1><div class="post-element" id="postid-11"><div class="post-author-block-name"><a class="profile-link">A</a></div><div class="forum-post-date"><a href="/forum/topic/t/#postid-11">#1</a></div></div><a href="?part=2">Next</a>',
    '/forum/topic/t/?part=2':
      '<h1 class="main-title-topic">T</h1><div class="post-element" id="postid-12"><div class="post-author-block-name"><a class="profile-link">B</a></div><div class="forum-post-date"><a href="/forum/topic/t/?part=2#postid-12">#2</a></div></div>',
  };
  forum.page = async (value) => {
    const url = new URL(value);
    const html = pages[url.pathname + url.search];
    assert.ok(html, url.href);
    return { $: load(`<div id="af-wrapper">${html}</div>`), url: url.href };
  };
  assert.deepEqual(
    (await forum.scan(10)).posts.map((p) => p.id),
    [11, 12],
  );
  const replies = (await forum.scan(11)).posts;
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 12);
  assert.equal(replies[0].isTopicStarter, false);
  assert.equal(replies[0].starter.id, 11);
  assert.equal(replies[0].topicUrl, 'https://example.org/forum/topic/t/');
  assert.throws(() => forum.safeUrl('https://attacker.test/'), /Unexpected/);
});
test('HTTP interactions reject invalid signatures and accept signed PING', async (t) => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const server = new InteractionServer(key, '123', {});
  await server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.server.address().port}/interactions`;
  const body = JSON.stringify({ type: 1 });
  assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
  const response = await fetch(url, {
    method: 'POST',
    body,
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp },
  });
  assert.deepEqual(await response.json(), { type: 1 });
});

test('automatic checks respect Warsaw 10 through 22 in summer and winter; manual fetch remains available', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  let scans = 0;
  const monitor = createMonitor(
    db,
    {
      scan: async () => {
        scans++;
        return { maxId: 10, posts: [] };
      },
    },
    {},
  );
  for (const [day, offset] of [
    ['2026-07-15', 2],
    ['2026-12-15', 1],
  ]) {
    for (const localHour of [0, 9, 10, 21, 22, 23]) {
      const now = new Date(`${day}T00:00:00Z`);
      now.setUTCHours(localHour - offset);
      const before = scans;
      await monitor.hourly(now);
      assert.equal(scans - before, localHour >= 10 && localHour <= 22 ? 1 : 0);
    }
  }
  const before = scans;
  await monitor.check('1', true);
  assert.equal(scans, before + 1);
});

test('fetch and preview explain missing channel without starting deferred work', async (t) => {
  const db = fixture(t);
  let checks = 0;
  const commands = new Commands(
    db,
    {
      check: async () => {
        checks++;
      },
    },
    {},
    '1',
  );
  const i = {
    type: 2,
    guild_id: '1',
    member: { user: { id: '9' }, permissions: '8' },
    data: { name: 'forum', options: [{ name: 'fetch' }] },
  };
  const result = await commands.handle(i);
  assert.equal(result.type, 4);
  assert.match(result.data.content, /\/setup/);
  i.type = 3;
  i.data = { custom_id: 'setup:9:preview' };
  assert.equal((await commands.handle(i)).type, 4);
  assert.equal(checks, 0);
});

test('registry routes slash fetch and rejects unknown commands without fetching', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  let checks = 0;
  const commands = new Commands(
    db,
    {
      check: async () => {
        checks++;
        return { posts: [], sent: 0 };
      },
    },
    {},
    '1',
  );
  const i = {
    type: 2,
    guild_id: '1',
    member: { user: { id: '9' }, permissions: '8' },
    data: { name: 'forum', options: [{ type: 1, name: 'fetch' }] },
  };
  const result = await commands.handle(i);
  assert.equal(result.response.data.flags, 64);
  await result.complete();
  assert.equal(checks, 1);
  i.data.options[0].name = 'unknown';
  assert.match((await commands.handle(i)).data.content, /Nieznane/);
  i.data = { name: 'unknown' };
  assert.match((await commands.handle(i)).data.content, /Nieznane/);
  i.guild_id = 'other';
  assert.match((await commands.handle(i)).data.content, /skonfigurowanym serwerze/);
  assert.equal(checks, 1);
});

test('schedule starts on the clock and always checks the closing hour once', async (t) => {
  // Fixed Warsaw summer offset makes the expected local times explicit.
  const now = (time) => new Date(`2026-07-15T${time}:00+02:00`);
  const slot = (time, settings) => ForumSchedule.slot(now(time), settings);
  for (const [interval, times] of [
    [
      30,
      [
        '11:00',
        '11:30',
        '12:00',
        '12:30',
        '13:00',
        '13:30',
        '14:00',
        '14:30',
        '15:00',
        '15:30',
        '16:00',
      ],
    ],
    [60, ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00']],
    [120, ['11:00', '13:00', '15:00', '16:00']],
    [240, ['11:00', '15:00', '16:00']],
  ]) {
    const settings = { start: 11, end: 16, interval };
    assert.equal(slot('10:59', settings), null);
    const actual = [];
    let previous;
    for (let minute = 11 * 60; minute <= 16 * 60; minute++) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const current = slot(time, settings);
      if (current !== previous) actual.push(time);
      previous = current;
    }
    assert.deepEqual(actual, times);
    assert.equal(slot('16:01', settings), null);
  }
  const overnight = { start: 23, end: 2, interval: 240 };
  assert.notEqual(slot('23:00', overnight), slot('02:00', overnight));
  assert.ok(slot('02:00', overnight));
  assert.equal(slot('02:01', overnight), null);

  const db = fixture(t);
  db.configure('1', '2');
  db.baseline('1', 100);
  db.setSchedule('1', 'start', 11);
  db.setSchedule('1', 'end', 16);
  db.setSchedule('1', 'interval', 240);
  let scans = 0;
  const monitor = createMonitor(
    db,
    {
      scan: async () => {
        scans++;
        return { maxId: 100, posts: [] };
      },
    },
    {},
  );
  for (const time of ['11:00', '11:17', '15:00', '15:59', '16:00', '16:00', '16:01'])
    await monitor.hourly(now(time));
  assert.equal(scans, 3);
});

test('deleted authors in older replies do not prevent parsing new posts', () => {
  const $ = load(`<div id="af-wrapper"><h1 class="main-title-topic">Test</h1>
    <div class="post-element" id="postid-1"><div class="post-author-block-name">Usunięty użytkownik</div><div class="forum-post-date"><a href="#postid-1">1</a></div><div class="post-message">Stary wpis</div></div>
    <div class="post-element" id="postid-2"><div class="post-author-block-name"><a class="profile-link">Jan</a><span class="mention-nice-name">@jan</span></div><div class="forum-post-date"><a href="#postid-2">2</a></div><div class="post-message">Nowy wpis</div></div></div>`);
  const posts = parsePosts($, 'https://example.org/forum/topic/test/', 'https://example.org');
  assert.deepEqual(
    posts.map((post) => post.author),
    ['Usunięty użytkownik', 'Jan'],
  );
  assert.equal(posts[1].content, 'Nowy wpis');
  $('.post-author-block-name').first().empty();
  assert.throws(
    () => parsePosts($, 'https://example.org/forum/topic/test/', 'https://example.org'),
    /Niekompletne/,
  );
});

test('forum publication dates preserve the forum time and convert AM/PM', () => {
  for (const [input, expected] of [
    ['2026-10-24, 12:04 am', '24.10.2026, 00:04'],
    ['2026-10-24, 12:04 pm', '24.10.2026, 12:04'],
    ['2026-04-27, 4:36 pm', '27.04.2026, 16:36'],
    ['2026-10-24, 23:04', '24.10.2026, 23:04'],
  ]) {
    const $ = load(`<div class="forum-post-date"><a href="#postid-1">#1</a> · ${input}</div>`);
    assert.equal(parsePostDate($('.forum-post-date')), expected);
  }
  const $ = load('<div class="forum-post-date"><a>#1</a></div>');
  assert.equal(parsePostDate($('.forum-post-date')), null);
});

test('content configuration saves limits, preserves toggle state and controls delivered excerpts', async (t) => {
  const db = fixture(t);
  db.configure('1', '2');
  db.baseline('1', 10);
  assert.equal(db.contentLimit('1'), 500);
  const commands = new Commands(db, {}, {}, '1');
  const i = {
    type: 3,
    guild_id: '1',
    member: { user: { id: '9' }, permissions: '8' },
    data: { custom_id: 'setup:9:content' },
  };
  const panel = await commands.handle(i);
  assert.equal(panel.data.flags, 64);
  const options = panel.data.components[1].components[0].options;
  assert.equal(options.length, 15);
  assert.equal(options.find((option) => option.default).value, '500');
  i.data = { custom_id: 'setup:9:content-limit', values: ['100'] };
  assert.equal((await commands.handle(i)).type, 7);
  assert.equal(db.contentLimit('1'), 100);
  assert.equal(db.showContent('1'), false);
  i.data = { custom_id: 'setup:9:content-on' };
  await commands.handle(i);
  assert.equal(db.contentLimit('1'), 100);
  let payload;
  const discord = new DiscordApi('unused');
  discord.request = async (_, __, body) => {
    payload = body;
  };
  const monitor = createMonitor(
    db,
    { scan: async () => ({ maxId: 11, posts: [{ ...post(11), content: 'a'.repeat(2000) }] }) },
    discord,
  );
  await monitor.check('1');
  assert.equal(payload.embeds[0].description.split('\n\n')[1], 'a'.repeat(99) + '…');
  for (const limit of [100, 500, 1500]) {
    const excerpt = forumNotification({
      ...post(12),
      content: 'a'.repeat(2000),
      showContent: true,
      contentLimit: limit,
    }).embeds[0].description.split('\n\n')[1];
    assert.equal(excerpt.length, limit);
  }
  for (const invalid of [0, 99, 150, 1600, NaN])
    assert.throws(() => db.setContentLimit('1', invalid));
  assert.equal(db.contentLimit('1'), 100);
});

test('content limit upgrade preserves existing preferences and survives reopening', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-upgrade-'));
  const path = join(dir, 'state.sqlite');
  let db = new Database(path);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.configure('1', '2');
  db.baseline('1', 1133);
  db.setShowContent('1', true);
  db.db.exec('ALTER TABLE notification_options DROP COLUMN content_limit');
  db.close();
  db = new Database(path);
  assert.equal(db.showContent('1'), true);
  assert.equal(db.contentLimit('1'), 500);
  assert.equal(db.settings('1').baseline, 1133);
  db.setContentLimit('1', 1500);
  db.setShowContent('1', false);
  db.close();
  db = new Database(path);
  assert.equal(db.contentLimit('1'), 1500);
  assert.equal(db.showContent('1'), false);
});

test('installation labels come from configuration rather than a built-in forum identity', () => {
  const $ = load(
    `<div id="af-wrapper"><h1 class="main-title-topic">Test</h1><div id="forum-breadcrumbs"><a href="/forum/forum/meetings/">Example Community: Spotkania</a></div><div class="post-element" id="postid-42"><div class="post-author-block-name">Jan</div><div class="forum-post-date"><a href="#postid-42">#1</a> · 2026-10-25, 4:00 pm</div></div></div>`,
  );
  const [post] = parsePosts($, 'https://example.org/forum/topic/test/', 'https://example.org', {
    name: 'Example Community',
    breadcrumbPrefix: 'Example Community:',
  });
  assert.equal(post.forum, 'Spotkania');
  assert.equal(
    forumNotification({ ...post, forumName: 'Example Community' }).embeds[0].footer.text,
    'Example Community · 25.10.2026, 16:00',
  );
});
