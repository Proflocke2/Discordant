import { getWarnConfig } from './warnconfig';
import { requireModerator } from '../../utils/guards';
/**
 * /warn — Verwarnt einen User.
 *
 * UI: Button-basiertes Warn-System mit Modal für Reason-Eingabe.
 * Auto-Eskalation: 3 Warns → Timeout, 5 Warns → Ban.
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  GuildMember, EmbedBuilder, MessageFlags,
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ButtonInteraction,
} from 'discord.js';
import db, { getGuild } from '../../database/db';
import { error } from '../../utils/embeds';

export default {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the warning').setRequired(true)),

  async execute(ix: ChatInputCommandInteraction) {
    if (!await requireModerator(ix)) return;
    const target = ix.options.getMember('user') as GuildMember | null;
    const reason = ix.options.getString('reason', true);

    if (!target) {
      return ix.reply({ embeds: [error('User not found.')], flags: MessageFlags.Ephemeral });
    }
    if (target.id === ix.user.id) {
      return ix.reply({ embeds: [error('Du kannst dich nicht selbst verwarnen.')], flags: MessageFlags.Ephemeral });
    }
    if (target.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return ix.reply({ embeds: [error('Du kannst keine Admins verwarnen.')], flags: MessageFlags.Ephemeral });
    }

    db.prepare('INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)')
      .run(ix.guildId, target.id, ix.user.id, reason);

    const count = (db.prepare('SELECT COUNT(*) as c FROM warnings WHERE guild_id = ? AND user_id = ?')
      .get(ix.guildId, target.id) as { c: number }).c;

    // Auto-escalation (configurable via /warnconfig)
    const warnCfg = getWarnConfig(ix.guildId!);
    let escalation = '';
    if (warnCfg.ban_threshold > 0 && count >= warnCfg.ban_threshold) {
      await ix.guild?.members.ban(target, { reason: `Auto-ban: ${count} warnings` }).catch(() => {});
      escalation = `🔨 **Auto-Ban** triggered (${count} warnings).`;
    } else if (warnCfg.kick_threshold > 0 && count >= warnCfg.kick_threshold) {
      await ix.guild?.members.kick(target, `Auto-kick: ${count} warnings`).catch(() => {});
      escalation = `👢 **Auto-Kick** triggered (${count} warnings).`;
    } else if (warnCfg.mute_threshold > 0 && count >= warnCfg.mute_threshold) {
      const ms = warnCfg.mute_duration_minutes * 60 * 1000;
      await target.timeout(ms, `Auto-mute: ${count} warnings`).catch(() => {});
      escalation = `⏱️ **Auto-Mute** (${warnCfg.mute_duration_minutes}min) triggered (${count} warnings).`;
    }

    // Try to DM the warned user
    const dmEmbed = new EmbedBuilder()
      .setTitle(`⚠️ Du wurdest auf **${ix.guild?.name}** verwarnt`)
      .setColor('#fee75c')
      .addFields(
        { name: 'Grund',        value: reason,                    inline: true },
        { name: 'Verwarnung',   value: `${count}/5`,              inline: true },
        { name: 'Moderator',    value: ix.user.tag,               inline: true },
      )
      .setTimestamp();
    await target.send({ embeds: [dmEmbed] }).catch(() => {});

    // Reply embed with buttons to view warnings / undo
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Verwarnung ausgesprochen')
      .setColor('#fee75c')
      .setThumbnail(target.user.displayAvatarURL())
      .addFields(
        { name: 'User',        value: `${target} (${target.user.tag})`, inline: true },
        { name: 'Verwarnungen', value: `**${count}/5**`,                inline: true },
        { name: 'Moderator',   value: `${ix.user}`,                    inline: true },
        { name: 'Grund',       value: reason },
        ...(escalation ? [{ name: '🤖 Auto-Aktion', value: escalation }] : []),
      )
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`warn:list:${target.id}`)
        .setLabel('Alle Verwarnungen')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`warn:remove_last:${target.id}`)
        .setLabel('Letzte entfernen')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
    );

    await ix.reply({ embeds: [embed], components: [row] });
  },
};
