import { parsePosts } from './parsing/parsePosts.js';
import { load } from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export class ForumClient {
  constructor({
    url,
    username,
    password,
    sessionPath,
    name = 'Forum',
    breadcrumbPrefix = '',
    fetcher = fetch,
  }) {
    this.root = new URL(url);
    this.name = name;
    this.breadcrumbPrefix = breadcrumbPrefix;
    this.username = username;
    this.password = password;
    this.sessionPath = sessionPath;
    this.fetcher = fetcher;
    try {
      this.jar = CookieJar.deserializeSync(JSON.parse(readFileSync(sessionPath, 'utf8')));
    } catch {
      this.jar = new CookieJar();
    }
  }
  safeUrl(value, base = this.root) {
    const url = new URL(value, base);
    if (url.origin !== this.root.origin || url.protocol !== 'https:')
      throw new Error('Unexpected forum URL.');
    return url;
  }
  async request(value, options = {}) {
    if (this.deadline && Date.now() > this.deadline)
      throw new Error('Przekroczono czas sprawdzania forum. Stan nie został zmieniony.');
    let url = this.safeUrl(value);
    let method = options.method || 'GET';
    let body = options.body;
    for (let n = 0; n < 8; n++) {
      const response = await this.fetcher(url, {
        method,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: {
          'User-Agent': 'Forum-Discord-Bot/0.1',
          Cookie: this.jar.getCookieStringSync(url.href),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
      });
      for (const cookie of response.headers.getSetCookie())
        this.jar.setCookieSync(cookie, url.href);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = this.safeUrl(response.headers.get('location'), url);
        if ([301, 302, 303].includes(response.status)) {
          method = 'GET';
          body = undefined;
        }
        await response.body?.cancel();
        url = next;
        continue;
      }
      if (!response.ok) throw new Error(`Forum HTTP error (${response.status}).`);
      const text = await response.text();
      if (text.length > 5_000_000) throw new Error('Forum page too large.');
      return { html: text, url: url.href };
    }
    throw new Error('Too many forum redirects.');
  }
  saveSession() {
    mkdirSync(dirname(this.sessionPath), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.sessionPath}.tmp`, JSON.stringify(this.jar.serializeSync()), {
      mode: 0o600,
    });
    renameSync(`${this.sessionPath}.tmp`, this.sessionPath);
  }
  async login() {
    if (!this.username || !this.password)
      throw new Error('Brak FORUM_USERNAME lub FORUM_PASSWORD w prywatnej konfiguracji.');
    const login = new URL('/wp-login.php', this.root);
    const initial = await this.request(login);
    const $ = load(initial.html);
    const form = $('#loginform');
    if (!form.length) throw new Error('Nie rozpoznano formularza logowania WordPress.');
    const data = new URLSearchParams();
    form.find('input[type="hidden"]').each((_, el) => {
      if ($(el).attr('name')) data.set($(el).attr('name'), $(el).attr('value') || '');
    });
    data.set('log', this.username);
    data.set('pwd', this.password);
    data.set('rememberme', 'forever');
    data.set('redirect_to', this.root.href);
    data.set('testcookie', '1');
    const result = await this.request(this.safeUrl(form.attr('action') || login.href), {
      method: 'POST',
      body: data.toString(),
    });
    if (!load(result.html)('#af-wrapper').length)
      throw new Error(
        'Logowanie forum nie powiodło się. Sprawdź dane lub dodatkową weryfikację logowania.',
      );
    this.saveSession();
  }
  async page(url) {
    let result = await this.request(url);
    if (
      new URL(result.url).pathname.includes('wp-login.php') ||
      load(result.html)('#loginform').length
    ) {
      await this.login();
      result = await this.request(url);
    }
    const $ = load(result.html);
    if (!$('#af-wrapper').length)
      throw new Error('Nie rozpoznano forum Asgaros; stan odczytu nie został zmieniony.');
    this.saveSession();
    return { $, url: result.url };
  }
  links($, selector, base) {
    return [
      ...new Set(
        $(selector)
          .toArray()
          .map((el) => this.safeUrl($(el).attr('href'), base).href),
      ),
    ];
  }
  async pages(start, processPage) {
    const queue = [this.safeUrl(start).href];
    const visited = new Set();
    while (queue.length) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      if (visited.size >= 250)
        throw new Error('Przekroczono limit stron forum; sprawdzanie przerwane bez zmiany stanu.');
      visited.add(url);
      const page = await this.page(url);
      processPage(page);
      // Asgaros exposes numbered pages and Next links; only follow the current listing/topic.
      for (const link of this.links(page.$, '#af-wrapper a[href*="part="]', url)) {
        const next = new URL(link);
        const current = new URL(start);
        if (
          next.pathname !== current.pathname ||
          [...next.searchParams.keys()].some((key) => key !== 'part')
        )
          continue;
        next.hash = '';
        if (!visited.has(next.href)) queue.push(next.href);
      }
    }
  }
  async scan(after = null) {
    this.deadline = Date.now() + 600000;
    try {
      return await this.scanPages(after);
    } finally {
      this.deadline = null;
    }
  }
  async scanPages(after = null) {
    const home = await this.page(this.root);
    const forums = this.links(home.$, '#af-wrapper a[href*="/forum/forum/"]', this.root);
    if (!forums.length) throw new Error('Nie znaleziono działów forum.');
    const latest = home
      .$('#af-wrapper a[href*="#postid-"]')
      .toArray()
      .map((el) =>
        Number(
          home
            .$(el)
            .attr('href')
            .match(/#postid-(\d+)/)?.[1] || 0,
        ),
      );
    // Snapshot uses IDs, not unread markers, which belong to the human user's account.
    if (after === null) {
      if (!latest.length) throw new Error('Nie znaleziono identyfikatorów postów.');
      return { maxId: Math.max(...latest), posts: [] };
    }
    const topics = new Set();
    for (const forum of forums)
      await this.pages(forum, ({ $, url }) => {
        $('#af-wrapper .topic').each((_, element) => {
          const row = $(element);
          const link = row.find('a[href*="#postid-"]').first().attr('href');
          if (!link) throw new Error('Nie rozpoznano ostatniego postu tematu.');
          const id = Number(link.match(/#postid-(\d+)/)?.[1]);
          if (id > after) {
            const topic = this.safeUrl(row.find('.topic-name > a').first().attr('href'), url);
            topic.search = '';
            topic.hash = '';
            topics.add(topic.href);
          }
        });
      });
    const posts = new Map();
    for (const topic of topics)
      await this.pages(topic, ({ $, url }) => {
        const parsed = parsePosts($, url, this.root, {
          name: this.name,
          breadcrumbPrefix: this.breadcrumbPrefix,
        });
        if (!parsed.length) throw new Error('Nie rozpoznano postów w temacie.');
        for (const post of parsed) if (post.id > after) posts.set(post.id, post);
      });
    return {
      maxId: Math.max(after, ...posts.keys()),
      posts: [...posts.values()].sort((a, b) => a.id - b.id),
    };
  }
}
