import { CompatDatabase } from './sqlite-compat';
import path from 'path';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'bot.db');
const db = new CompatDatabase(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// RAM efficiency: keep SQLite's own page cache small and force temp b-trees/sorts
// to spill to disk instead of RAM — this bot's queries are small/simple (per-guild
// lookups), so there's no real performance cost to a tight cache on a 512MB host.
db.pragma('cache_size = -2000'); // negative = KB, so ~2MB page cache cap
db.pragma('temp_store = FILE');

db.exec(`
  CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    prefix TEXT DEFAULT '!',
    mod_log_channel TEXT,
    welcome_channel TEXT,
    welcome_message TEXT,
    welcome_embed INTEGER DEFAULT 1,
    welcome_color TEXT DEFAULT '#5865f2',
    welcome_role TEXT,
    automod_enabled INTEGER DEFAULT 0,
    automod_antilink INTEGER DEFAULT 0,
    automod_antispam INTEGER DEFAULT 0,
    automod_badwords TEXT DEFAULT '[]',
    log_channel TEXT,
    mute_role TEXT,
    level_enabled INTEGER DEFAULT 1,
    level_channel TEXT,
    level_roles TEXT DEFAULT '{}',
    language TEXT DEFAULT 'en',
    embed_color TEXT DEFAULT '#5865f2',
    automod_antiinvite INTEGER DEFAULT 0,
    automod_anticaps INTEGER DEFAULT 0,
    gambling_cooldown_ms INTEGER DEFAULT 15000,
    gambling_disclaimer INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    panel_id INTEGER,
    number INTEGER NOT NULL,
    status TEXT DEFAULT 'open',
    claimed_by TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    closed_at INTEGER,
    last_ticket_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#5865f2',
    emoji TEXT DEFAULT '🎫',
    button_text TEXT DEFAULT 'Open Ticket',
    category_id TEXT,
    support_roles TEXT DEFAULT '[]',
    message_id TEXT,
    channel_id TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    messages INTEGER DEFAULT 0,
    last_xp INTEGER DEFAULT 0,
    PRIMARY KEY (id, guild_id)
  );
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    questions TEXT NOT NULL,
    accept_role TEXT,
    review_channel TEXT,
    dm_message TEXT,
    button_label TEXT DEFAULT 'Apply Now',
    active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS application_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    answers TEXT NOT NULL,
    status TEXT,
    reviewed_by TEXT,
    reviewed_at INTEGER,
    review_reason TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT UNIQUE,
    prize TEXT NOT NULL,
    winners INTEGER DEFAULT 1,
    host_id TEXT NOT NULL,
    ends_at INTEGER NOT NULL,
    ended INTEGER DEFAULT 0,
    participants TEXT DEFAULT '[]',
    winner_ids TEXT DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message TEXT NOT NULL,
    remind_at INTEGER NOT NULL,
    done INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS automod_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS verification_config (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    unverified_role_id TEXT,
    verified_role_id TEXT NOT NULL,
    verification_channel_id TEXT NOT NULL,
    log_channel_id TEXT,
    message TEXT DEFAULT 'Click below to verify',
    button_label TEXT DEFAULT 'Verify',
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS stats_config (
    guild_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    members_channel TEXT,
    bots_channel TEXT,
    boosts_channel TEXT,
    embed_channel TEXT,
    embed_message_id TEXT
  );
  CREATE TABLE IF NOT EXISTS multipanels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id TEXT UNIQUE NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#5865f2',
    option_ids TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS multipanel_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    option_id TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    category_id TEXT NOT NULL,
    support_roles TEXT NOT NULL,
    welcome_message TEXT,
    emoji TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_multipanels_guild ON multipanels(guild_id);
  CREATE INDEX IF NOT EXISTS idx_multipanels_channel ON multipanels(channel_id);

  -- ── Staff Activity Tracking ──────────────────────────────────────────────
  -- One row per (guild, staff member). Weekly counters reset every Monday
  -- 00:00 UTC; total counters are cumulative and never reset.
  CREATE TABLE IF NOT EXISTS staff_activity (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    weekly_tickets INTEGER NOT NULL DEFAULT 0,
    total_tickets INTEGER NOT NULL DEFAULT 0,
    weekly_sponsors INTEGER NOT NULL DEFAULT 0,
    total_sponsors INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, user_id)
  );
  -- One row per registered sponsor/giveaway donation, for a simple history log.
  CREATE TABLE IF NOT EXISTS staff_sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    donation TEXT NOT NULL,
    registered_by TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_staff_activity_guild ON staff_activity(guild_id);
  CREATE INDEX IF NOT EXISTS idx_staff_sponsors_guild ON staff_sponsors(guild_id);

  -- ── Sticky Messages ──────────────────────────────────────────────────────
  -- One row per (guild, channel). The message is re-posted at the bottom of
  -- the channel after every new human message.
  CREATE TABLE IF NOT EXISTS sticky_messages (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    content TEXT NOT NULL,
    message_id TEXT,
    created_by TEXT NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, channel_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sticky_messages_guild ON sticky_messages(guild_id);

  -- ── Staff Reports ────────────────────────────────────────────────────────
  -- Every submitted /report-staff report, kept as a durable audit trail even
  -- if the message in the log channel is later deleted.
  CREATE TABLE IF NOT EXISTS disabled_commands (
    guild_id TEXT NOT NULL,
    command_name TEXT NOT NULL,
    disabled_by TEXT,
    disabled_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (guild_id, command_name)
  );
  CREATE TABLE IF NOT EXISTS mod_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    duration_ms INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_mod_history_guild_user ON mod_history(guild_id, user_id);
  CREATE TABLE IF NOT EXISTS staff_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    accused_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_staff_reports_guild ON staff_reports(guild_id);
`);

export default db;

export function getGuild(id: string) {
  let guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(id) as any;
  if (!guild) {
    db.prepare('INSERT OR IGNORE INTO guilds (id) VALUES (?)').run(id);
    guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(id);
  }
  return guild;
}

const ALLOWED_GUILD_KEYS = new Set([
  'prefix', 'mod_log_channel', 'welcome_channel', 'welcome_message',
  'welcome_embed', 'welcome_color', 'welcome_role', 'automod_enabled',
  'automod_antilink', 'automod_antispam', 'automod_badwords', 'log_channel',
  'mute_role', 'level_enabled', 'level_channel', 'level_roles', 'language',
  'embed_color', 'automod_antiinvite', 'automod_anticaps',
  'gambling_cooldown_ms', 'gambling_disclaimer',
  'staff_tracking_tickets_enabled', 'staff_tracking_sponsors_enabled',
  'staff_leaderboard_enabled', 'staff_leaderboard_interval', 'staff_leaderboard_channel',
  'staff_quota_enabled', 'staff_quota_min_tickets', 'staff_quota_role',
  'staff_quota_reminder_day', 'staff_quota_reminder_hour',
  'staff_last_reset_week', 'staff_last_reminder_week', 'staff_last_leaderboard_period',
  'backup_auto_enabled', 'backup_auto_interval', 'backup_auto_delivery',
  'backup_auto_channel', 'backup_auto_recipient',
  'report_staff_role', 'report_log_channel', 'report_viewer_role',
] as const);

export type GuildKey = typeof ALLOWED_GUILD_KEYS extends Set<infer T> ? T : never;

export function setGuildValue(guildId: string, key: GuildKey, value: unknown): void {
  if (!(ALLOWED_GUILD_KEYS as Set<string>).has(key)) {
    throw new Error(`[DB] Unerlaubter guild key: "${key}"`);
  }
  getGuild(guildId);
  db.prepare(`UPDATE guilds SET ${key} = ? WHERE id = ?`).run(value as any, guildId);
}

export function getUser(userId: string, guildId: string) {
  let user = db.prepare('SELECT * FROM users WHERE id = ? AND guild_id = ?').get(userId, guildId) as any;
  if (!user) {
    db.prepare('INSERT OR IGNORE INTO users (id, guild_id, xp, level, messages, last_xp) VALUES (?, ?, ?, ?, ?, ?)').run(userId, guildId, 0, 0, 0, 0);
    user = db.prepare('SELECT * FROM users WHERE id = ? AND guild_id = ?').get(userId, guildId);
  }
  return user;
}

// ── Per-guild command disable/enable ─────────────────────────────────────────

export function isCommandDisabled(guildId: string, commandName: string): boolean {
  const row = db.prepare(
    'SELECT 1 FROM disabled_commands WHERE guild_id = ? AND command_name = ?',
  ).get(guildId, commandName);
  return !!row;
}

export function disableCommand(guildId: string, commandName: string, disabledBy: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO disabled_commands (guild_id, command_name, disabled_by, disabled_at) VALUES (?, ?, ?, unixepoch())',
  ).run(guildId, commandName, disabledBy);
}

