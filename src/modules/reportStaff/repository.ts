/**
 * modules/reportStaff/repository.ts
 * Pure data-access layer for the /report-staff feature.
 */

import db, { getGuild } from '../../database/db';

export interface ReportStaffConfig {
  staffRole: string | null;   // role whose members are reportable
  logChannel: string | null;  // where finished reports get posted
  viewerRole: string | null;  // "High Staff/Admin" role allowed to see the log channel
}

export function getConfig(guildId: string): ReportStaffConfig {
  const g = getGuild(guildId) as {
    report_staff_role: string | null;
    report_log_channel: string | null;
    report_viewer_role: string | null;
  };
  return {
    staffRole:  g.report_staff_role ?? null,
    logChannel: g.report_log_channel ?? null,
    viewerRole: g.report_viewer_role ?? null,
  };
}

export function isConfigured(cfg: ReportStaffConfig): boolean {
  return !!(cfg.staffRole && cfg.logChannel && cfg.viewerRole);
}

export function recordReport(guildId: string, reporterId: string, accusedId: string, reason: string): void {
  db.prepare(
    'INSERT INTO staff_reports (guild_id, reporter_id, accused_id, reason) VALUES (?, ?, ?, ?)',
  ).run(guildId, reporterId, accusedId, reason);
}
