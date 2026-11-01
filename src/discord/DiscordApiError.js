export class DiscordApiError extends Error {
  constructor(status, code) {
    super(`Discord API error (${status}).`);
    this.name = 'DiscordApiError';
    this.status = status;
    this.code = code;
  }
}
