/**
 * modules/staffActivity/service.ts
 *
 * The public API of the Staff Activity Tracking extension. This is the file
 * you actually import from elsewhere in the bot:
 *
 *   - recordTicketClosed(...)  → call from your ticket-close event
 *   - registerSponsor(...)     → call from wherever you register a giveaway sponsor
 *   - buildLeaderboardEmbed()  → for a manual "show me the leaderboard now" command
 *   - runStaffActivityTick()   → call once from a scheduler (e.g. every 15 min)
 *
 * Every entry point re-checks the guild's config toggles itself, so callers
 * never need to check "is this feature even enabled?" beforehand.
 */

import { EmbedBuilder, Guild, TextChannel } from 'discord.js';
import * as Repo from './repository';
import { isReminderDue, isNewWeek, isNewMonth, isoWeekKey, monthKey } from './weekUtils';

// ── Ticket hook ──────────────────────────────────────────────────────────────

/**
 * Call this once, right where a ticket gets marked as closed.
 *
 * In this project that's `closeTicket()` in `modules/tickets/service.ts`,
 * step 5 ("Persist closed state") — right next to the existing
 * `Repo.logActivity({ ..., event: ActivityEvent.Closed })` call.
 *
 * `openerId` is passed so a staff member closing their OWN ticket doesn't
 * inflate their stats — self-closes are silently ignored.
 */
export function recordTicketClosed(guildId: string, closedByUserId: string, openerId: string): void {
  if (closedByUserId === openerId) return; // self-close, not a staff action
  const cfg = Repo.getConfig(guildId);
  if (!cfg.ticketsEnabled) return;
  Repo.incrementTicketClose(guildId, closedByUserId);
}

// ── Sponsor hook ─────────────────────────────────────────────────────────────

/**
 * Call this from wherever a giveaway sponsor gets registered — either your
 * existing giveaway-sponsor flow, or the `/team-activity sponsor` subcommand
 * shipped alongside this module.
 */
export function registerSponsor(
  guildId: string,
  sponsorUserId: string,
  donation: string,
  registeredByUserId: string,
): { ok: boolean; reason?: string } {
  const cfg = Repo.getConfig(guildId);
  if (!cfg.sponsorsEnabled) return { ok: false, reason: 'disabled' };
  Repo.addSponsor(guildId, sponsorUserId, donation.slice(0, 200), registeredByUserId);
  return { ok: true };
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

export function buildLeaderboardEmbed(guild: Guild, period: Repo.LeaderboardPeriod): EmbedBuilder {
  const rows = Repo.getLeaderboard(guild.id, period, 10);
  const title = period === 'weekly' ? '🏆 Staff Leaderboard — This Week' : '🏆 Staff Leaderboard — All Time';

  if (rows.length === 0) {
    return new EmbedBuilder()
      .setTitle(title)
      .setColor('#ff6b35')
      .setDescription('No activity recorded yet.')
      .setTimestamp();
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => {
    const rank = medals[i] ?? `**${i + 1}.**`;
    const tickets  = period === 'weekly' ? r.weekly_tickets  : r.total_tickets;
    const sponsors = period === 'weekly' ? r.weekly_sponsors : r.total_sponsors;
    const parts = [`${tickets} 🎫`];
    if (sponsors > 0) parts.push(`${sponsors} 🎁`);
    return `${rank} <@${r.user_id}> — ${parts.join(' · ')}`;
  });

  return new EmbedBuilder()
    .setTitle(title)
    .setColor('#ff6b35')
    .setDescription(lines.join('\n'))
    .setFooter({ text: period === 'weekly' ? 'Resets every Monday 00:00 UTC' : 'Cumulative, never resets' })
    .setTimestamp();
}

async function postLeaderboard(guild: Guild, period: Repo.LeaderboardPeriod): Promise<void> {
  const cfg = Repo.getConfig(guild.id);
  if (!cfg.leaderboardChannel) return;
  const ch = guild.channels.cache.get(cfg.leaderboardChannel) as TextChannel | undefined;
  if (!ch || !ch.isTextBased()) return;
  await ch.send({ embeds: [buildLeaderboardEmbed(guild, period)] }).catch(() => {});
}

// ── Weekly quota reminder ────────────────────────────────────────────────────

async function sendQuotaReminders(guild: Guild): Promise<void> {
  const cfg = Repo.getConfig(guild.id);
  if (!cfg.quotaEnabled) return;

  // Figure out who counts as "team": the configured role if set, otherwise
  // everyone who already has a staff_activity row (i.e. has closed >=1 ticket ever).
  let teamMemberIds: string[];
  if (cfg.quotaRole) {
    const role = await guild.roles.fetch(cfg.quotaRole).catch(() => null);
    if (!role) return;
    teamMemberIds = [...role.members.keys()];
  } else {
    teamMemberIds = Repo.getAllActivity(guild.id).map(r => r.user_id);
  }

  const activityByUser = new Map(Repo.getAllActivity(guild.id).map(r => [r.user_id, r]));

  for (const userId of teamMemberIds) {
    const weeklyTickets = activityByUser.get(userId)?.weekly_tickets ?? 0;
    if (weeklyTickets >= cfg.quotaMinTickets) continue;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) continue;

    const missing = cfg.quotaMinTickets - weeklyTickets;
    const embed = new EmbedBuilder()
      .setTitle('👋 Weekly ticket goal reminder')
      .setColor('#ff6b35')
      .setDescription(
        `Just a friendly heads-up from **${guild.name}** — you're at **${weeklyTickets}/${cfg.quotaMinTickets}** ` +
        `closed tickets this week (${missing} to go). No pressure, just a nudge before the week resets! 🎫`,
      )
      .setTimestamp();

    await member.send({ embeds: [embed] }).catch(() => {
      // DMs closed — silently skip, this is a friendly nudge, not an enforcement system.
    });
  }
}

// ── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Call this once from a `setInterval` in your scheduler (e.g. every 15 min,
 * see `handlers/schedulers.ts`). Cheap no-op for guilds with everything
 * disabled, and every action is individually guarded so it only fires once
 * per week/month thanks to the stored `staff_last_*` guards.
 */
export async function runStaffActivityTick(guilds: Map<string, Guild>): Promise<void> {
  const now = new Date();
  const activeGuildIds = Repo.getActiveGuildIds();

  for (const guildId of activeGuildIds) {
    const guild = guilds.get(guildId);
    if (!guild) continue;

    const cfg = Repo.getConfig(guildId);

    // 1. Quota reminder — fires once, at the configured weekday+hour.
    if (cfg.quotaEnabled && isReminderDue(cfg.quotaReminderDay, cfg.quotaReminderHour, cfg.lastReminderWeek, now)) {
      try {
        await sendQuotaReminders(guild);
      } catch (err) {
        console.error(`[StaffActivity] Reminder failed for ${guildId}:`, err);
      }
      Repo.setLastReminderWeek(guildId, isoWeekKey(now));
    }

    // 2. Weekly reset — always runs once per week, independent of the quota toggle.
    if (isNewWeek(cfg.lastResetWeek, now)) {
      Repo.resetWeeklyCounters(guildId);
      Repo.setLastResetWeek(guildId, isoWeekKey(now));
    }

    // 3. Auto-posted leaderboard — weekly / monthly / manual (manual = never auto-posts).
    if (cfg.leaderboardEnabled && cfg.leaderboardChannel) {
      if (cfg.leaderboardInterval === 'weekly' && isNewWeek(cfg.lastLeaderboardPeriod, now)) {
        await postLeaderboard(guild, 'weekly').catch(() => {});
        Repo.setLastLeaderboardPeriod(guildId, isoWeekKey(now));
      } else if (cfg.leaderboardInterval === 'monthly' && isNewMonth(cfg.lastLeaderboardPeriod, now)) {
        await postLeaderboard(guild, 'total').catch(() => {});
        Repo.setLastLeaderboardPeriod(guildId, monthKey(now));
      }
    }
  }
}
