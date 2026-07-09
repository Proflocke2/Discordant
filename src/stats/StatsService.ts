/**
 * STATS SERVICE
 * ──────────────────────────────────────────────────────────────────────────
 * Kernlogik für Echtzeit-Server-Statistiken.
 *
 * RATE-LIMIT-STRATEGIE:
 *   Discord erlaubt max. ~2 Channel-Umbenennungen pro Kanal pro 10 Minuten.
 *   Implementierung: Pro Guild ein Debounce-Timer (UPDATE_INTERVAL = 10 Min).
 *   Kommt ein Event innerhalb des Intervalls an, wird es "aufgestaut" und
 *   erst am Ende des Intervalls abgearbeitet (Batch-Update).
 *
 * WICHTIG: GatewayIntentBits.GuildPresences ist für Online-Zählung nötig
 *          (muss im Discord Developer Portal aktiviert sein).
 * ──────────────────────────────────────────────────────────────────────────
 */

import { Guild, VoiceChannel, ChannelType } from 'discord.js';
import { getStatsConfig, getAllStatsGuildIds } from './StatsDB';
import { GuildStats, StatChannel, StatChannelType, DEFAULT_TEMPLATE_SENTINEL, LEGACY_DEFAULT_TEMPLATES } from './StatsTypes';
import { getGuild } from '../database/db';
import { getLocalized, Language } from '../utils/localization';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Minimale Wartezeit zwischen zwei Updates EINES Kanals (ms). Discord-Limit: 2/10 Min. */
const UPDATE_INTERVAL_MS = 10 * 60 * 1_000;   // 10 Minuten

/** Initiales Delay nach Bot-Start, damit der Cache gefüllt wird */
const STARTUP_DELAY_MS = 15_000;

// ============================================================================
// STATS SERVICE
// ============================================================================

export class StatsService {

  /**
   * Map<guildId, { timer: NodeJS.Timeout | null, pending: boolean }>
   * Speichert den Debounce-State pro Guild.
   */
  private static debounce = new Map<string, {
    timer: ReturnType<typeof setTimeout> | null;
    pending: boolean;
    lastUpdate: number;
  }>();

  // ── Initialisierung ──────────────────────────────────────────────────────

  /**
   * Beim Bot-Start: Alle konfigurierten Guilds sofort aktualisieren.
   * @param getGuild Callback um eine Guild-Instanz zu erhalten
   */
  static async initializeAll(
    getGuild: (id: string) => Guild | undefined
  ): Promise<void> {
    // Delay damit discord.js Cache fertig befüllt ist
    await new Promise(r => setTimeout(r, STARTUP_DELAY_MS));

    const guildIds = getAllStatsGuildIds();
    console.log(`[Stats] Initializing ${guildIds.length} guild(s)...`);

    for (const guildId of guildIds) {
      const guild = getGuild(guildId);
      if (!guild) continue;
      await this.updateAll(guild);
      // Kleines Delay um Rate-Limits zu vermeiden
      await new Promise(r => setTimeout(r, 2_000));
    }

    console.log('[Stats] Initialization complete');
  }

  // ── Öffentliche Trigger-Methode ───────────────────────────────────────────

  /**
   * Wird von Events (guildMemberAdd / guildMemberRemove) aufgerufen.
   * Debounced: Führt das Update erst nach UPDATE_INTERVAL_MS aus.
   */
  static triggerUpdate(guild: Guild): void {
    const guildId = guild.id;

    if (!this.debounce.has(guildId)) {
      this.debounce.set(guildId, { timer: null, pending: false, lastUpdate: 0 });
    }

    const state = this.debounce.get(guildId)!;
    state.pending = true;

    // Bereits ein Timer aktiv? → Nichts tun, der läuft schon
    if (state.timer !== null) return;

    const now         = Date.now();
    const timeSinceLast = now - state.lastUpdate;
    const delay       = Math.max(0, UPDATE_INTERVAL_MS - timeSinceLast);

    state.timer = setTimeout(async () => {
      state.timer  = null;
      state.pending = false;
      state.lastUpdate = Date.now();

      try {
        await this.updateAll(guild);
      } catch (err) {
        console.error(`[Stats] Update failed for ${guildId}:`, err);
      }
    }, delay);

    if (delay > 0) {
      console.log(`[Stats] Update für ${guild.name} in ${Math.round(delay / 1000)}s geplant`);
    }
  }

  /**
   * Erzwingt ein sofortiges Update (z. B. nach /stats refresh).
   * Löscht laufende Debounce-Timer für diese Guild.
   */
  static async forceUpdate(guild: Guild): Promise<void> {
    const state = this.debounce.get(guild.id);
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    await this.updateAll(guild);
    if (state) {
      state.lastUpdate = Date.now();
      state.pending = false;
    }
  }

  // ── Internes Update ───────────────────────────────────────────────────────

