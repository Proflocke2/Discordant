/**
 * BACKUP — migration runner.
 *
 * Forward-only schema migrations. New versions append below; once applied
 * (tracked in schema_migrations) they're never re-run.
 *
 * Naming: semver-like "MAJOR.MINOR.PATCH". Bump PATCH for additive column
 * adds, MINOR for new tables, MAJOR for breaking changes.
 */

import db from '../../database/db';
import * as Repo from './repository';

interface Migration {
  version: string;
  description: string;
  up: () => void;
}

const migrations: Migration[] = [
  {
    version: '1.0.0',
    description: 'Initial schema baseline (no-op — created by db.ts on first boot)',
    up: () => { /* baseline */ },
  },
  {
    version: '1.1.0',
    description: 'Add ticket_settings + welcome_settings + panel_v2_form tables',
    up: () => {
      // These tables are guarded with CREATE TABLE IF NOT EXISTS in their
      // module repos — running this migration just records the version.
    },
  },
  {
    version: '1.2.0',
    description: 'Music module removed — no-op',
    up: () => { /* music module was removed */ },
  },
  {
    version: '2.0.0',
    description: 'Economy fixes: BJ timeout, atomic ticket insert, memory leak guards',
    up: () => { /* applied via deployGuard column migrations and code fixes */ },
  },
  {
    version: '2.1.0',
    description: 'Deployment guard: auto config-protection snapshot system',
    up: () => { /* deployGuard.ts handles column safety; recorded here for version tracking */ },
  },
  {
    version: '2.2.0',
    description: 'Per-guild command disable/enable (disabled_commands table)',
    up: () => { /* table is guarded with CREATE TABLE IF NOT EXISTS in db.ts */ },
  },
  {
    version: '2.3.0',
    description: 'Persistent kick/timeout history for /history (mod_history table)',
    up: () => { /* table is guarded with CREATE TABLE IF NOT EXISTS in db.ts */ },
  },
];

/**
 * Run all pending migrations. Idempotent — already-applied versions are skipped.
 * Returns { from, to, applied[] } so callers can report.
 */
export function runMigrations(): { from: string; to: string; applied: string[] } {
  const applied: string[] = [];
  const before = currentVersion();

  for (const m of migrations) {
    if (Repo.isMigrationApplied(m.version)) continue;
    try {
      m.up();
      Repo.markMigrationApplied(m.version);
      applied.push(m.version);
      console.log(`[Migrations] Applied ${m.version} — ${m.description}`);
    } catch (err) {
      console.error(`[Migrations] FAILED at ${m.version}:`, err);
      throw new Error(`Migration ${m.version} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const after = currentVersion();
  return { from: before, to: after, applied };
}

export function currentVersion(): string {
  const all = Repo.listAppliedMigrations();
  return all.length > 0 ? all[all.length - 1] : '0.0.0';
}

export function latestKnownVersion(): string {
  return migrations[migrations.length - 1].version;
}

export function listMigrations(): ReadonlyArray<Pick<Migration, 'version' | 'description'>> {
  return migrations.map(({ version, description }) => ({ version, description }));
}
