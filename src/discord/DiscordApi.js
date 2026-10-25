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
      if (response.status !== 429) throw new Error(`Discord API error (${response.status}).`);
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
  send(channel, guild, post) {
    const nonce = this.nonce(guild, post.id);
    return this.request(`channels/${channel}/messages`, 'POST', {
      ...forumNotification(post),
      nonce,
      enforce_nonce: true,
    });
  }
}
