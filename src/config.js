import { existsSync, readFileSync } from 'node:fs';

export function loadPrivateConfig() {
  const path = process.env.SECRETS_FILE || './data/secrets.json';
  if (!existsSync(path)) return;
  const settings = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  for (const key of ['FORUM_USERNAME', 'FORUM_PASSWORD', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID']) {
    if (!process.env[key] && typeof settings[key] === 'string') process.env[key] = settings[key];
  }
}
