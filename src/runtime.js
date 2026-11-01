import { ThreadedForumDelivery } from './discord/ThreadedForumDelivery.js';
import { Database } from './storage/Database.js';
import { DiscordApi } from './discord/DiscordApi.js';
import { ForumClient } from './forum/ForumClient.js';
import { ForumMonitor } from './forum/ForumMonitor.js';
import { Commands } from './discord/Commands.js';
import { loadPrivateConfig } from './config.js';

export function runtime() {
  loadPrivateConfig();
  process.umask(0o077);
  if (!process.env.DISCORD_API_BASE_URL)
    throw new Error('Configure DISCORD_API_BASE_URL in the private environment.');
  if (!process.env.FORUM_URL) throw new Error('Configure FORUM_URL in the private environment.');
  const database = new Database(process.env.DATABASE_PATH || './data/forum.sqlite');
  const discord = new DiscordApi(process.env.DISCORD_BOT_TOKEN);
  const forum = new ForumClient({
    url: process.env.FORUM_URL,
    name: process.env.FORUM_NAME || 'Forum',
    breadcrumbPrefix: process.env.FORUM_BREADCRUMB_PREFIX || '',
    username: process.env.FORUM_USERNAME,
    password: process.env.FORUM_PASSWORD,
    sessionPath: process.env.FORUM_SESSION_PATH || './data/forum-session.json',
  });
  const threadedDelivery = new ThreadedForumDelivery(database, discord, forum);
  const monitor = new ForumMonitor(database, forum, discord, threadedDelivery);
  return {
    database,
    discord,
    forum,
    monitor,
    threadedDelivery,
    commands: new Commands(database, monitor, discord, process.env.DISCORD_GUILD_ID),
  };
}
