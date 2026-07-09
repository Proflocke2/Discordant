/**
 * /automod — merged command.
 * Combines the former /automod, /automod2 and /automod3 into one command
 * by flattening all their subcommands (17 total, no name collisions).
 *
 * Routing forwards each subcommand to the original module that owns it;
 * every original execute() switches on getSubcommand() exactly as before.
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { copySubcommands } from '../../merged/mergeUtils';
import automod  from '../../merged/impl/automod';
import automod2 from '../../merged/impl/automod2';
import automod3 from '../../merged/impl/automod3';

const data = new SlashCommandBuilder()
  .setName('automod')
  .setDescription('Auto-moderation: filters, punishments, anti-spam & more')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const own1 = copySubcommands(data, automod  as any);
const own2 = copySubcommands(data, automod2 as any);
const own3 = copySubcommands(data, automod3 as any);

export default {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    if (own1.has(sub)) return (automod  as any).execute(interaction);
    if (own2.has(sub)) return (automod2 as any).execute(interaction);
    if (own3.has(sub)) return (automod3 as any).execute(interaction);
  },
};
