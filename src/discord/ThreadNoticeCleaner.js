/** Removes only our own system announcements for a known, linked thread. */
export class ThreadNoticeCleaner {
  constructor(discord) {
    this.discord = discord;
  }
  async clean(guild, channel, thread) {
    const bot = await this.discord.currentUser();
    if (
      thread.guild_id !== guild ||
      thread.parent_id !== channel ||
      (thread.owner_id && thread.owner_id !== bot.id)
    )
      return 0;
    const messages = await this.discord.request(`channels/${channel}/messages?limit=100`);
    let removed = 0;
    for (const message of messages) {
      if (
        message.type !== 18 ||
        message.author?.id !== bot.id ||
        message.message_reference?.channel_id !== thread.id ||
        message.message_reference?.guild_id !== guild
      )
        continue;
      try {
        await this.discord.request(`channels/${channel}/messages/${message.id}`, 'DELETE');
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      removed++;
    }
    return removed;
  }
}
