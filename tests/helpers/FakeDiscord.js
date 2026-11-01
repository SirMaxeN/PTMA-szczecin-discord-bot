import { DiscordApi } from '../../src/discord/DiscordApi.js';
import { DiscordApiError } from '../../src/discord/DiscordApiError.js';

export class FakeDiscord extends DiscordApi {
  constructor() {
    super('unused');
    this.messages = new Map();
    this.threadChannels = new Map();
    this.calls = [];
    this.sequence = 0;
  }
  async request(path, method = 'GET', body) {
    this.calls.push({ path, method, body: structuredClone(body) });
    return structuredClone(await this.route(path, method, body));
  }
  async route(path, method, body) {
    if (path === 'users/@me') return { id: 'bot' };
    if (path.includes('/threads/active'))
      return {
        threads: [...this.threadChannels.values()].filter((t) => !t.thread_metadata.archived),
      };
    if (path.includes('/threads/archived/public'))
      return {
        threads: [...this.threadChannels.values()].filter(
          (t) => t.parent_id === path.split('/')[1] && t.thread_metadata.archived,
        ),
        has_more: false,
      };
    const start = path.match(/^channels\/([^/]+)\/messages\/([^/]+)\/threads$/);
    if (start && method === 'POST') {
      if (this.failCreate) throw new DiscordApiError(403, 50013);
      const [, parent, id] = start;
      const source = this.messages.get(id);
      if (!source || source.channel_id !== parent) throw new DiscordApiError(404);
      if (this.threadChannels.has(id)) throw new DiscordApiError(400, 160004);
      const thread = {
        id,
        guild_id: 'g',
        parent_id: parent,
        type: 11,
        name: body.name,
        thread_metadata: { archived: false, locked: false },
      };
      source.thread = { id };
      this.threadChannels.set(id, thread);
      return thread;
    }
    const message = path.match(/^channels\/([^/]+)\/messages\/([^/?]+)$/);
    if (message) {
      const [, channel, id] = message;
      const item = this.messages.get(id);
      if (!item || item.channel_id !== channel) throw new DiscordApiError(404);
      if (method === 'DELETE') {
        if (this.failDelete) {
          this.failDelete = false;
          throw new DiscordApiError(500);
        }
        this.messages.delete(id);
        return null;
      }
      if (this.corruptCopy && this.threadChannels.has(channel))
        return { ...item, content: 'changed' };
      return item;
    }
    const messages = path.match(/^channels\/([^/]+)\/messages(?:\?(.*))?$/);
    if (messages) {
      const channel = messages[1];
      if (method === 'POST') {
        const duplicate = [...this.messages.values()].find(
          (m) => m.channel_id === channel && m.nonce === body.nonce,
        );
        if (duplicate) return duplicate;
        const item = {
          ...body,
          id: `m${++this.sequence}`,
          author: { id: 'bot' },
          channel_id: channel,
          type: 0,
          attachments: [],
          components: [],
        };
        this.messages.set(item.id, item);
        return item;
      }
      let items = [...this.messages.values()].filter((m) => m.channel_id === channel).reverse();
      const query = new URLSearchParams(messages[2]);
      if (query.has('before'))
        items = items.slice(items.findIndex((m) => m.id === query.get('before')) + 1);
      return items.slice(0, Number(query.get('limit') || 100));
    }
    const channel = path.match(/^channels\/([^/]+)$/);
    if (channel) {
      const thread = this.threadChannels.get(channel[1]);
      if (!thread) throw new DiscordApiError(404);
      if (method === 'PATCH') Object.assign(thread.thread_metadata, body);
      return thread;
    }
    throw new Error(`Unhandled fake API route: ${method} ${path}`);
  }
}