  /** Liest Config & Stats und benennt alle Kanäle um */
  private static async updateAll(guild: Guild): Promise<void> {
    const config = getStatsConfig(guild.id);
    if (config.channels.length === 0) return;

    // Mitgliedercache auffrischen (sicherstellen dass alle geladen sind)
    await guild.members.fetch().catch(() => {});

    const stats = this.computeStats(guild);

    const updates = config.channels.map(ch =>
      this.updateChannel(guild, ch, stats)
    );

    // Parallel updaten (alle Kanäle gleichzeitig)
    const results = await Promise.allSettled(updates);
    const failed  = results.filter(r => r.status === 'rejected').length;

    if (failed > 0) {
      console.warn(`[Stats] ${failed}/${results.length} channel updates fehlgeschlagen in ${guild.name}`);
    } else {
      console.log(`[Stats] ${results.length} Kanäle aktualisiert in ${guild.name}`);
    }
  }

  /** Stats-Werte aus dem Cache berechnen */
  static computeStats(guild: Guild): GuildStats {
    const members = guild.members.cache;

    const total  = members.size;
    const bots   = members.filter(m => m.user.bot).size;
    const humans = total - bots;

    // Online: Status ≠ offline und ≠ invisible (requires GUILD_PRESENCES intent).
    // Falls der Intent fehlt oder die Presence-Daten noch nicht gecacht sind,
    // fällt der Counter auf -1 zurück damit stat-channels "N/A" anzeigen
    // anstatt dauerhaft 0 (was den Eindruck eines Fehlers erweckt).
    const presencesAvailable = members.some(m => m.presence !== null);
    const online = presencesAvailable
      ? members.filter(m =>
          !m.user.bot && m.presence?.status !== 'offline' && m.presence?.status !== undefined
        ).size
      : -1;

    const boosts     = guild.premiumSubscriptionCount ?? 0;
    const boostLevel = guild.premiumTier;

    // Rollen-Zähler
    const roles: Record<string, number> = {};
    guild.roles.cache.forEach(role => {
      roles[role.id] = role.members.size;
    });

    return { total, humans, bots, online, boosts, boostLevel, roles };
  }

  /** Einzelnen Stat-Kanal umbenennen */
  private static async updateChannel(
    guild: Guild,
    ch: StatChannel,
    stats: GuildStats,
  ): Promise<void> {
    const channel = guild.channels.cache.get(ch.channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) return;

    const value = this.getValue(ch, stats, guild);
    const name  = this.renderTemplate(ch.template, value, ch, guild);

    // Nicht umbenennen wenn Name gleich bleibt (spart API-Calls)
    if (channel.name === name) return;

    await (channel as VoiceChannel).setName(name, 'Stats-Update').catch(err => {
      console.error(`[Stats] setName fehlgeschlagen (${channel.id}):`, err?.message ?? err);
    });
  }

  // ── Hilfsmethoden ────────────────────────────────────────────────────────

  private static getValue(ch: StatChannel, stats: GuildStats, guild: Guild): number {
    switch (ch.type as StatChannelType) {
      case 'total':       return stats.total;
      case 'humans':      return stats.humans;
      case 'bots':        return stats.bots;
      case 'online':      return stats.online;
      case 'boosts':      return stats.boosts;
      case 'boost_level': return stats.boostLevel;
      case 'role':        return ch.roleId ? (stats.roles[ch.roleId] ?? 0) : 0;
      default:            return 0;
    }
  }

  private static renderTemplate(
    template: string,
    value: number,
    ch: StatChannel,
    guild: Guild,
  ): string {
    // Sprache der Guild aus DB holen
    const guildConfig = getGuild(guild.id);
    const lang = (guildConfig.language || 'en') as Language;

    // __default__ oder alte hardcoded Templates → lokalisiertes Template
    const isDefault = template === DEFAULT_TEMPLATE_SENTINEL
      || LEGACY_DEFAULT_TEMPLATES.includes(template);

    const tpl = isDefault
      ? getLocalized(`stats.template.${ch.type}`, lang)
      : template;

    let result = value === -1
      ? tpl.replace('{value}', 'N/A')   // GuildPresences intent missing
      : tpl.replace('{value}', value.toLocaleString());

    if (ch.roleId) {
      const roleName = guild.roles.cache.get(ch.roleId)?.name ?? 'Role';
      result = result.replace('{role}', roleName);
    }

    return result.slice(0, 100);
  }

  /** Zeigt ob eine Guild ausstehende Updates hat */
  static hasPendingUpdate(guildId: string): boolean {
    return this.debounce.get(guildId)?.pending ?? false;
  }

  /** Sekunden bis zum nächsten geplanten Update */
  static secondsUntilNextUpdate(guildId: string): number | null {
    const state = this.debounce.get(guildId);
    if (!state?.timer || state.lastUpdate === 0) return null;
    const remaining = (state.lastUpdate + UPDATE_INTERVAL_MS) - Date.now();
    return Math.max(0, Math.round(remaining / 1000));
  }
}
