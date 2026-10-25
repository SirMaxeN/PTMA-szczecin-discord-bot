export class CommandAccess {
  constructor(database, allowedGuild) {
    this.database = database;
    this.allowedGuild = allowedGuild;
  }
  authorize(interaction) {
    if (
      !interaction.guild_id ||
      !interaction.member?.user ||
      (this.allowedGuild && interaction.guild_id !== this.allowedGuild)
    )
      throw new Error('Użyj polecenia na skonfigurowanym serwerze.');
    const permissions = BigInt(interaction.member.permissions || '0');
    if (
      !(permissions & 8n) &&
      !this.database
        .commandRoles(interaction.guild_id)
        .some((role) => interaction.member.roles?.includes(role))
    )
      throw new Error('Komendy są dostępne tylko dla administratorów i ról wskazanych w /setup.');
  }
  admin(interaction) {
    if (!(BigInt(interaction.member?.permissions || '0') & 8n))
      throw new Error('Tylko administrator może zmieniać role dostępu.');
  }
}
