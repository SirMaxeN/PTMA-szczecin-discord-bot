import { reply } from '../interactions/responses.js';

export class HelpView {
  static render(interaction) {
    return reply(
      [
        '**Forum Bot · Pomoc**',
        '',
        '**Komendy**',
        '`/setup` otwiera ustawienia. Widzisz je tylko Ty.',
        '`/forum fetch` sprawdza forum od razu i wysyła nowe posty na wybrany kanał. Gdy nic nie przybyło, dostaniesz prywatną odpowiedź.',
        '',
        '**Jak zacząć**',
        'W /setup wybierz „Forum fetch”, a potem kanał powiadomień. Bot potrzebuje dostępu do kanału oraz możliwości wysyłania wiadomości i osadzania linków. Przy pierwszym ustawieniu zapisze aktualny stan forum, bez wysyłania starszych postów.',
        '',
        '**Sprawdzanie forum**',
        '„Sprawdź i wyślij” działa tak jak /forum fetch. „Podgląd lokalny” pokazuje nowe wpisy tylko Tobie. Nie wysyła ich na kanał ani nie oznacza jako wysłanych.',
        '',
        '**Harmonogram**',
        'Wybierz godziny od i do oraz odstęp: 30 minut, 1, 2 lub 4 godziny. Czas jest liczony dla Polski. Pierwsza i ostatnia godzina zawsze obejmują sprawdzenie. Przykład: od 11:00 do 16:00 co 2 godziny to 11:00, 13:00, 15:00 i 16:00. Co 30 minut oznacza pełne godziny i wpół do. Zakres może przechodzić przez północ; takie same godziny oznaczają całą dobę.',
        '',
        '**Pozostałe ustawienia**',
        'W „Konfiguracja treści” włączysz fragment wpisu i wybierzesz limit od 100 do 1500 znaków. Domyślnie jest to 500. Zdjęcia są oznaczane jako [zdjęcie]. Link prowadzi do pełnego posta.',
        '„Wstrzymaj sprawdzanie” zatrzymuje automat. Ręczne sprawdzanie nadal działa. Po wznowieniu bot uwzględni zaległe wpisy.',
        '„Usuń kanał powiadomień” odłącza kanał i zatrzymuje automat. Sam kanał na Discordzie pozostaje.',
        '',
        '**Dostęp**',
        'Komend mogą używać administratorzy i role wybrane w „Upoważnione role”. Tę listę zmienia tylko administrator.',
        'Automat nie pisze na kanale, jeśli nie ma nowych postów.',
      ].join('\n'),
      [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: 'Wróć do ustawień',
              custom_id: `setup:${interaction.member.user.id}:menu`,
            },
          ],
        },
      ],
    );
  }
}
