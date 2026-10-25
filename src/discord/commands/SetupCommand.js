import { ContentView } from '../views/ContentView.js';
import { HelpView } from '../views/HelpView.js';
import { update, reply, defer } from '../interactions/responses.js';

export class SetupCommand {
  constructor(database, monitor, discord, access, views, fetchCommand) {
    Object.assign(this, { database, monitor, discord, access, views, fetchCommand });
  }

  execute(interaction) {
    return this.views.menu(interaction);
  }

  component(interaction) {
    const [kind, owner, action] = interaction.data.custom_id.split(':');
    if (kind !== 'setup' || owner !== interaction.member.user.id)
      throw new Error('Otwórz własny panel przez /setup.');
    if (action === 'forum') return this.views.panel(interaction);
    if (action === 'help') return HelpView.render(interaction);
    if (action === 'menu') return this.views.menu(interaction);
    if (action === 'content') return ContentView.render(interaction, this.database);
    if (action === 'content-limit') {
      const value = interaction.data.values?.[0];
      if (!/^\d+$/.test(value || '')) throw new Error('Nieprawidłowy limit znaków.');
      this.database.setContentLimit(interaction.guild_id, Number(value));
      return update(ContentView.render(interaction, this.database));
    }
    if (['content-on', 'content-off'].includes(action)) {
      this.database.setShowContent(interaction.guild_id, action === 'content-on');
      return update(ContentView.render(interaction, this.database));
    }
    if (action === 'schedule') return this.views.schedulePanel(interaction);
    if (['start', 'end', 'interval'].includes(action)) {
      const value = interaction.data.values?.[0];
      if (!/^\d+$/.test(value || '')) throw new Error('Nieprawidłowy harmonogram.');
      this.database.setSchedule(interaction.guild_id, action, Number(value));
      return update(this.views.schedulePanel(interaction));
    }
    if (action === 'access') return this.views.accessPanel(interaction);
    if (action === 'roles') {
      this.access.admin(interaction);
      const roles = interaction.data.values || [];
      if (
        roles.length > 25 ||
        roles.some((role) => !/^\d+$/.test(role) || role === interaction.guild_id)
      )
        throw new Error('Wybierz konkretne role, bez @everyone.');
      this.database.setCommandRoles(interaction.guild_id, roles);
      return update(this.views.accessPanel(interaction));
    }
    if (['pause', 'resume', 'clear'].includes(action)) {
      if (action === 'resume' && !this.database.settings(interaction.guild_id)?.channel)
        throw new Error('Najpierw wybierz kanał powiadomień.');
      if (action === 'clear') this.database.clearChannel(interaction.guild_id);
      else this.database.pause(interaction.guild_id, action === 'pause');
      return update(this.views.panel(interaction));
    }
    if (action === 'channel')
      return defer(async () => {
        const channel = interaction.data.values?.[0];
        if (!/^\d+$/.test(channel || '')) throw new Error('Nieprawidłowy kanał.');
        await this.discord.validateChannel(interaction.guild_id, channel);
        this.database.configure(interaction.guild_id, channel);
        if (this.database.settings(interaction.guild_id).baseline === null)
          await this.monitor.check(interaction.guild_id);
        return this.views.panel(interaction).data;
      });
    if (['fetch', 'preview'].includes(action))
      return this.fetchCommand.execute(interaction, action === 'preview');
    return reply('Nieznane polecenie. Użyj /setup.');
  }
}
