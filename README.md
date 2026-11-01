# PTMA Szczecin Discord Bot

Bot przenosi powiadomienia o nowych wpisach z forum Asgaros na Discorda. Działa w Node.js 24, obsługuje prywatne menu ustawień i zapisuje stan odczytu w SQLite. Adres forum, identyfikatory Discorda i dane wdrożenia pochodzą z prywatnej konfiguracji.

## Co potrafi

- Wykrywa nowe tematy i odpowiedzi, także na kolejnych stronach wątku.
- Wysyła osobne powiadomienie o każdym poście: tytuł z linkiem, dział, autor i czas publikacji z forum.
- Może dołączać fragment treści. Limit wynosi od 100 do 1500 znaków, co 100; domyślnie 500. Zdjęcia zastępuje oznaczeniem `[zdjęcie]`.
- Sprawdza forum według harmonogramu lub na żądanie. Gdy nie ma nowych postów, automat nie wysyła wiadomości.
- Zapamiętuje wysłane wpisy niezależnie od tego, czy użytkownik przeczytał je na forum.

## Komendy i ustawienia

`/setup` otwiera prywatne menu. Wybierz **Forum fetch**, aby ustawić kanał, harmonogram i treść powiadomień. Przycisk **Pomoc** wyjaśnia poszczególne opcje.

`/forum fetch` sprawdza forum od razu i wysyła nowe wpisy. Jeśli nic nie przybyło, pokazuje prywatną odpowiedź. **Podgląd lokalny** wyświetla wyniki wyłącznie osobie, która go uruchomiła. Nie publikuje wpisów i nie oznacza ich jako wysłanych.

Harmonogram obejmuje godziny od i do oraz odstęp 30 minut, 1, 2 lub 4 godziny. Pierwsza i ostatnia godzina zawsze obejmują sprawdzenie. Przykład: 11:00 do 16:00 co 2 godziny oznacza 11:00, 13:00, 15:00 i 16:00. Co 30 minut to pełne godziny i wpół do. Czas: Europe/Warsaw. Zakres może przechodzić przez północ; takie same godziny oznaczają całą dobę.

**Wstrzymaj sprawdzanie** zatrzymuje automat; ręczne sprawdzanie nadal działa. Po wznowieniu bot uwzględnia zaległe wpisy. **Usuń kanał powiadomień** odłącza kanał i zatrzymuje automat, ale nie usuwa kanału na Discordzie.

Komend używają administratorzy i role wybrane w **Upoważnione role**. Listę zmienia tylko administrator. Uprawnienia i właściciel panelu są sprawdzani przy każdej interakcji. Nieuprawniona osoba może widzieć nazwę komendy, ale nie może jej wykonać.

## Odpowiedzi w wątkach

Odpowiedzi zawsze trafiają do wątków. Ten mechanizm nie wymaga przełącznika w ustawieniach.

Nowy temat tworzy jedną wiadomość na kanale. Dopiero pierwsza odpowiedź tworzy pod nią publiczny wątek. Następne wpisy z tego tematu trafiają do tego samego wątku. Jeśli pierwsza wykryta odpowiedź dotyczy starszego tematu, bot znajduje istniejącą wiadomość otwierającą albo publikuje pierwszy wpis tematu jako punkt odniesienia.

Powiązania są zapisywane w bazie osobno dla kanału i adresu tematu. Istniejące wiadomości oraz aktywne i zarchiwizowane wątki są sprawdzane po linku do forum, bez dopasowywania po samym tytule. Wątki zarchiwizowane są wznawiane; blokady ustawione przez moderatora pozostają w mocy. Bot potrzebuje Read Message History, Create Public Threads i Send Messages in Threads, oprócz uprawnień podstawowych.

Automatyczna obsługa nie przenosi wcześniej wysłanych wiadomości. Ewentualne porządkowanie historii to osobna, jednorazowa operacja administracyjna; nie jest częścią harmonogramu ani ustawień bota.

## Uruchomienie

Wymagania: Node.js 24 lub nowszy, aplikacja Discord z interakcjami HTTP i konto z prawem odczytu docelowego forum.

1. Skopiuj `.env.example` do `.env`.
2. Ustaw `FORUM_URL`, `DISCORD_API_BASE_URL`, `DISCORD_APPLICATION_ID` i `DISCORD_PUBLIC_KEY` we własnej prywatnej konfiguracji.
3. Uzupełnij login i hasło forum, token bota oraz identyfikator serwera. Możesz użyć `configure-secrets.cmd`, który zapisuje je w prywatnym `data/secrets.json`, lub zmiennych środowiskowych.
4. Zainstaluj zależności i uruchom testy.

```sh
npm ci --ignore-scripts
npm test
npm run forum:check
npm run register
npm start
```

`forum:check` sprawdza logowanie i indeks forum bez wysyłania wiadomości. `register` zastępuje listę komend tej aplikacji na skonfigurowanym serwerze. W Developer Portal ustaw endpoint interakcji własnego wdrożenia: ścieżkę `/interactions` albo `${HTTP_BASE_PATH}/interactions`.

Bot potrzebuje uprawnień View Channels, Send Messages i Embed Links w wybranym kanale. Nie wymaga uprzywilejowanych intencji Gateway.

