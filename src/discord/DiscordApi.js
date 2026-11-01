import { DiscordApiError } from './DiscordApiError.js';
import { forumNotification } from './messages/forumNotification.js';
import { createHash } from 'node:crypto';

export class DiscordApi {
  constructor(token, baseUrl = process.env.DISCORD_API_BASE_URL) {
    this.token = token;
    this.baseUrl = baseUrl?.replace(/\/$/, '');
  }
  async request(path, method = 'GET', body) {
    if (!this.baseUrl)
      throw new Error('Configure DISCORD_API_BASE_URL in the private environment.');
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${this.baseUrl}/${path}`, {
        method,
        headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return response.status === 204 ? null : response.json();
      if (response.status !== 429) {
        const details = await response.json().catch(() => ({}));
        throw new DiscordApiError(response.status, details.code);
      }
      const delay = Number((await response.json()).retry_after);
      if (!Number.isFinite(delay) || delay < 0 || delay > 30)
        throw new Error('Discord rate limit exceeded.');
      await new Promise((resolve) => setTimeout(resolve, delay * 1000 + 100));
    }
    throw new Error('Discord is temporarily unavailable.');
  }
  async validateChannel(guild, channel) {
    const target = await this.request(`channels/${channel}`);
    if (target.guild_id !== guild || ![0, 5].includes(target.type))
      throw new Error('Wybierz kanał tekstowy na tym serwerze.');
  }
  nonce(guild, id) {
    return createHash('sha256').update(`${guild}:${id}`).digest('hex').slice(0, 24);
  }
  async optional(path) {
    try {
      return await this.request(path);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }
  async currentUser() {
    this.user ||= await this.request('users/@me');
    return this.user;
  }
  async history(channel, maxPages = 100) {
    const messages = [];
    let before;
    for (let page = 0; page < maxPages; page++) {
      const batch = await this.request(
        `channels/${channel}/messages?limit=100${before ? `&before=${before}` : ''}`,
      );
      messages.push(...batch);
      if (batch.length < 100) return messages;
      const last = batch.at(-1).id;
      if (last === before) throw new Error('Discord history pagination did not advance.');
      before = last;
    }
    throw new Error('Historia kanału jest zbyt długa. Nie utworzono dodatkowego tematu.');
  }
  async publicThreads(guild, channel) {
    const active = await this.request(`guilds/${guild}/threads/active`);
    const threads = active.threads.filter(
      (thread) => thread.parent_id === channel && [10, 11].includes(thread.type),
    );
    let before;
    for (let page = 0; page < 100; page++) {
      const archived = await this.request(
        `channels/${channel}/threads/archived/public?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`,
      );
      threads.push(...archived.threads);
      if (!archived.has_more)
        return [...new Map(threads.map((thread) => [thread.id, thread])).values()];
      const next = archived.threads.at(-1)?.thread_metadata?.archive_timestamp;
      if (!next || next === before) throw new Error('Discord thread pagination did not advance.');
      before = next;
    }
    throw new Error('Lista wątków jest zbyt długa. Nie utworzono duplikatu.');
  }
  send(channel, guild, post, nonceKey = post.id) {
    const nonce = this.nonce(guild, nonceKey);
    return this.request(`channels/${channel}/messages`, 'POST', {
      ...forumNotification(post),
      nonce,
      enforce_nonce: true,
    });
  }
}
