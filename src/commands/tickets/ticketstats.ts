/**
 * /ticketstats — Ticket analytics and staff performance dashboard.
 *
 * Subcommands:
 *   overview – General ticket activity stats (totals, today, week, month)
 *   staff    – Staff performance (claims and closures per user)
 *   survey   – Exit survey statistics and rating breakdown
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { info } from '../../utils/embeds';
import * as Repo from '../../modules/tickets/repository';

/** Format seconds into a human-readable duration. */
function formatDuration(seconds: number): string {
  if (seconds < 60)   return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('ticketstats')
    .setDescription('View ticket analytics and staff performance')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    .addSubcommand(s =>
      s.setName('overview')
        .setDescription('General ticket activity overview'),
    )

    .addSubcommand(s =>
      s.setName('staff')
        .setDescription('Staff performance — claims and closures per member')
        .addIntegerOption(o =>
          o.setName('limit')
            .setDescription('How many staff members to show (default 10, max 25)')
            .setMinValue(1)
            .setMaxValue(25),
        ),
    )

    .addSubcommand(s =>
      s.setName('survey')
        .setDescription('Exit survey ratings breakdown'),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── OVERVIEW ─────────────────────────────────────────────────────────────
    if (sub === 'overview') {
      const s = Repo.getGuildStats(gid);

      const avgClose = s.avg_close_time !== null
        ? formatDuration(s.avg_close_time)
        : 'N/A';

      const openPct  = s.total > 0 ? ((s.open  / s.total) * 100).toFixed(1) : '0';
      const closePct = s.total > 0 ? ((s.closed / s.total) * 100).toFixed(1) : '0';

      const embed = new EmbedBuilder()
        .setTitle('📊 Ticket Statistics — Overview')
        .setColor('#5865f2')
        .addFields(
          { name: '🎫 Total Tickets',    value: String(s.total),     inline: true },
          { name: '🟢 Open',             value: `${s.open} (${openPct}%)`,   inline: true },
          { name: '🔒 Closed',           value: `${s.closed} (${closePct}%)`, inline: true },
          { name: '📅 Today',            value: String(s.today),     inline: true },
          { name: '📅 This Week',        value: String(s.this_week), inline: true },
          { name: '📅 This Month',       value: String(s.this_month),inline: true },
          { name: '⏱️ Avg Close Time',   value: avgClose,            inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Statistics based on all-time data' });

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── STAFF ────────────────────────────────────────────────────────────────
    if (sub === 'staff') {
      const limit = ix.options.getInteger('limit') ?? 10;
      const staff = Repo.getStaffStats(gid, limit);

      if (staff.length === 0) {
        return ix.reply({
          embeds: [info('👥 Staff Stats', 'No staff activity recorded yet.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const rows = staff.map((s, i) => {
        const total = s.claimed + s.closed;
        return `**${i + 1}.** <@${s.user_id}> — ✋ ${s.claimed} claimed • 🔒 ${s.closed} closed • **${total} total**`;
      });

      const embed = new EmbedBuilder()
        .setTitle('👥 Staff Performance')
        .setDescription(rows.join('\n'))
        .setColor('#5865f2')
        .setTimestamp()
        .setFooter({ text: `Showing top ${staff.length} staff members` });

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── SURVEY ───────────────────────────────────────────────────────────────
    if (sub === 'survey') {
      const s = Repo.getSurveyStats(gid);

      if (s.total === 0) {
        return ix.reply({
          embeds: [info('⭐ Survey Stats', 'No survey responses yet.\n\nEnable exit surveys with `/settings ticket survey enabled:true`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const avgStr = s.avg_rating !== null ? s.avg_rating.toFixed(2) : 'N/A';

      // Visual bar for ratings
      function bar(count: number): string {
        const pct = s.total > 0 ? (count / s.total) * 10 : 0;
        const filled = Math.round(pct);
        return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` (${count})`;
      }

      const embed = new EmbedBuilder()
        .setTitle('⭐ Exit Survey Statistics')
        .setColor('#fee75c')
        .addFields(
          { name: 'Total Responses', value: String(s.total),                             inline: true },
          { name: 'Average Rating',  value: `${avgStr} / 5.00 ⭐`,                      inline: true },
          { name: '\u200b',          value: '\u200b',                                    inline: true },
          { name: '⭐ 1 Star',       value: bar(s.rating_1), inline: false },
          { name: '⭐⭐ 2 Stars',    value: bar(s.rating_2), inline: false },
          { name: '⭐⭐⭐ 3 Stars', value: bar(s.rating_3), inline: false },
          { name: '⭐⭐⭐⭐ 4 Stars', value: bar(s.rating_4), inline: false },
          { name: '⭐⭐⭐⭐⭐ 5 Stars', value: bar(s.rating_5), inline: false },
        )
        .setTimestamp();

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
