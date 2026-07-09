/**
 * GAMBLING COOLDOWN & SESSION-LIMIT SYSTEM
 *
 * Zwei Schutzmechanismen:
 *  1. Globaler Cooldown  – 15 Sekunden zwischen zwei Gambling-Commands (pro User+Guild)
 *  2. Session-Limit      – max. SESSION_LIMIT Spiele in einem rollierenden 30-Min-Fenster.
 *                          Wird das Limit erreicht, gibt es eine 15-Minuten-Sperre.
 *
 * Alles In-Memory (kein DB-Overhead für einfache Rate-Limits).
 */

export type CooldownReason = 'cooldown' | 'session';

export interface CooldownBlock {
  reason: CooldownReason;
  remainingMs: number;
}

interface Entry {
  /** Timestamp des letzten Spielstarts. */
  lastGame: number;
  /** Timestamps aller Spiele im rollierenden Fenster. */
  sessionGames: number[];
  /** Falls Session-Limit getroffen: gesperrt bis zu diesem Zeitpunkt. */
  lockedUntil?: number;
}

export class GamblingCooldown {
  // ── Konfiguration ──────────────────────────────────────────────────────────
  /** Globaler Cooldown in ms (15 Sekunden). */
  static GLOBAL_CD_MS = 15_000;
  /** Rollendes Zeitfenster für das Session-Limit (30 Minuten). */
  static SESSION_WINDOW_MS = 30 * 60_000;
  /** Sperre nach Erreichen des Session-Limits (15 Minuten). */
  static SESSION_LOCKOUT_MS = 15 * 60_000;
  /**
   * Maximale Anzahl Spiele im SESSION_WINDOW_MS.
   * Wird aus EconomyConfig.SETTINGS.sessionLimit übernommen (Standard: 20).
   */
  static SESSION_LIMIT = 20;

  // ── Interner State ─────────────────────────────────────────────────────────
  private static readonly map = new Map<string, Entry>();

  // FIX: Purge stale entries every 60 minutes to prevent unbounded map growth.
  static { setInterval(() => {
    const cutoff = Date.now() - GamblingCooldown.SESSION_WINDOW_MS;
    for (const [k, e] of GamblingCooldown.map) {
      if (e.lastGame < cutoff && !e.lockedUntil) GamblingCooldown.map.delete(k);
    }
  }, 60 * 60_000); }

  private static key(userId: string, guildId: string): string {
    return `${userId}_${guildId}`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Prüft, ob der User spielen darf.
   * @param cdMs Überschreibt GLOBAL_CD_MS (für per-Guild-Einstellung).
   * @returns `null` wenn alles OK, sonst ein `CooldownBlock`-Objekt.
   */
  static check(userId: string, guildId: string, cdMs?: number): CooldownBlock | null {
    const key  = this.key(userId, guildId);
    const now  = Date.now();
    const entry = this.map.get(key);
    const effectiveCd = cdMs ?? this.GLOBAL_CD_MS;

    if (!entry) return null;

    // ── 1. Session-Sperre prüfen ───────────────────────────────────────────
    if (entry.lockedUntil !== undefined && now < entry.lockedUntil) {
      return { reason: 'session', remainingMs: entry.lockedUntil - now };
    }
    // Abgelaufene Sperre aufräumen
    if (entry.lockedUntil !== undefined && now >= entry.lockedUntil) {
      entry.lockedUntil = undefined;
      entry.sessionGames = [];
    }

    // ── 2. Globaler Cooldown prüfen ───────────────────────────────────────
    const elapsed = now - entry.lastGame;
    if (elapsed < effectiveCd) {
      return { reason: 'cooldown', remainingMs: effectiveCd - elapsed };
    }

    return null;
  }

  /**
   * Trägt ein neues Spiel ein. Muss aufgerufen werden, nachdem `check()` `null`
   * zurückgegeben hat und das Spiel tatsächlich startet.
   */
  static record(userId: string, guildId: string): void {
    const key = this.key(userId, guildId);
    const now = Date.now();

    const entry: Entry = this.map.get(key) ?? {
      lastGame: 0,
      sessionGames: [],
    };

    // Globalen Cooldown-Timestamp setzen
    entry.lastGame = now;

    // Alte Einträge außerhalb des Fensters entfernen
    entry.sessionGames = entry.sessionGames.filter(
      t => now - t < this.SESSION_WINDOW_MS,
    );
    entry.sessionGames.push(now);

    // Session-Limit prüfen und ggf. Sperre setzen
    if (entry.sessionGames.length >= this.SESSION_LIMIT) {
      entry.lockedUntil = now + this.SESSION_LOCKOUT_MS;
      entry.sessionGames = []; // Fenster zurücksetzen
    }

    this.map.set(key, entry);
  }

  /** Setzt alle Cooldowns eines Users zurück (z. B. für Admins). */
  static reset(userId: string, guildId: string): void {
    this.map.delete(this.key(userId, guildId));
  }

  /** Wie viele Spiele hat der User im aktuellen Fenster gespielt? */
  static sessionCount(userId: string, guildId: string): number {
    const entry = this.map.get(this.key(userId, guildId));
    if (!entry) return 0;
    const now = Date.now();
    return entry.sessionGames.filter(t => now - t < this.SESSION_WINDOW_MS).length;
  }
}
