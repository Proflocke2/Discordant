import { requirePermission } from '../../utils/guards';
import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { getGuild } from '../../database/db';
import { getLocalized, Language } from '../../utils/localization';
import { success, error } from '../../utils/embeds';

export default {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('user_id').setDescription('User ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!await requirePermission(interaction, PermissionFlagsBits.BanMembers)) return;
    const guild = getGuild(interaction.guildId!);
    const lang = (guild.language || 'en') as Language;
    const userId = interaction.options.getString('user_id', true);
    const reason = interaction.options.getString('reason') ?? 'No reason';
    try {
      await interaction.guild?.members.unban(userId, reason);
      await interaction.reply({ embeds: [success(getLocalized('mod.unban_title', lang), `User \`${userId}\` was unbanned`)] });
    } catch {
      await interaction.reply({ embeds: [error('Could not unban', 'User might not be banned or ID is invalid')], ephemeral: true });
    }
  },
};
