/**
 * /ticket-content — merged command.
 *   form ← former /form (subcommand group)
 *   tag  ← former /tag  (subcommand group)
 *
 * NOTE: /form required ManageGuild, /tag required the weaker ManageMessages.
 * The merged parent uses ManageGuild (the stricter of the two) so access
 * only narrows, never widens, versus the original commands.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { copyAsSubcommandGroup } from '../../merged/mergeUtils';
import formCmd from '../../merged/impl/form';
import tagCmd  from '../../merged/impl/tag';

const data = new SlashCommandBuilder()
  .setName('ticket-content')
  .setDescription('Ticket form questions & saved-response tags')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

copyAsSubcommandGroup(data, 'form', 'Manage ticket form questions',            formCmd as any);
copyAsSubcommandGroup(data, 'tag',  'Manage and use ticket tags (saved replies)', tagCmd as any);

export default {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommandGroup(false)) {
      case 'form': return (formCmd as any).execute(interaction);
      case 'tag':  return (tagCmd as any).execute(interaction);
    }
  },
};
