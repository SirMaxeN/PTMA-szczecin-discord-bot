import { reply } from '../interactions/responses.js';

export class SetupViews {
  constructor(database, access) {
    this.database = database;
    this.access = access;
  }
  menu(interaction) {
    return reply('**Forum Bot · Ustawienia**\nWybierz funkcję do skonfigurowania.', [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: 'Forum fetch',
            custom_id: `setup:${interaction.member.user.id}:forum`,
          },
          {
            type: 2,
            style: 2,
            label: 'Pomoc',
            custom_id: `setup:${interaction.member.user.id}:help`,
          },
          ...(BigInt(interaction.member.permissions || '0') & 8n
            ? [
                {
                  type: 2,
                  style: 2,
                  label: 'Upoważnione role',
                  custom_id: `setup:${interaction.member.user.id}:access`,
                },
              ]
            : []),
        ],
      },
    ]);
  }
  accessPanel(interaction) {
    this.access.admin(interaction);
    const roles = this.database.commandRoles(interaction.guild_id);
    const user = interaction.member.user.id;
    return reply(
      `**Dostęp do wszystkich komend**\nAdministratorzy: zawsze.\nRole: ${roles.length ? roles.map((role) => `<@&${role}>`).join(', ') : 'nie wybrano — tylko administratorzy'}.\nTylko administratorzy mogą zmieniać tę listę.`,
      [
        {
          type: 1,
          components: [
            {
              type: 6,
              custom_id: `setup:${user}:roles`,
              placeholder: 'Wybierz uprawnione role',
              min_values: 0,
              max_values: 25,
              default_values: roles.map((id) => ({ id, type: 'role' })),
            },
          ],
        },
        {
          type: 1,
          components: [{ type: 2, style: 2, label: 'Wróć', custom_id: `setup:${user}:menu` }],
        },
      ],
    );
  }
  panel(interaction) {
    const s = this.database.settings(interaction.guild_id);
    const user = interaction.member.user.id;
    const schedule = this.database.schedule(interaction.guild_id);
    const hour = (value) => `${String(value).padStart(2, '0')}:00`;
    const date = (value) =>
      value
        ? new Intl.DateTimeFormat('pl-PL', {
            timeZone: 'Europe/Warsaw',
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(new Date(value))
        : 'jeszcze nie sprawdzano';
    return reply(
      `**Forum Bot · Forum fetch**\nKanał: ${s?.channel ? `<#${s.channel}>` : 'nie wybrano — wybierz kanał z listy poniżej'}\nAutomatyczne sprawdzanie: **${!s?.channel ? 'wyłączone — brak kanału' : s.paused ? 'wstrzymane' : 'włączone'}**\nHarmonogram: od ${hour(schedule.start)} do ${hour(schedule.end)}, co ${schedule.interval === 30 ? '30 minut' : `${schedule.interval / 60} godz.`} (Europe/Warsaw).\nOstatnia próba: ${date(s?.checked)}\n${s?.error || ''}\nPodgląd lokalny jest prywatny i nie oznacza postów jako wysłanych.`,
      [
        {
          type: 1,
          components: [
            {
              type: 8,
              custom_id: `setup:${user}:channel`,
              channel_types: [0, 5],
              placeholder: 'Wybierz kanał powiadomień',
              min_values: 1,
              max_values: 1,
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Sprawdź i wyślij', custom_id: `setup:${user}:fetch` },
            { type: 2, style: 2, label: 'Podgląd lokalny', custom_id: `setup:${user}:preview` },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: 'Konfiguracja treści',
              custom_id: `setup:${user}:content`,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: s?.paused ? 3 : 2,
              label: s?.paused ? 'Wznów sprawdzanie' : 'Wstrzymaj sprawdzanie',
              custom_id: `setup:${user}:${s?.paused ? 'resume' : 'pause'}`,
              disabled: !s?.channel,
            },
            {
              type: 2,
              style: 4,
              label: 'Usuń kanał powiadomień',
              custom_id: `setup:${user}:clear`,
              disabled: !s?.channel,
            },
            { type: 2, style: 2, label: 'Harmonogram', custom_id: `setup:${user}:schedule` },
            { type: 2, style: 2, label: 'Wróć', custom_id: `setup:${user}:menu` },
          ],
        },
      ],
    );
  }
  schedulePanel(interaction) {
    const schedule = this.database.schedule(interaction.guild_id);
    const user = interaction.member.user.id;
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      label: `${String(hour).padStart(2, '0')}:00`,
      value: String(hour),
    }));
    const select = (key, placeholder, options) => ({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `setup:${user}:${key}`,
          placeholder,
          min_values: 1,
          max_values: 1,
          options: options.map((option) => ({
            ...option,
            default: Number(option.value) === schedule[key],
          })),
        },
      ],
    });
    return reply(
      '**Forum fetch · Harmonogram**\nWybierz godzinę rozpoczęcia, zakończenia i odstęp. Zmiany zapisują się od razu.\nPierwsze sprawdzenie wypada o godzinie początkowej, kolejne co wybrany odstęp (30 minut: o pełnych i wpół do godzin; 1 godzina: o pełnych godzinach). Godzina końcowa zawsze oznacza dodatkowe sprawdzenie, jeśli nie wypada w tym rytmie.\nPóźniejszy początek niż koniec oznacza pracę przez północ; takie same godziny oznaczają całą dobę. Czas: Europe/Warsaw.',
      [
        select('start', 'Od której godziny', hours),
        select('end', 'Do której godziny', hours),
        select('interval', 'Co ile sprawdzać', [
          { label: '30 minut', value: '30' },
          { label: '1 godzina', value: '60' },
          { label: '2 godziny', value: '120' },
          { label: '4 godziny', value: '240' },
        ]),
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
