/**
 * BACKUP — snapshot service.
 *
 * createSnapshot   — serialize all guild config to JSON, save to disk + DB
 * restoreSnapshot  — re-apply a saved snapshot (INSERT OR REPLACE per row)
 * exportSnapshot   — return JSON for /backup export
 * importSnapshot   — accept uploaded JSON, persist as a new version
 *
 * File naming: snapshot-{guild}-{version}-{ts}.json — versioned + timestamped,
 * NEVER overwritten.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import db from '../../database/db';
import * as Repo from './repository';
import { latestKnownVersion } from './migrations';
import { isoWeekKey } from '../staffActivity/weekUtils';
import { AttachmentBuilder, EmbedBuilder, type Guild } from 'discord.js';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

/**
 * Tables that store per-guild config AND content. Anything in this list is
 * included in a snapshot. Add new tables here as the bot grows.
 *
 * Deliberately EXCLUDED (ephemeral/log noise, meaningless or harmful to
 * restore): automod_log, verify_log, sessions, wordle_sessions,
 * attacksim_log, attacksim_snapshot, raidsim_messages, sim_state,
 * schema_migrations, and the snapshots table itself (self-referential).
 */
const GUILD_TABLES = [
  'guilds',
  // Ticket system — panels, categories, forms, multi-panels, settings, live
  // tickets, tags, types, and the actual transcript TEXT of every ticket.
  'panels', 'panel_v2', 'panel_v2_cat', 'panel_v2_form', 'panel_v2_multi',
  'ticket_settings', 'tickets', 'ticket_messages', 'ticket_tags', 'ticket_types',
  'ticket_activity', 'ticket_surveys',
  // Economy — balances, streaks, shop, admin log, guild-wide settings
  'economy_users', 'daily_streaks', 'shop_items', 'shop_inventory',
  'eco_guild_settings', 'eco_admin_log', 'lottery', 'lottery_tickets',
  // Security & moderation
  'security_config', 'security_incidents', 'security_lockdown_state',
  'antinuke_config', 'antinuke_whitelist', 'antinuke_incidents',
  'anti_raid_config', 'automod3_config',
  'warnings', 'warn_config', 'mod_notes', 'sticky_mutes',
  'lockdown_channels', 'user_slowmode', 'inactivity_config', 'member_activity',
  // Reaction roles
  'reaction_role_panels', 'reaction_role_buttons',
  // Utility — saved text content lives here too (webhooks, quotes, polls)
  'saved_webhooks',
  'giveaways',
  'reminders',
  'quoteboard_config', 'quotes',
  'polls',
  // Staff activity tracking
  'staff_activity', 'staff_sponsors',
  // Sticky messages
  'sticky_messages',
  // Staff reports
  'staff_reports',
  // Welcome & verification
  'welcome_settings', 'welcome_pending_roles',
  'verification_config',
  // Levels & stats
  'users',
  'stats_config', 'stats_channels',
  // Applications & multi-panels — includes the actual submitted answer TEXT
  'multipanels', 'multipanel_options',
  'applications', 'application_answers',
] as const;

const GUILD_TABLES_SET = new Set<string>(GUILD_TABLES);
function safeTableName(table: string): string {
  if (!GUILD_TABLES_SET.has(table)) throw new Error(`[backup] Rejected unknown table: ${table}`);
  return table;
}


interface SnapshotPayload {
  schemaVersion: string;
  guildId: string;
  version: string;
  createdAt: number;
  data: Record<string, unknown[]>;
}

function nextVersion(guildId: string): string {
  const existing = Repo.listForGuild(guildId);
  if (existing.length === 0) return `${latestKnownVersion()}-1`;
  // Find highest -N suffix
  const re = /^(.+)-(\d+)$/;
  const max = existing.reduce((acc, s) => {
    const m = re.exec(s.version);
    if (!m) return acc;
    const n = parseInt(m[2], 10);
    return n > acc ? n : acc;
  }, 0);
  return `${latestKnownVersion()}-${max + 1}`;
}

