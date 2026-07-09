/**
 * /ticket-types — merged command.
 *   category ← former /category    (subcommand group)
 *   type     ← former /ticket-type (subcommand group)
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { copyAsSubcommandGroup } from '../../merged/mergeUtils';
import categoryCmd    from '../../merged/impl/category';
import tickettypeCmd  from '../../merged/impl/tickettype';

const data = new SlashCommandBuilder()
  .setName('ticket-types')
  .setDescription('Ticket categories & reusable type templates')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

copyAsSubcommandGroup(data, 'category', 'Manage ticket categories on a panel',      categoryCmd as any);
copyAsSubcommandGroup(data, 'type',     'Manage reusable ticket type templates',   tickettypeCmd as any);

export default {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommandGroup(false)) {
      case 'category': return (categoryCmd as any).execute(interaction);
      case 'type':      return (tickettypeCmd as any).execute(interaction);
    }
  },
};
