import { commandDefinitions, createCommandRegistry } from './commands/registry.js';
import { reply } from './interactions/responses.js';

/** Routes all interactions through the same authorization boundary. */
export class Commands {
  static definitions() {
    return commandDefinitions;
  }

  constructor(database, monitor, discord, allowedGuild) {
    this.registry = createCommandRegistry(database, monitor, discord, allowedGuild);
  }

  async handle(interaction) {
    try {
      this.registry.access.authorize(interaction);
      let handler;
      if (interaction.type === 2) {
        const subcommand = interaction.data.options?.find((option) => option.type === 1)?.name;
        const key = [interaction.data.name, subcommand].filter(Boolean).join(' ');
        handler = this.registry.commands.get(key);
      } else if (interaction.type === 3) {
        const namespace = interaction.data.custom_id.split(':')[0];
        handler = this.registry.components.get(namespace);
      }
      return handler ? await handler(interaction) : reply('Nieznane polecenie. Użyj /setup.');
    } catch (error) {
      return reply(error.message);
    }
  }
}
