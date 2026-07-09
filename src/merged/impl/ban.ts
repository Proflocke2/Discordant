import { requireAdmin } from '../../utils/guards';
import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  GuildMember, TextChannel, EmbedBuilder,
} from 'discord.js';
import { BotClient } from '../../utils/types';
import db, { getGuild } from '../../database/db';
import { getLocalized, Language } from '../../utils/localization';
import { success, error, modEmbed } from '../../utils/embeds';

async function sendModLog(interaction: ChatInputCommandInteraction, embed: EmbedBuilder) {
  const g = getGuild(interaction.guildId!);
  if (!g.mod_log_channel) return;
  const ch = interaction.guild?.channels.cache.get(g.mod_log_channel) as TextChannel | undefined;
  await ch?.send({ embeds: [embed] });
}

export default {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .addIntegerOption(o => o.setName('days').setDescription('Delete message days (0-7)')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!await requireAdmin(interaction as any)) return;
    const guild = getGuild(interaction.guildId!);
    const lang = (guild.language || 'en') as Language;
    const target = interaction.options.getMember('user') as GuildMember;
    const reason = interaction.options.getString('reason') ?? 'No reason';
    const days = interaction.options.getInteger('days') ?? 0;

    if (!target) return interaction.reply({ embeds: [error(getLocalized('common.invalid_user', lang))], ephemeral: true });

    try {
      await interaction.guild?.members.ban(target, { reason, deleteMessageSeconds: days * 86400 });
      const e = modEmbed('Ban', target.toString(), interaction.user.toString(), reason);
      await interaction.reply({ embeds: [success(getLocalized('mod.ban_title', lang), getLocalized('mod.user_banned', lang, { user: target.toString() }))] });
      await sendModLog(interaction, e);
    } catch {
      await interaction.reply({ embeds: [error(getLocalized('common.error', lang))], ephemeral: true });
    }
  },
};
