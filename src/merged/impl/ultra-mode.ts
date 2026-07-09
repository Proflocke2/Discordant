/**
 * /ultra-mode — Sofortiger Vollschutz bei aktivem Angriff.
 *
 * Aktiviert:
 *   • Score-basiertes Fingerprinting bei jedem neuen Join
 *   • Sofortiger Ban von Accounts mit Risikoscore >= Schwellenwert
 *   • Koordinierten-Spam-Detection (gleiche Nachricht von mehreren Usern)
 *   • Automatischer Lockdown bei Raid-Erkennung
 *
 * Kann von jedem mit ManageGuild-Berechtigung ausgeführt werden.
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { requireAdmin } from '../../utils/guards';
import { success, error, info } from '../../utils/embeds';
import { getGuild } from '../../database/db';
import { getLocalized, Language } from '../../utils/localization';
import {
  getSecurityConfig, updateSecurityConfig,
  activateUltraMode, deactivateUltraMode,
  isUltraModeActive, getUltraModeInfo,
  liftLockdown, isLockdownActive,
  resetJoinWindows, resetSpamWindows,
  getRecentIncidents,
} from '../../modules/security/securityEngine';

export default {
  data: new SlashCommandBuilder()
    .setName('ultra-mode')
    .setDescription('⚡ Instant full defense — stops all attack types immediately without waiting')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(s => s
      .setName('on')
      .setDescription('⚡ Activate Ultra-Mode — score-based instant ban of all suspicious joiners')
      .addIntegerOption(o => o
        .setName('score_threshold')
        .setDescription('Risk score 0–100 to trigger instant ban (default: 60). Lower = stricter.')
        .setMinValue(20).setMaxValue(95))
      .addBooleanOption(o => o
        .setName('lockdown')
        .setDescription('Immediately lock all channels too? (default: no)')))
    .addSubcommand(s => s
      .setName('off')
      .setDescription('Deactivate Ultra-Mode and return to normal protection'))
    .addSubcommand(s => s
      .setName('status')
      .setDescription('Show Ultra-Mode status, recent threat score and incident overview')),

  async execute(ix: ChatInputCommandInteraction) {
    if (!await requireAdmin(ix)) return;
    await ix.deferReply({ flags: MessageFlags.Ephemeral });

    const sub   = ix.options.getSubcommand();
    const gid   = ix.guildId!;
    const guild = ix.guild!;
    const lang  = ((getGuild(gid) as any).language || 'en') as Language;
    const t     = (k: string, v?: Record<string, string>) => getLocalized(k, lang, v);

    // ── STATUS ──────────────────────────────────────────────────────────────
    if (sub === 'status') {
      const cfg       = getSecurityConfig(gid);
      const info      = getUltraModeInfo(gid);
      const incidents = getRecentIncidents(gid, 20);
      const ultraBans = incidents.filter(i => i.type === 'ultra_ban').length;
      const ultraFlags = incidents.filter(i => i.type === 'ultra_flag').length;
      const coordSpam = incidents.filter(i => i.type === 'coordinated_spam').length;

      const isOn = isUltraModeActive(gid) || cfg.ultra_mode === 1;

      await ix.editReply({
        embeds: [new EmbedBuilder()
          .setColor(isOn ? '#6600ff' : '#5865f2')
          .setTitle('⚡ Ultra-Mode Status')
          .setDescription(
            `**Ultra-Mode:** ${isOn ? '⚡ **AKTIV**' : '⬜ Inaktiv'}\n` +
            `**Score-Threshold:** ${cfg.ultra_score_threshold ?? 60}/100\n` +
            `**Lockdown aktiv:** ${isLockdownActive(gid) ? '🔴 Ja' : '🟢 Nein'}\n` +
            (info ? `**Aktiviert von:** ${info.activatedBy} • <t:${Math.floor(info.activatedAt / 1000)}:R>\n` : '') +
            `\n**Letzte 20 Incidents:**\n` +
            `• Ultra-Bans: **${ultraBans}** sofortige Bans\n` +
            `• Flagged: **${ultraFlags}** suspicious joins\n` +
            `• Koordinierter Spam: **${coordSpam}** Erkennungen`,
          )
          .addFields({
            name: '⚡ Score-Indikatoren (bei jedem Join)',
            value:
              '`+35` Kein Profilbild (Standard-Avatar)\n' +
              '`+30` Account < 1 Tag alt\n' +
              '`+25` Account < 7 Tage alt\n' +
              '`+20` Bot-typisches Namensmuster\n' +
              '`+15` Beitritt in Join-Burst (< 5s)\n' +
              '`-20` Account > 1 Jahr alt\n' +
              `\n**Threshold:** ${cfg.ultra_score_threshold ?? 60}+ → **Sofortiger Ban**`,
          })
          .setTimestamp()],
      });
      return;
    }

    // ── ON ──────────────────────────────────────────────────────────────────
    if (sub === 'on') {
      const threshold = ix.options.getInteger('score_threshold') ?? 60;
      const doLockdown = ix.options.getBoolean('lockdown') ?? false;

      // Persist ultra_mode = 1 and threshold in DB
      updateSecurityConfig(gid, {
        ultra_mode:            1,
        ultra_score_threshold: threshold,
      });
      activateUltraMode(gid, ix.user.tag);

      const steps: string[] = [
        `⚡ **Ultra-Mode aktiviert** (Score-Threshold: ${threshold}/100)`,
        '🔍 **Score-Fingerprinting** aktiv — jeder neue Beitritt wird sofort bewertet',
        '🚫 **Automatic ban** for accounts with score >= ' + threshold,
        '🎯 **Koordinierten-Spam-Detection** aktiv — gleiche Nachrichten von mehreren Usern',
      ];

      if (doLockdown && !isLockdownActive(gid)) {
        const cfg = getSecurityConfig(gid);
        await liftLockdown(guild); // clear any stale state first
        const { triggerLockdown } = await import('../../modules/security/securityEngine');
        await triggerLockdown(guild, cfg, `Ultra-Mode aktiviert durch ${ix.user.tag}`);
        steps.push(`🔒 **All channels locked** (auto-lift in 5 min.)`);
      }

      // Reset sliding windows so fresh start
      resetJoinWindows();
      resetSpamWindows();
      steps.push('🔄 **Tracking windows reset** — clean start');

      await ix.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#6600ff')
          .setTitle('⚡ Ultra-Mode AKTIV')
          .setDescription(steps.join('\n'))
          .addFields({
            name: 'Was passiert jetzt',
            value:
              `Jeder neue User der beitritt wird **sofort gescort**.\n` +
              `Score >= ${threshold}: **Sofortiger Ban** ohne Wartezeit.\n` +
              `Score 40–${threshold - 1}: Geloggt, aber kein Ban.\n\n` +
              `Deaktivieren mit \`/ultra-mode off\`.`,
          })
          .setTimestamp()
          .setFooter({ text: `Aktiviert von ${ix.user.tag}` })],
      });
      return;
    }

    // ── OFF ─────────────────────────────────────────────────────────────────
    if (sub === 'off') {
      const wasActive = isUltraModeActive(gid);
      deactivateUltraMode(gid);
      updateSecurityConfig(gid, { ultra_mode: 0 });

      if (!wasActive) {
        await ix.editReply({
          embeds: [info('Ultra-Mode', 'Ultra-Mode war nicht aktiv.')],
        });
        return;
      }

      const incidents = getRecentIncidents(gid, 50);
      const ultraBans  = incidents.filter(i => i.type === 'ultra_ban').length;
      const ultraFlags = incidents.filter(i => i.type === 'ultra_flag').length;

      await ix.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#57f287')
          .setTitle('✅ Ultra-Mode deaktiviert')
          .setDescription(
            'Normaler Schutzmodus wiederhergestellt.\n\n' +
            '**Zusammenfassung:**\n' +
            `• **${ultraBans}** sofortige Bans durch Score-System\n` +
            `• **${ultraFlags}** geflaggerte Accounts (Score 40–Threshold)\n\n` +
            `The normal security engine protection (Anti-Raid, Anti-Spam etc.) is still running.`,
          )
          .setTimestamp()
          .setFooter({ text: `Deaktiviert von ${ix.user.tag}` })],
      });
    }
  },
};