function dumpGuildData(guildId: string): { data: Record<string, unknown[]>; rows: number; tables: number } {
  const out: Record<string, unknown[]> = {};
  let rows = 0;
  let tables = 0;
  for (const table of GUILD_TABLES) {
    try {
      // Skip tables that don't have a guild_id column gracefully.
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (cols.length === 0) continue;
      const hasGuild = cols.some(c => c.name === 'guild_id');
      const hasIdAsGuild = table === 'guilds';
      let r: unknown[];
      if (table === 'ticket_messages') {
        // No guild_id column of its own — scoped via tickets.guild_id instead.
        // This is where the actual ticket TRANSCRIPT TEXT lives.
        r = db.prepare(
          'SELECT * FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE guild_id = ?)',
        ).all(guildId);
      } else if (hasGuild) r = db.prepare(`SELECT * FROM ${table} WHERE guild_id = ?`).all(guildId);
      else if (hasIdAsGuild) r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).all(guildId);
      else r = [];
      out[table] = r;
      rows += r.length;
      tables += 1;
    } catch {
      out[table] = [];
    }
  }
  return { data: out, rows, tables };
}

export function createSnapshot(guildId: string): { version: string; file: string; rows: number; tables: number } {
  const version = nextVersion(guildId);
  const ts = Date.now();
  const filename = `snapshot-${guildId}-${version}-${ts}.json`;
  const filepath = path.join(BACKUP_DIR, filename);

  const { data, rows, tables } = dumpGuildData(guildId);
  const payload: SnapshotPayload = {
    schemaVersion: latestKnownVersion(),
    guildId,
    version,
    createdAt: ts,
    data,
  };

  writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf-8');
  Repo.recordSnapshot({
    guild_id: guildId, version, file_path: filepath,
    rows, tables,
  });
  return { version, file: filename, rows, tables };
}

export function readSnapshotPayload(filePath: string): SnapshotPayload {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as SnapshotPayload;
}

export function restoreSnapshot(guildId: string, version: string): { rows: number; failed: number } {
  const meta = Repo.getByVersion(guildId, version);
  if (!meta) throw new Error(`snapshot not found: ${version}`);
  const payload = readSnapshotPayload(meta.file_path);
  return applyPayload(guildId, payload);
}

const ALLOWED_IMPORT_TABLES = new Set<string>(GUILD_TABLES);

export function applyPayload(guildId: string, payload: SnapshotPayload): { rows: number; failed: number } {
  if (payload.guildId !== guildId) throw new Error('snapshot belongs to a different guild');

  let rows = 0;
  let failed = 0;

  // SECURITY FIX: build per-table column allowlists from the live schema before the
  // transaction so JSON-supplied column names are never interpolated raw into SQL.
  const tableColumns = new Map<string, Set<string>>();
  for (const table of ALLOWED_IMPORT_TABLES) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      tableColumns.set(table, new Set(cols.map(c => c.name)));
    } catch { tableColumns.set(table, new Set()); }
  }

  const tx = db.transaction(() => {
    for (const [table, list] of Object.entries(payload.data)) {
      if (!ALLOWED_IMPORT_TABLES.has(table)) continue;
      if (!Array.isArray(list) || list.length === 0) continue;
      const allowedCols = tableColumns.get(table) ?? new Set<string>();
      for (const r of list as Record<string, unknown>[]) {
        try {
          // Only include columns that exist in the live schema — no raw JSON keys in SQL
          const cols = Object.keys(r).filter(c => allowedCols.has(c));
          if (!cols.length) { failed++; continue; }
          const placeholders = cols.map(() => '?').join(', ');
          const values = cols.map(k => r[k] as any);
          db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
          rows++;
        } catch { failed++; }
      }
    }
  });
  tx();
  return { rows, failed };
}

