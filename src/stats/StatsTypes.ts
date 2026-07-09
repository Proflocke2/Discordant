/**
 * STATS TYPES
 * Alle Interfaces und Enums für das Server-Statistik-System.
 */

// ── Stat-Kanaltypen ─────────────────────────────────────────────────────────

export type StatChannelType =
  | 'total'       // Gesamt-Mitglieder (Menschen + Bots)
  | 'humans'      // Nur echte Menschen
  | 'bots'        // Nur Bots
  | 'online'      // Online-Mitglieder (requires GUILD_PRESENCES intent)
  | 'boosts'      // Server-Boosts
  | 'boost_level' // Boost-Level (0–3)
  | 'role';       // Mitglieder mit einer bestimmten Rolle

// ── Gespeicherte Kanal-Konfiguration ────────────────────────────────────────

export interface StatChannel {
  channelId: string;
  type: StatChannelType;
  template: string;   // z. B. "👥 Mitglieder: {value}"
  roleId?: string;    // Nur für type = 'role'
}

// ── Guild-Konfig in der DB ───────────────────────────────────────────────────

export interface StatsConfig {
  guildId: string;
  channels: StatChannel[];   // JSON-Array der Stat-Kanäle
  updatedAt: number;         // Unix-Timestamp (ms) letztes Update
}

// ── Echtzeitwerte ───────────────────────────────────────────────────────────

export interface GuildStats {
  total: number;
  humans: number;
  bots: number;
  online: number;
  boosts: number;
  boostLevel: number;
  roles: Record<string, number>;  // roleId → member count
}

// ── Standard-Templates ──────────────────────────────────────────────────────
// Wird als Marker in der DB gespeichert.
// Beim Rendern wird dieser Wert durch den lokalisierten Text ersetzt.

export const DEFAULT_TEMPLATE_SENTINEL = '__default__';

/** Für Rückwärtskompatibilität: Alte hardcoded Templates erkennen */
export const LEGACY_DEFAULT_TEMPLATES: string[] = [
  '👥 Mitglieder: {value}', '🧑 Menschen: {value}', '🤖 Bots: {value}',
  '🟢 Online: {value}', '🚀 Boosts: {value}', '⭐ Boost-Level: {value}', '🎭 {role}: {value}',
  '👥 Members: {value}', '🧑 Humans: {value}', '🟢 Online: {value}',
  '🚀 Boosts: {value}', '⭐ Boost Level: {value}',
];
