/**
 * /history — combined moderation timeline for one member.
 *
 * Warns come from the `warnings` table (already persisted for the escalation
 * system). Kicks and timeouts come from `mod_history`, which kick.ts and
 * timeout.ts now write to — Discord's own audit log only keeps ~45 days and
 * caps at 50 entries per fetch, so it's not a reliable long-term record.
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { requirePermission } from '../../utils/guards';
import { PermissionFlagsBits } from 'discord.js';
import db, { getModHistory, ModHistoryRow } from '../../database/db';
import { msToTime } from '../../utils/helpers';

interface WarnRow {
  id: number;
  moderator_id: string;
  reason: string;
  created_at: number;
}

type TimelineEntry = {
  type: 'warn' | 'kick' | 'timeout';
  moderator_id: string;
  reason: string;
  created_at: number;
  duration_ms?: number | null;
};

const ICON: Record<TimelineEntry['type'], string> = {
  warn: '⚠️',
  kick: '👢',
  timeout: '🔇',
};

export default {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show a member\'s warn / timeout / kick history')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!await requirePermission(interaction, PermissionFlagsBits.ModerateMembers)) return;

    const user = interaction.options.getUser('user', true);
    const gid  = interaction.guildId!;

    const warns: WarnRow[] = db.prepare(
      'SELECT id, moderator_id, reason, created_at FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
    ).all(gid, user.id) as WarnRow[];

    const modRows: ModHistoryRow[] = getModHistory(gid, user.id);

    const timeline: TimelineEntry[] = [
      ...warns.map(w => ({
        type: 'warn' as const,
        moderator_id: w.moderator_id,
        reason: w.reason,
        created_at: w.created_at,
      })),
      ...modRows.map(m => ({
        type: m.action,
        moderator_id: m.moderator_id,
        reason: m.reason || 'No reason',
        created_at: m.created_at,
        duration_ms: m.duration_ms,
      })),
    ].sort((a, b) => b.created_at - a.created_at);

    const kickCount    = modRows.filter(m => m.action === 'kick').length;
    const timeoutCount = modRows.filter(m => m.action === 'timeout').length;

    const embed = new EmbedBuilder()
      .setColor(warns.length >= 3 ? '#ed4245' : timeline.length > 0 ? '#fee75c' : '#57f287')
      .setTitle(`📜 History — ${user.tag}`)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: '⚠️ Warns',    value: String(warns.length), inline: true },
        { name: '🔇 Timeouts', value: String(timeoutCount),  inline: true },
        { name: '👢 Kicks',    value: String(kickCount),     inline: true },
      )
      .setFooter({ text: `User-ID: ${user.id}` })
      .setTimestamp();

    if (timeline.length === 0) {
      embed.setDescription('*No recorded warns, timeouts, or kicks for this user.*');
    } else {
      const lines = timeline.slice(0, 15).map(e => {
        const when = `<t:${e.created_at}:R>`;
        const dur  = e.type === 'timeout' && e.duration_ms ? ` (${msToTime(e.duration_ms)})` : '';
        return `${ICON[e.type]} **${e.type}**${dur} — ${when} — ${e.reason} *(by <@${e.moderator_id}>)*`;
      });
      embed.addFields({ name: `Timeline (${Math.min(timeline.length, 15)}/${timeline.length})`, value: lines.join('\n').slice(0, 1024) });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