## Prywatna konfiguracja

| Zmienna                                        | Zastosowanie                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `FORUM_URL`                                    | Adres forum, wymagany; w kodzie nie ma adresu zastępczego        |
| `FORUM_USERNAME`, `FORUM_PASSWORD`             | Dane konta forum                                                 |
| `FORUM_NAME`                                   | Nazwa w stopce powiadomienia                                     |
| `FORUM_BREADCRUMB_PREFIX`                      | Opcjonalny prefiks usuwany z nazwy działu                        |
| `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` | Identyfikator aplikacji i publiczny klucz weryfikacji interakcji |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`        | Token bota i docelowy serwer                                     |
| `SECRETS_FILE`                                 | Ścieżka do prywatnego pliku z danymi dostępu                     |
| `DATABASE_PATH`, `FORUM_SESSION_PATH`          | Ścieżki bazy i ciasteczek sesji                                  |
| `HTTP_BASE_PATH`, `PORT`                       | Prefiks ścieżek i port serwera HTTP                              |
| `ENV_FILE`                                     | Opcjonalna ścieżka pliku środowiskowego dla `startup.cjs`        |

Nie dodawaj do Gita plików `.env`, `.deploy.psd1`, danych konta, sesji, baz, kopii zapasowych ani materiałów z paneli administracyjnych. `.gitignore` wyklucza je z repozytorium. Publiczne szablony zawierają wyłącznie przykłady. Logo i grafiki konkretnego wdrożenia również pozostają poza publicznym kodem.

## Jak działa zapis stanu

Pierwsze sprawdzenie zapisuje aktualny punkt startowy bez publikowania archiwum. Kolejne sprawdzenia szukają wyższych identyfikatorów postów i pomijają wpisy już wysłane. Baza przechowuje ustawienia, identyfikatory dostarczeń i wykonane przedziały harmonogramu. Treści postów i zdjęcia nie są archiwizowane.

Blokady w bazie zapobiegają równoległemu sprawdzaniu przez proces HTTP i zadanie cron. Każde dostarczenie zapisuje się osobno; nieudane można ponowić. Stałe nonce Discorda ograniczają duplikaty, ale awaria pomiędzy wysłaniem a zapisem wyniku nadal może spowodować powtórkę. Edycje postów nie tworzą nowych powiadomień.

Odczyt zależy od uprawnień konta forum. Czytanie tematów przez bota może zmieniać stan przeczytania na tym koncie. CAPTCHA i dodatkowe wymagania logowania nie są obchodzone.

## Wdrożenie

Skopiuj `.deploy.example.psd1` do `.deploy.psd1` i wpisz własny host, użytkownika SSH, port, ścieżkę klucza, katalog aplikacji, ścieżkę środowiska Node oraz URL kontroli działania. Skrypt `scripts/deploy.ps1` pakuje tylko pliki źródłowe, tworzy kopię kodu na serwerze i żąda restartu procesów tej aplikacji. Zweryfikuj identyfikator uruchomionej wersji po wdrożeniu.

Uruchamiaj `scripts/maintenance.js` co minutę w cron z katalogu aplikacji, używając Node 24 i prywatnego `.env`. Harmonogram w bazie określa, kiedy rzeczywiście sprawdzać forum. `startup.cjs` jest punktem wejścia dla hostingu zarządzającego procesami Node. Konkretnych hostów i ścieżek nie przechowujemy w repozytorium.

## Gdzie rozwijać kod

| Folder lub plik                    | Odpowiedzialność                        |
| ---------------------------------- | --------------------------------------- |
| `src/runtime.js`                   | Łączenie usług i konfiguracji           |
| `src/discord/Commands.js`          | Autoryzacja i kierowanie interakcji     |
| `src/discord/commands/registry.js` | Definicje i rejestr komend              |
| `src/discord/commands/`            | Zachowanie komend                       |
| `src/discord/views/`               | Menu i pomoc                            |
| `src/discord/interactions/`        | Uprawnienia i odpowiedzi interakcji     |
| `src/discord/messages/`            | Wygląd powiadomień                      |
| `src/forum/ForumClient.js`         | Logowanie, pobieranie stron i paginacja |
| `src/forum/parsing/`               | Odczyt postów i dat z HTML              |
| `src/forum/ForumMonitor.js`        | Wykrywanie, dostarczanie i deduplikacja |
| `src/forum/ForumSchedule.js`       | Obliczanie harmonogramu                 |
| `src/storage/Database.js`          | SQLite i aktualizacje schematu          |
| `src/http/InteractionServer.js`    | Podpisy Discorda i obsługa HTTP         |
| `tests/`                           | Testy zachowania i regresji             |

Nową komendę dodaj jako osobną klasę i wpis w `registry.js`, a potem uruchom `npm run register`. Powolne operacje używają odpowiedzi odroczonej `defer`. Zmiany ustawień trafiają do `Database`, a menu pozostaje w widokach. Każda interakcja przechodzi przez wspólną kontrolę dostępu.

```sh
npm run format
npm run format:check
npm test
```

Kod jest przykładem wdrożonej integracji forum i Discorda. Publiczne repozytorium pokazuje mechanizm działania; dane konkretnej instalacji pozostają w prywatnej konfiguracji.
