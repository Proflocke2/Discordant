/**
 * LANGUAGE RELOAD SERVICE
 * Wenn die Server-Sprache geändert wird, aktualisiert dieser Service
 * alle persistenten Bot-Nachrichten:
 *
 *  1. Stat-Kanäle (Voice-Channel-Namen)       ← StatsService.forceUpdate
 *  2. Ticket-Panels (Button-Labels, Fallback-Desc)
 *  3. Multipanels
 *
 * Ticket-Inhalte (Titel, Beschreibung) sind User-definiert → werden NICHT übersetzt.
 * Button-Labels (Close, Claim, Transcript) und System-Defaults → werden übersetzt.
 */

import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from 'discord.js';
import { getGuild } from '../database/db';
import { getLocalized, Language } from '../utils/localization';
import { StatsService } from '../stats/StatsService';
import { getStatsConfig } from '../stats/StatsDB';
import db from '../database/db';

interface PanelRow {
  id: number;
  guild_id: string;
  name: string;
  title: string;
  description: string | null;
  color: string;
  emoji: string;
  button_text: string;
  category_id: string | null;
  support_roles: string;
  message_id: string | null;
  channel_id: string | null;
}

interface MultipanelRow {
  id: number;
  panel_id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  title: string;
  description: string | null;
  color: string;
  option_ids: string;
}

// ────────────────────────────────────────────────────────────────────────────

export class LanguageReloadService {

  /**
   * Wird von /language set aufgerufen.
   * Läuft im Hintergrund (kein await nötig).
   */
  static async reloadAll(client: Client, guildId: string): Promise<void> {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const config  = getGuild(guildId);
    const lang    = (config.language || 'en') as Language;

    // 1. Stat-Kanäle
    const hasStats = getStatsConfig(guildId).channels.length > 0;
    if (hasStats) {
      await StatsService.forceUpdate(guild).catch(() => {});
    }

    // 2. Ticket-Panels
    await this.reloadTicketPanels(client, guildId, lang);

    // 3. Multipanels
    await this.reloadMultipanels(client, guildId, lang);
  }

  // ── Ticket-Panels ──────────────────────────────────────────────────────────

  private static async reloadTicketPanels(
    client: Client,
    guildId: string,
    lang: Language,
  ): Promise<void> {
    const panels = db
      .prepare('SELECT * FROM panels WHERE guild_id = ? AND message_id IS NOT NULL AND channel_id IS NOT NULL')
      .all(guildId) as PanelRow[];

    for (const panel of panels) {
      try {
        const channel = client.channels.cache.get(panel.channel_id!) as TextChannel | undefined;
        if (!channel) continue;

        const message = await channel.messages.fetch(panel.message_id!).catch(() => null);
        if (!message) continue;

        // Embed — Titel und Beschreibung sind User-definiert → beibehalten
        const embed = new EmbedBuilder()
          .setTitle(panel.title)
          .setColor(panel.color as any)
          .setDescription(panel.description ?? getLocalized('ticket.default_desc', lang));

        // Button — label ist User-konfiguriert → beibehalten
        const btn = new ButtonBuilder()
          .setCustomId(`ticket_open_${panel.id}`)
          .setLabel(panel.button_text)
          .setEmoji(panel.emoji)
          .setStyle(ButtonStyle.Primary);

        await message.edit({
          embeds: [embed],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(btn)],
        });
      } catch {
        // Einzelner Fehler → überspringen, nicht crashen
      }
    }
  }

  // ── Multipanels ────────────────────────────────────────────────────────────

  private static async reloadMultipanels(
    client: Client,
    guildId: string,
    lang: Language,
  ): Promise<void> {
    const panels = db
      .prepare('SELECT * FROM multipanels WHERE guild_id = ? AND message_id IS NOT NULL')
      .all(guildId) as MultipanelRow[];

    for (const panel of panels) {
      try {
        const channel = client.channels.cache.get(panel.channel_id) as TextChannel | undefined;
        if (!channel) continue;

        const message = await channel.messages.fetch(panel.message_id!).catch(() => null);
        if (!message) continue;

        // Embed — Inhalt ist User-definiert → beibehalten, nur neu senden zum Refresh
        const embed = new EmbedBuilder()
          .setTitle(panel.title)
          .setColor(panel.color as any);

        if (panel.description) embed.setDescription(panel.description);

        // Options aus DB laden und Select-Menu neu bauen
        const optionIds: string[] = JSON.parse(panel.option_ids || '[]');
        const options = optionIds
          .map(id => db.prepare('SELECT * FROM multipanel_options WHERE option_id = ?').get(id) as any)
          .filter(Boolean);

        if (options.length === 0) continue;

        const { StringSelectMenuBuilder } = await import('discord.js');
        const select = new StringSelectMenuBuilder()
          .setCustomId(`multipanel_select_${panel.panel_id}`)
          .setPlaceholder(getLocalized('ticket.default_desc', lang))
          .addOptions(options.map((o: any) => ({
            label:       o.label,
            value:       o.option_id,
            description: o.description?.slice(0, 100),
            emoji:       o.emoji || undefined,
          })));

        await message.edit({
          embeds: [embed],
          components: [new ActionRowBuilder<any>().addComponents(select)],
        });
      } catch {
        // Einzelner Fehler → überspringen
      }
    }
  }
}
