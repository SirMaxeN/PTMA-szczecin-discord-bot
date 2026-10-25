import { escapeMarkdown } from '../messages/markdown.js';
import { reply, defer } from '../interactions/responses.js';

export class ForumFetchCommand {
  constructor(database, monitor) {
    this.database = database;
    this.monitor = monitor;
  }
  execute(interaction, preview = false) {
    if (!this.database.settings(interaction.guild_id)?.channel) {
      return reply(
        'Najpierw wybierz kanał powiadomień w /setup, z listy „Wybierz kanał powiadomień”. Samo nadanie botowi dostępu lub roli nie wybiera kanału.',
      );
    }
    return defer(async () => {
      const result = await this.monitor.check(interaction.guild_id, preview);
      if (!result.baseline && result.posts.length === 0)
        return { content: 'Brak nowych postów na forum.', allowed_mentions: { parse: [] } };
      let content;
      if (result.baseline)
        content = preview
          ? 'Nie ustawiono jeszcze stanu początkowego. Użyj „Sprawdź i wyślij” — zapisze aktualny stan bez publikowania archiwum.'
          : 'Zapisano stan początkowy forum. Starsze posty nie zostały wysłane. Kolejne sprawdzenia wykryją nowe wpisy.';
      else if (!preview) content = `Sprawdzono forum. Wysłano nowych postów: **${result.sent}**.`;
      else
        content =
          `**Podgląd lokalny — nowe posty: ${result.posts.length}**\n` +
          (result.posts
            .slice(0, 8)
            .map(
              (p) =>
                `• [${escapeMarkdown(p.title).slice(0, 95)}](<${p.url}>) — ${escapeMarkdown(p.author).slice(0, 70)}`,
            )
            .join('\n') || 'Brak nowych postów.') +
          (result.posts.length > 8 ? '\nPokazano pierwszych 8 postów.' : '');
      return { content: content.slice(0, 2000), allowed_mentions: { parse: [] } };
    });
  }
}
