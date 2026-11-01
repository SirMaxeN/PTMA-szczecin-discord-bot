import { ThreadNoticeCleaner } from './ThreadNoticeCleaner.js';
import { DiscordTopicIndex } from './DiscordTopicIndex.js';

export class ThreadedForumDelivery {
  constructor(database, discord, forum) {
    Object.assign(this, { database, discord, forum });
    this.noticeCleaner = new ThreadNoticeCleaner(discord);
    this.beginCheck();
  }
  beginCheck() {
    this.indexes = new Map();
    this.threads = new Map();
    this.cleanedNotices = new Set();
  }
  index(guild, channel) {
    const key = `${guild}:${channel}`;
    if (!this.indexes.has(key))
      this.indexes.set(key, new DiscordTopicIndex(this.discord, guild, channel, this.forum.root));
    return this.indexes.get(key);
  }
  async validThread(id, guild, channel) {
    const thread = await this.discord.optional(`channels/${id}`);
    if (
      thread &&
      (thread.guild_id !== guild || thread.parent_id !== channel || ![10, 11].includes(thread.type))
    )
      throw new Error('Zapisany wątek nie należy do wybranego kanału.');
    return thread;
  }
  async root(guild, channel, post) {
    if (!post.topicUrl || !post.starter?.id)
      throw new Error('Nie rozpoznano pierwszego wpisu tematu.');
    let saved = this.database.topic(guild, channel, post.topicUrl);
    if (saved?.thread) {
      const thread = await this.validThread(saved.thread, guild, channel);
      if (thread) {
        this.threads.set(thread.id, thread);
        return saved;
      }
    }
    if (saved?.message) {
      const message = await this.discord.optional(`channels/${channel}/messages/${saved.message}`);
      if (message) {
        this.database.saveTopic(guild, channel, post.topicUrl, post.starter.id, message.id, null);
        return this.database.topic(guild, channel, post.topicUrl);
      }
    }
    const index = this.index(guild, channel);
    const source = await index.starter(post.topicUrl, post.starter.id);
    const existing = await index.thread(post.topicUrl);
    if (existing) {
      const thread = await this.validThread(existing.thread.id, guild, channel);
      if (!thread) throw new Error('Wątek został usunięty podczas sprawdzania. Spróbuj ponownie.');
      this.threads.set(thread.id, thread);
      this.database.saveTopic(
        guild,
        channel,
        post.topicUrl,
        post.starter.id,
        existing.source?.id || source?.id || null,
        thread.id,
      );
    } else {
      const message =
        source ||
        (await this.discord.send(
          channel,
          guild,
          {
            ...post.starter,
            forumName: post.forumName,
            showContent: post.showContent,
            contentLimit: post.contentLimit,
          },
          `topic:${post.topicUrl}:${post.starter.id}`,
        ));
      if (!message?.id || (message.channel_id && message.channel_id !== channel))
        throw new Error('Nie potwierdzono wiadomości otwierającej temat.');
      this.database.saveTopic(guild, channel, post.topicUrl, post.starter.id, message.id);
    }
    return this.database.topic(guild, channel, post.topicUrl);
  }
  async replyTarget(guild, channel, post) {
    const root = await this.root(guild, channel, post);
    let thread = root.thread
      ? this.threads.get(root.thread) || (await this.validThread(root.thread, guild, channel))
      : null;
    if (!thread) {
      // A thread created from a message has that message's ID. This also recovers
      // an interrupted creation or a thread created manually since the last check.
      thread = await this.validThread(root.message, guild, channel);
      if (!thread) {
        try {
          thread = await this.discord.request(
            `channels/${channel}/messages/${root.message}/threads`,
            'POST',
            {
              name: Array.from(post.title.trim() || 'Odpowiedzi')
                .slice(0, 100)
                .join(''),
              auto_archive_duration: 1440,
            },
          );
        } catch (error) {
          if (error.code !== 160004) throw error;
          thread = await this.validThread(root.message, guild, channel);
          if (!thread) throw error;
        }
      }
      if (
        thread.parent_id !== channel ||
        thread.guild_id !== guild ||
        ![10, 11].includes(thread.type)
      )
        throw new Error('Nieprawidłowy wątek odpowiedzi.');
      this.database.saveTopic(
        guild,
        channel,
        post.topicUrl,
        post.starter.id,
        root.message,
        thread.id,
      );
    }
    if (thread.thread_metadata?.locked)
      throw new Error('Wątek odpowiedzi jest zablokowany. Administrator musi go odblokować.');
    if (thread.thread_metadata?.archived) {
      thread = await this.discord.request(`channels/${thread.id}`, 'PATCH', { archived: false });
    }
    if (!this.cleanedNotices.has(thread.id)) {
      try {
        await this.noticeCleaner.clean(guild, channel, thread);
        this.cleanedNotices.add(thread.id);
      } catch {
        // Cosmetic cleanup must never prevent delivery of a forum reply.
        console.error('Thread announcement cleanup failed.');
      }
    }
    this.threads.set(thread.id, thread);
    return thread.id;
  }
  async deliver(guild, channel, post) {
    let destination, message;
    if (post.isTopicStarter) {
      const root = await this.root(guild, channel, post);
      destination = channel;
      message = root.message;
    } else {
      destination = await this.replyTarget(guild, channel, post);
      const sent = await this.discord.send(
        destination,
        guild,
        post,
        `reply:${post.topicUrl}:${post.id}`,
      );
      if (!sent?.id || (sent.channel_id && sent.channel_id !== destination))
        throw new Error('Nie potwierdzono dostarczenia odpowiedzi.');
      message = sent.id;
    }
    if (message) this.database.recordMessage(guild, post.id, destination, message);
    return { channel: destination, message };
  }
}
