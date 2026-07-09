/**
 * /records — merged command.
 *   infractions ← former /infractions (plain subcommand)
 *   notes       ← former /notes       (subcommand group: add / list / ...)
 *   warnconfig  ← former /warnconfig  (subcommand group: view / set)
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { wrapAsSubcommand, copyAsSubcommandGroup } from '../../merged/mergeUtils';
import infractionsCmd from '../../merged/impl/infractions';
import notesCmd       from '../../merged/impl/notes';
import warnconfigCmd  from '../../merged/impl/warnconfig';

const data = new SlashCommandBuilder()
  .setName('records')
  .setDescription('Member records: infraction history, mod notes, warn escalation config')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

wrapAsSubcommand(data, 'infractions', 'Show full infraction history of a member', infractionsCmd as any);
copyAsSubcommandGroup(data, 'notes',      'Internal moderator notes on members',      notesCmd as any);
copyAsSubcommandGroup(data, 'warnconfig', 'Configure warn escalation thresholds',     warnconfigCmd as any);

export default {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommandGroup(false)) {
      case 'notes':      return (notesCmd as any).execute(interaction);
      case 'warnconfig': return (warnconfigCmd as any).execute(interaction);
    }
    if (interaction.options.getSubcommand() === 'infractions') {
      return (infractionsCmd as any).execute(interaction);
    }
  },
};
