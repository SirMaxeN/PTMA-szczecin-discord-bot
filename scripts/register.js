import { DiscordApi } from '../src/discord/DiscordApi.js';
import { Commands } from '../src/discord/Commands.js';
import { loadPrivateConfig } from '../src/config.js';
loadPrivateConfig();
const id = process.env.DISCORD_APPLICATION_ID;
const guild = process.env.DISCORD_GUILD_ID;
if (!/^\d+$/.test(id || '') || !/^\d+$/.test(guild || '') || !process.env.DISCORD_BOT_TOKEN)
  throw new Error('Configure Discord application ID, guild ID and bot token.');
await new DiscordApi(process.env.DISCORD_BOT_TOKEN).request(
  `applications/${id}/guilds/${guild}/commands`,
  'PUT',
  Commands.definitions(),
);
console.log('Forum commands registered for the configured server.');