export function importSnapshotJson(guildId: string, json: string): { version: string; rows: number; tables: number } {
  let payload: SnapshotPayload;
  try {
    payload = JSON.parse(json) as SnapshotPayload;
  } catch {
    throw new Error('invalid JSON');
  }
  if (!payload || typeof payload !== 'object' || !payload.guildId || !payload.data) {
    throw new Error('invalid snapshot');
  }
  if (payload.guildId !== guildId) throw new Error('wrong-guild');

  // Persist as a new versioned snapshot in our store
  const version = nextVersion(guildId);
  const ts = Date.now();
  const filename = `snapshot-${guildId}-${version}-${ts}.imported.json`;
  const filepath = path.join(BACKUP_DIR, filename);
  payload.version = version;
  writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf-8');

  const tables = Object.keys(payload.data).length;
  const rows = Object.values(payload.data).reduce(
    (a, list) => a + (Array.isArray(list) ? list.length : 0), 0,
  );
  Repo.recordSnapshot({ guild_id: guildId, version, file_path: filepath, rows, tables });
  return { version, rows, tables };
}

export function deleteSnapshot(guildId: string, version: string): void {
  Repo.deleteByVersion(guildId, version);
  // We deliberately keep the JSON file on disk — never overwrite, never delete.
}

// ── Auto-Backup scheduler ────────────────────────────────────────────────────

/** Day key, e.g. '2026-07-09' — UTC, so it behaves the same everywhere. */
function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function isAutoBackupDue(interval: 'daily' | 'weekly', lastRun: string | null, now: Date): boolean {
  const currentKey = interval === 'daily' ? dayKey(now) : isoWeekKey(now);
  return lastRun !== currentKey;
}

/**
 * Call this once from a scheduler (e.g. every hour). For every guild with
 * auto-backup enabled, creates a snapshot once per day/week and delivers it
 * either to a channel or by DM, per that guild's configuration.
 */
export async function runAutoBackupTick(guilds: Map<string, Guild>): Promise<void> {
  const now = new Date();
  const guildIds = Repo.getAutoBackupGuildIds();

  for (const guildId of guildIds) {
    const guild = guilds.get(guildId);
    if (!guild) continue;

    const cfg = Repo.getAutoBackupConfig(guildId);
    if (!cfg.enabled) continue;
    if (!isAutoBackupDue(cfg.interval, cfg.lastRun, now)) continue;

    try {
      const snap = createSnapshot(guildId);
      const meta = Repo.getByVersion(guildId, snap.version);
      if (!meta) continue;

      const buf = Buffer.from(readFileSync(meta.file_path));
      const attachment = new AttachmentBuilder(buf, { name: `auto-backup-${guildId}-${snap.version}.json` });
      const embed = new EmbedBuilder()
        .setTitle('📦 Automatic backup')
        .setColor('#ff6b35')
        .setDescription(
          `**${guild.name}** — version \`${snap.version}\`\n` +
          `${snap.tables} tables • ${snap.rows} rows\n\nThis includes all server settings AND text content ` +
          '(ticket transcripts, tags, applications, quotes, etc).',
        )
        .setTimestamp();

      if (cfg.delivery === 'channel' && cfg.channel) {
        const ch = guild.channels.cache.get(cfg.channel);
        if (ch && ch.isTextBased()) {
          await ch.send({ embeds: [embed], files: [attachment] }).catch(() => {});
        }
      } else if (cfg.delivery === 'dm' && cfg.recipient) {
        const member = await guild.members.fetch(cfg.recipient).catch(() => null);
        if (member) {
          await member.send({ embeds: [embed], files: [attachment] }).catch(() => {
            // DMs closed — the snapshot is still safely saved server-side (/backup list).
          });
        }
      }
    } catch (err) {
      console.error(`[AutoBackup] Failed for guild ${guildId}:`, err);
    } finally {
      // Mark as run even on delivery failure — the snapshot itself succeeded
      // and we don't want to spam retries every scheduler tick.
      Repo.setAutoBackupLastRun(guildId, cfg.interval === 'daily' ? dayKey(now) : isoWeekKey(now));
    }
  }
}
