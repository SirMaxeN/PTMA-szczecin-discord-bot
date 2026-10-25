import { reply } from '../interactions/responses.js';

export class ContentView {
  static render(interaction, database) {
    const enabled = database.showContent(interaction.guild_id);
    const limit = database.contentLimit(interaction.guild_id);
    const user = interaction.member.user.id;
    return reply(
      `**Konfiguracja treści**\nTreść posta: **${enabled ? 'włączona' : 'wyłączona'}**\nLimit: **${limit} znaków**\nDłuższy tekst skracamy i dodajemy „…”. Limit obejmuje spacje i oznaczenia zdjęć. Tytuł otwiera pełny wpis na forum. Zmiany dotyczą kolejnych powiadomień.`,
      [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: enabled ? 2 : 3,
              label: enabled ? 'Wyłącz treść' : 'Włącz treść',
              custom_id: `setup:${user}:content-${enabled ? 'off' : 'on'}`,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `setup:${user}:content-limit`,
              placeholder: 'Limit znaków',
              min_values: 1,
              max_values: 1,
              options: Array.from({ length: 15 }, (_, index) => {
                const value = (index + 1) * 100;
                return { label: `${value} znaków`, value: String(value), default: value === limit };
              }),
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 2, label: 'Wróć do Forum fetch', custom_id: `setup:${user}:forum` },
          ],
        },
      ],
    );
  }
}