export function enableCommand(guildId: string, commandName: string): boolean {
  const res = db.prepare(
    'DELETE FROM disabled_commands WHERE guild_id = ? AND command_name = ?',
  ).run(guildId, commandName);
  return res.changes > 0;
}

export function listDisabledCommands(guildId: string): string[] {
  const rows = db.prepare(
    'SELECT command_name FROM disabled_commands WHERE guild_id = ? ORDER BY command_name',
  ).all(guildId) as { command_name: string }[];
  return rows.map(r => r.command_name);
}

// ── Moderation history (kick / timeout — warns already live in `warnings`) ───

export type ModAction = 'kick' | 'timeout';

export function logModAction(
  guildId: string,
  userId: string,
  moderatorId: string,
  action: ModAction,
  reason: string,
  durationMs?: number,
): void {
  db.prepare(
    'INSERT INTO mod_history (guild_id, user_id, moderator_id, action, reason, duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(guildId, userId, moderatorId, action, reason, durationMs ?? null);
}

export interface ModHistoryRow {
  action: ModAction;
  moderator_id: string;
  reason: string;
  duration_ms: number | null;
  created_at: number;
}

export function getModHistory(guildId: string, userId: string): ModHistoryRow[] {
  return db.prepare(
    'SELECT action, moderator_id, reason, duration_ms, created_at FROM mod_history WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
  ).all(guildId, userId) as ModHistoryRow[];
}

export function nextTicketNumber(guildId: string) {
  const row = db.prepare('SELECT MAX(number) as max FROM tickets WHERE guild_id = ?').get(guildId) as any;
  return (row?.max ?? 0) + 1;
}

export function initializeVerification() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS verify_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        timestamp INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_verify_log_guild ON verify_log(guild_id);
      CREATE INDEX IF NOT EXISTS idx_verify_log_user ON verify_log(user_id);
    `);
    console.log('[DB] Verification tables initialized successfully');
  } catch (err) {
    console.error('[DB] Failed to initialize verification tables:', err);
  }
}

const DB_TS_ALLOWED_TABLES = new Set<string>(['guilds']);
function hasCol(table: string, col: string): boolean {
  if (!DB_TS_ALLOWED_TABLES.has(table)) return false;
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return info.some((c: any) => c.name === col);
}

if (!hasCol('guilds', 'automod_antiinvite')) {
  try { db.prepare('ALTER TABLE guilds ADD COLUMN automod_antiinvite INTEGER DEFAULT 0').run(); } catch {}
}
if (!hasCol('guilds', 'automod_anticaps')) {
  try { db.prepare('ALTER TABLE guilds ADD COLUMN automod_anticaps INTEGER DEFAULT 0').run(); }  catch {}
}

// ── Staff Activity Tracking config (all default OFF except ticket counting) ─
const STAFF_ACTIVITY_COLUMNS: Array<[string, string]> = [
  ['staff_tracking_tickets_enabled',  "INTEGER DEFAULT 1"],   // count closed tickets per staff member
  ['staff_tracking_sponsors_enabled', "INTEGER DEFAULT 1"],   // count registered giveaway sponsors
  ['staff_leaderboard_enabled',       "INTEGER DEFAULT 0"],   // /team-activity leaderboard + auto-post
  ['staff_leaderboard_interval',      "TEXT DEFAULT 'manual'"], // 'weekly' | 'monthly' | 'manual'
  ['staff_leaderboard_channel',       "TEXT"],                // channel for auto-posted leaderboards
  ['staff_quota_enabled',             "INTEGER DEFAULT 0"],   // weekly minimum ticket goal + reminder
  ['staff_quota_min_tickets',         "INTEGER DEFAULT 5"],
  ['staff_quota_role',                "TEXT"],                // role that marks "team members" to check
  ['staff_quota_reminder_day',        "INTEGER DEFAULT 6"],   // 0=Sunday..6=Saturday (UTC)
  ['staff_quota_reminder_hour',       "INTEGER DEFAULT 18"],  // 0-23 UTC
  ['staff_last_reset_week',           "TEXT"],                // ISO week guard, e.g. '2026-W28'
  ['staff_last_reminder_week',        "TEXT"],                // ISO week guard for quota reminders
  ['staff_last_leaderboard_period',   "TEXT"],                // ISO week/month guard for auto-post
];
for (const [col, def] of STAFF_ACTIVITY_COLUMNS) {
  if (!hasCol('guilds', col)) {
    try { db.prepare(`ALTER TABLE guilds ADD COLUMN ${col} ${def}`).run(); } catch {}
  }
}

// ── Auto-Backup config ───────────────────────────────────────────────────────
const AUTO_BACKUP_COLUMNS: Array<[string, string]> = [
  ['backup_auto_enabled',   "INTEGER DEFAULT 0"],
  ['backup_auto_interval',  "TEXT DEFAULT 'weekly'"], // 'daily' | 'weekly'
  ['backup_auto_delivery',  "TEXT DEFAULT 'channel'"], // 'channel' | 'dm'
  ['backup_auto_channel',   "TEXT"],                   // channel id, used when delivery = channel
  ['backup_auto_recipient', "TEXT"],                   // user id, used when delivery = dm
  ['backup_auto_last_run',  "TEXT"],                   // day/week guard, e.g. '2026-07-09' or '2026-W28'
];
for (const [col, def] of AUTO_BACKUP_COLUMNS) {
  if (!hasCol('guilds', col)) {
    try { db.prepare(`ALTER TABLE guilds ADD COLUMN ${col} ${def}`).run(); } catch {}
  }
}

// ── Report-Staff config ──────────────────────────────────────────────────────
const REPORT_STAFF_COLUMNS: Array<[string, string]> = [
  ['report_staff_role',  "TEXT"], // role whose members appear in the /report-staff select menu
  ['report_log_channel', "TEXT"], // private channel the finished report gets posted to
  ['report_viewer_role', "TEXT"], // "High Staff/Admin" role allowed to see that channel
];
for (const [col, def] of REPORT_STAFF_COLUMNS) {
  if (!hasCol('guilds', col)) {
    try { db.prepare(`ALTER TABLE guilds ADD COLUMN ${col} ${def}`).run(); } catch {}
  }
}

// ── Migration: rebuild tickets table without the old FK on panel_id ─────────
// The old schema had FOREIGN KEY (panel_id) REFERENCES panels(id) which conflicts
// with the v2 panel system (panel_v2 IDs). SQLite cannot DROP CONSTRAINTS, so we
// recreate the table using the rename-copy-drop pattern if the old FK still exists.
(function migrateTicketsTable() {
  try {
    // Detect old FK by checking PRAGMA foreign_key_list — if panel_id → panels exists, migrate.
    const fkList = db.prepare(`PRAGMA foreign_key_list(tickets)`).all() as Array<{ table: string; from: string }>;
    const hasOldPanelFk = fkList.some(fk => fk.from === 'panel_id' && fk.table === 'panels');
    if (!hasOldPanelFk) return; // Already clean — nothing to do.

    console.log('[DB] Migrating tickets table: removing legacy panel_id FK…');

    // Temporarily disable FK enforcement so we can manipulate the table safely.
    db.pragma('foreign_keys = OFF');

    db.exec(`
      -- Step 1: rename the old table
      ALTER TABLE tickets RENAME TO tickets_old_fk;

      -- Step 2: create new table without the FK
      CREATE TABLE tickets (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id         TEXT    NOT NULL,
        channel_id       TEXT    UNIQUE NOT NULL,
        user_id          TEXT    NOT NULL,
        panel_id         INTEGER,
        category_id      INTEGER,
        number           INTEGER NOT NULL,
        status           TEXT    DEFAULT 'open',
        claimed_by       TEXT,
        close_reason     TEXT,
        last_activity_at INTEGER DEFAULT (unixepoch()),
        created_at       INTEGER DEFAULT (unixepoch()),
        closed_at        INTEGER
      );

      -- Step 3: copy all existing rows (NULL-safe for new columns)
      INSERT INTO tickets
        (id, guild_id, channel_id, user_id, panel_id, category_id, number, status, claimed_by, close_reason, last_activity_at, created_at, closed_at)
      SELECT
        id, guild_id, channel_id, user_id, panel_id, NULL, number, status, claimed_by, NULL, created_at, created_at, closed_at
      FROM tickets_old_fk;

      -- Step 4: restore indexes
      CREATE INDEX IF NOT EXISTS idx_tickets_channel      ON tickets(channel_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_guild_usr    ON tickets(guild_id, user_id, status);
      CREATE INDEX IF NOT EXISTS idx_tickets_activity_at  ON tickets(last_activity_at, status);

      -- Step 5: drop old table
      DROP TABLE tickets_old_fk;
    `);

    db.pragma('foreign_keys = ON');
    console.log('[DB] tickets table migrated successfully.');
  } catch (err) {
    db.pragma('foreign_keys = ON');
    console.error('[DB] tickets migration failed (non-fatal, will retry on next start):', err);
  }
})();

