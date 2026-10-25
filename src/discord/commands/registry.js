import { CommandAccess } from '../interactions/CommandAccess.js';
import { SetupViews } from '../views/SetupViews.js';
import { SetupCommand } from './SetupCommand.js';
import { ForumFetchCommand } from './ForumFetchCommand.js';

export const commandDefinitions = [
  {
    name: 'setup',
    description: 'Konfiguracja powiadomień forum',
    type: 1,
    contexts: [0],
    integration_types: [0],
    default_member_permissions: null,
  },
  {
    name: 'forum',
    description: 'Sprawdzanie forum',
    type: 1,
    contexts: [0],
    integration_types: [0],
    default_member_permissions: null,
    options: [
      { type: 1, name: 'fetch', description: 'Sprawdź teraz i wyślij nowe posty na wybrany kanał' },
    ],
  },
];

// Keep registration and dispatch together when adding a slash command.
export function createCommandRegistry(database, monitor, discord, allowedGuild) {
  const access = new CommandAccess(database, allowedGuild);
  const views = new SetupViews(database, access);
  const fetchCommand = new ForumFetchCommand(database, monitor);
  const setup = new SetupCommand(database, monitor, discord, access, views, fetchCommand);
  return {
    access,
    commands: new Map([
      ['setup', (interaction) => setup.execute(interaction)],
      ['forum fetch', (interaction) => fetchCommand.execute(interaction)],
    ]),
    components: new Map([['setup', (interaction) => setup.component(interaction)]]),
  };
}
