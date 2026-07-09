/**
 * modules/staffActivity/repository.ts
 *
 * Pure data-access layer for the Staff Activity Tracking extension.
 * No Discord.js imports here on purpose — keeps this testable and reusable
 * outside of an interaction/event context (e.g. from the scheduler).
 */

import db, { getGuild, setGuildValue } from '../../database/db';

export interface StaffActivityConfig {
  ticketsEnabled: boolean;
  sponsorsEnabled: boolean;
  leaderboardEnabled: boolean;
  leaderboardInterval: 'weekly' | 'monthly' | 'manual';
  leaderboardChannel: string | null;
  quotaEnabled: boolean;
  quotaMinTickets: number;
  quotaRole: string | null;
  quotaReminderDay: number;   // 0=Sunday..6=Saturday (UTC)
  quotaReminderHour: number;  // 0-23 (UTC)
  lastResetWeek: string | null;
  lastReminderWeek: string | null;
  lastLeaderboardPeriod: string | null;
}

export interface StaffActivityRow {
  guild_id: string;
  user_id: string;
  weekly_tickets: number;
  total_tickets: number;
  weekly_sponsors: number;
  total_sponsors: number;
}

/** Reads all staff-activity related config for a guild (creates the guild row if missing). */
export function getConfig(guildId: string): StaffActivityConfig {
  const g = getGuild(guildId);
  return {
    ticketsEnabled:        !!g.staff_tracking_tickets_enabled,
    sponsorsEnabled:       !!g.staff_tracking_sponsors_enabled,
    leaderboardEnabled:    !!g.staff_leaderboard_enabled,
    leaderboardInterval:   (g.staff_leaderboard_interval ?? 'manual') as StaffActivityConfig['leaderboardInterval'],
    leaderboardChannel:    g.staff_leaderboard_channel ?? null,
    quotaEnabled:          !!g.staff_quota_enabled,
    quotaMinTickets:       g.staff_quota_min_tickets ?? 5,
    quotaRole:             g.staff_quota_role ?? null,
    quotaReminderDay:      g.staff_quota_reminder_day ?? 6,
    quotaReminderHour:     g.staff_quota_reminder_hour ?? 18,
    lastResetWeek:         g.staff_last_reset_week ?? null,
    lastReminderWeek:      g.staff_last_reminder_week ?? null,
    lastLeaderboardPeriod: g.staff_last_leaderboard_period ?? null,
  };
}

/** Generic setter re-exported for the /team-activity config subcommand. */
export function setConfigValue(
  guildId: string,
  key:
    | 'staff_tracking_tickets_enabled' | 'staff_tracking_sponsors_enabled'
    | 'staff_leaderboard_enabled' | 'staff_leaderboard_interval' | 'staff_leaderboard_channel'
    | 'staff_quota_enabled' | 'staff_quota_min_tickets' | 'staff_quota_role'
    | 'staff_quota_reminder_day' | 'staff_quota_reminder_hour',
  value: unknown,
): void {
  setGuildValue(guildId, key, value);
}

function getOrCreateRow(guildId: string, userId: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO staff_activity (guild_id, user_id) VALUES (?, ?)',
  ).run(guildId, userId);
}

/** +1 weekly & total ticket count for a staff member. */
export function incrementTicketClose(guildId: string, userId: string): void {
  getOrCreateRow(guildId, userId);
  db.prepare(`
    UPDATE staff_activity
    SET weekly_tickets = weekly_tickets + 1,
        total_tickets  = total_tickets + 1,
        updated_at     = unixepoch()
    WHERE guild_id = ? AND user_id = ?
  `).run(guildId, userId);
}

/** Registers a sponsor donation and +1's the registering staff member's sponsor count. */
export function addSponsor(
  guildId: string,
  sponsorUserId: string,
  donation: string,
  registeredBy: string,
): void {
  db.prepare(
    'INSERT INTO staff_sponsors (guild_id, user_id, donation, registered_by) VALUES (?, ?, ?, ?)',
  ).run(guildId, sponsorUserId, donation, registeredBy);

  getOrCreateRow(guildId, registeredBy);
  db.prepare(`
    UPDATE staff_activity
    SET weekly_sponsors = weekly_sponsors + 1,
        total_sponsors  = total_sponsors + 1,
        updated_at      = unixepoch()
    WHERE guild_id = ? AND user_id = ?
  `).run(guildId, registeredBy);
}

export type LeaderboardPeriod = 'weekly' | 'total';

/** Top N staff members for this guild, ranked by tickets+sponsors for the given period. */
export function getLeaderboard(guildId: string, period: LeaderboardPeriod, limit = 10): StaffActivityRow[] {
  const ticketCol  = period === 'weekly' ? 'weekly_tickets'  : 'total_tickets';
  const sponsorCol = period === 'weekly' ? 'weekly_sponsors' : 'total_sponsors';
  return db.prepare(`
    SELECT * FROM staff_activity
    WHERE guild_id = ? AND (${ticketCol} > 0 OR ${sponsorCol} > 0)
    ORDER BY (${ticketCol} + ${sponsorCol}) DESC
    LIMIT ?
  `).all(guildId, limit) as StaffActivityRow[];
}

/** All staff-activity rows for a guild (used by the quota check). */
export function getAllActivity(guildId: string): StaffActivityRow[] {
  return db.prepare('SELECT * FROM staff_activity WHERE guild_id = ?').all(guildId) as StaffActivityRow[];
}

/** Resets weekly_tickets and weekly_sponsors to 0 for every staff member in this guild. Totals are untouched. */
export function resetWeeklyCounters(guildId: string): void {
  db.prepare(
    'UPDATE staff_activity SET weekly_tickets = 0, weekly_sponsors = 0, updated_at = unixepoch() WHERE guild_id = ?',
  ).run(guildId);
}

/** Every guild that has ANY staff-activity feature switched on — the scheduler only needs to look at these. */
export function getActiveGuildIds(): string[] {
  const rows = db.prepare(`
    SELECT id FROM guilds
    WHERE staff_tracking_tickets_enabled = 1
       OR staff_tracking_sponsors_enabled = 1
       OR staff_leaderboard_enabled = 1
       OR staff_quota_enabled = 1
  `).all() as Array<{ id: string }>;
  return rows.map(r => r.id);
}

// ── Internal scheduler bookkeeping ───────────────────────────────────────────
// These three are written only by the scheduler itself (never by a command),
// so they're deliberately kept out of the public setConfigValue() whitelist
// and use direct, fixed-column UPDATEs instead.

export function setLastResetWeek(guildId: string, weekKey: string): void {
  db.prepare('UPDATE guilds SET staff_last_reset_week = ? WHERE id = ?').run(weekKey, guildId);
}

export function setLastReminderWeek(guildId: string, weekKey: string): void {
  db.prepare('UPDATE guilds SET staff_last_reminder_week = ? WHERE id = ?').run(weekKey, guildId);
}

export function setLastLeaderboardPeriod(guildId: string, periodKey: string): void {
  db.prepare('UPDATE guilds SET staff_last_leaderboard_period = ? WHERE id = ?').run(periodKey, guildId);
}
