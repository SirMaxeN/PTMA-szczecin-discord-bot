import { randomUUID } from 'node:crypto';
import { ForumSchedule } from './ForumSchedule.js';

export class ForumMonitor {
  constructor(database, forum, discord) {
    this.database = database;
    this.forum = forum;
    this.discord = discord;
  }
  async check(guild, preview = false, automatic = false) {
    const owner = randomUUID();
    if (!this.database.acquire('forum', owner))
      throw new Error('Sprawdzanie forum już trwa. Spróbuj za chwilę.');
    try {
      const settings = this.database.settings(guild);
      if (automatic && settings?.paused) return { posts: [], sent: 0, paused: true };
      if (!settings?.channel) throw new Error('Najpierw wybierz kanał w /setup.');
      const snapshot = await this.forum.scan(settings.baseline ?? null);
      if (settings.baseline === null) {
        if (!preview) this.database.baseline(guild, snapshot.maxId);
        return { baseline: true, preview, posts: [], sent: 0 };
      }
      const posts = snapshot.posts.filter((post) => !this.database.sent(guild, post.id));
      if (preview) return { preview, posts, sent: 0 };
      let sent = 0;
      for (const post of posts) {
        const current = this.database.settings(guild);
        if (automatic && (current?.paused || !current?.channel))
          return { posts, sent, paused: true };
        if (current?.channel !== settings.channel)
          throw new Error('Zmieniono kanał powiadomień. Uruchom sprawdzanie ponownie.');
        await this.discord.send(settings.channel, guild, {
          ...post,
          forumName: this.forum.name,
          showContent: this.database.showContent(guild),
          contentLimit: this.database.contentLimit(guild),
        });
        this.database.delivered(guild, post.id, this.discord.nonce(guild, post.id));
        sent++;
      }
      this.database.checked(guild);
      return { posts, sent, preview: false };
    } catch (error) {
      if (!preview)
        this.database.checked(
          guild,
          'Sprawdzanie nie powiodło się. Zweryfikuj logowanie do forum i dostęp bota do kanału.',
        );
      throw error;
    } finally {
      this.database.release('forum', owner);
    }
  }
  async hourly(now = new Date()) {
    const owner = randomUUID();
    if (!this.database.acquire('scheduler', owner)) return;
    try {
      for (const { guild } of this.database.guilds()) {
        const due = ForumSchedule.slot(now, this.database.schedule(guild));
        if (!due) continue;
        const slot = `schedule:${guild}:${due}`;
        if (this.database.jobDone(slot)) continue;
        await this.check(guild, false, true);
        this.database.completeJob(slot);
      }
    } finally {
      this.database.release('scheduler', owner);
    }
  }
}
