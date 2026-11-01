import { forumMessageReference } from '../forum/parsing/topicIdentity.js';

/** Recovers existing links by forum URL, never by a potentially duplicate title. */
export class DiscordTopicIndex {
  constructor(discord, guild, channel, forumRoot) {
    Object.assign(this, { discord, guild, channel, forumRoot });
  }
  async load() {
    if (this.messages) return;
    this.bot = await this.discord.currentUser();
    this.messages = await this.discord.history(this.channel);
  }
  async starter(topicUrl, starterId) {
    await this.load();
    return this.messages.find((message) => {
      const reference = forumMessageReference(message, this.forumRoot);
      return (
        message.author?.id === this.bot.id &&
        reference?.topicUrl === topicUrl &&
        reference.postId === starterId
      );
    });
  }
  async thread(topicUrl) {
    await this.load();
    this.threads ||= await this.discord.publicThreads(this.guild, this.channel);
    for (const thread of this.threads) {
      const source =
        this.messages.find((message) => message.id === thread.id) ||
        (await this.discord.optional(`channels/${this.channel}/messages/${thread.id}`));
      if (forumMessageReference(source || {}, this.forumRoot)?.topicUrl === topicUrl)
        return { thread, source };
      if (!source) {
        const messages = await this.discord.request(`channels/${thread.id}/messages?limit=100`);
        if (
          messages.some(
            (message) => forumMessageReference(message, this.forumRoot)?.topicUrl === topicUrl,
          )
        )
          return { thread, source: null };
      }
    }
    return null;
  }
}
