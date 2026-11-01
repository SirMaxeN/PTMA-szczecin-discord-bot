import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/storage/Database.js';
import { ForumMonitor } from '../src/forum/ForumMonitor.js';
import { ThreadedForumDelivery } from '../src/discord/ThreadedForumDelivery.js';
import { FakeDiscord } from './helpers/FakeDiscord.js';

const base = 'https://example.org/forum/';
function posts(slug = 'one', id = 10) {
  const topicUrl = `${base}topic/${slug}/`;
  const starter = {
    id,
    title: 'Taki sam tytuł',
    author: 'Anna',
    content: 'Pierwszy wpis',
    url: `${topicUrl}#postid-${id}`,
    topicUrl,
    isTopicStarter: true,
  };
  return [
    { ...starter, starter },
    ...[1, 2].map((offset) => ({
      ...starter,
      id: id + offset,
      content: 'Odpowiedź',
      url: `${topicUrl}#postid-${id + offset}`,
      isTopicStarter: false,
      starter,
    })),
  ];
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'forum-threads-'));
  const database = new Database(join(dir, 'test.sqlite'));
  t.after(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  });
  database.configure('g', 'c');
  database.baseline('g', 1);
  const discord = new FakeDiscord();
  const forum = {
    root: new URL(base),
    name: 'Przykładowe forum',
    readTopic: async (topicUrl) => {
      const items = topicUrl.includes('/two/') ? posts('two', 20) : posts();
      return { topicUrl, starter: items[0].starter, posts: items };
    },
  };
  const delivery = new ThreadedForumDelivery(database, discord, forum);
  return { database, discord, forum, delivery };
}

test('a starter stays on the channel; only the first reply creates a thread', async (t) => {
  const { database, discord, forum, delivery } = fixture(t);
  const items = posts();
  await delivery.deliver('g', 'c', items[0]);
  assert.equal(discord.messages.size, 1);
  assert.equal(discord.threadChannels.size, 0);
  await delivery.deliver('g', 'c', items[1]);
  await delivery.deliver('g', 'c', items[2]);
  assert.equal(discord.threadChannels.size, 1);
  assert.deepEqual(
    [...discord.messages.values()].map((m) => m.channel_id),
    ['c', 'm1', 'm1'],
  );
  assert.equal(database.messageLocation('g', 12).channel, 'm1');
  const restarted = new ThreadedForumDelivery(database, discord, forum);
  await restarted.deliver('g', 'c', items[2]);
  assert.equal(discord.messages.size, 3);
  assert.equal(discord.threadChannels.size, 1);
});

test('first reply to an older forum topic creates an anchor and a single thread', async (t) => {
  const { database, discord, delivery } = fixture(t);
  await delivery.deliver('g', 'c', posts()[1]);
  assert.equal([...discord.messages.values()][0].embeds[0].url, posts()[0].url);
  assert.equal(database.topic('g', 'c', posts()[1].topicUrl).starter_post, '10');
  assert.equal(discord.threadChannels.size, 1);
});

test('existing notification and archived thread are reused by URL, despite title changes', async (t) => {
  const { database, discord, delivery } = fixture(t);
  const [starter, reply] = posts();
  const root = await discord.send('c', 'g', starter);
  const thread = await discord.request(`channels/c/messages/${root.id}/threads`, 'POST', {
    name: 'Dawny tytuł',
  });
  discord.threadChannels.get(thread.id).thread_metadata.archived = true;
  await delivery.deliver('g', 'c', { ...reply, title: 'Nowy tytuł' });
  assert.equal(discord.messages.size, 2);
  assert.equal(discord.threadChannels.size, 1);
  assert.equal(discord.threadChannels.get(thread.id).thread_metadata.archived, false);
  assert.equal(database.topic('g', 'c', starter.topicUrl).thread, thread.id);
});

test('identical titles in separate forum topics never merge threads', async (t) => {
  const { discord, delivery } = fixture(t);
  await delivery.deliver('g', 'c', posts()[1]);
  await delivery.deliver('g', 'c', posts('two', 20)[1]);
  assert.equal(discord.threadChannels.size, 2);
});

test('switching destination channel creates a separate topic mapping', async (t) => {
  const { database, discord, delivery } = fixture(t);
  await delivery.deliver('g', 'c', posts()[1]);
  await delivery.deliver('g', 'c2', posts()[2]);
  assert.equal(discord.threadChannels.size, 2);
  assert.notEqual(
    database.topic('g', 'c', posts()[0].topicUrl).thread,
    database.topic('g', 'c2', posts()[0].topicUrl).thread,
  );
});

test('locked thread blocks delivery without unlocking it or marking the reply sent', async (t) => {
  const { database, discord, forum, delivery } = fixture(t);
  await delivery.deliver('g', 'c', posts()[0]);
  const thread = await discord.request('channels/c/messages/m1/threads', 'POST', {
    name: 'Locked',
  });
  discord.threadChannels.get(thread.id).thread_metadata.locked = true;
  forum.scan = async () => ({ maxId: 11, posts: [posts()[1]] });
  const monitor = new ForumMonitor(database, forum, discord, delivery);
  await assert.rejects(monitor.check('g'), /zablokowany/);
  assert.equal(database.sent('g', 11), false);
  assert.equal(discord.messages.size, 1);
  assert.equal(discord.threadChannels.get(thread.id).thread_metadata.locked, true);
});

test('failed thread creation leaves starter reusable for the next attempt', async (t) => {
  const { discord, delivery } = fixture(t);
  discord.failCreate = true;
  await assert.rejects(delivery.deliver('g', 'c', posts()[1]), /403/);
  assert.equal(discord.messages.size, 1);
  discord.failCreate = false;
  await delivery.deliver('g', 'c', posts()[1]);
  assert.equal(discord.messages.size, 2);
});
