/**
 * /form — Ticket panel & category form management (V2).
 *
 * Subcommands:
 *   add          – Frage zu einem Panel hinzufügen (gilt für alle Kategorien ohne eigene Fragen)
 *   add-category – Add a question to a specific category (overrides panel questions)
 *   list         – Alle Fragen eines Panels oder einer Kategorie anzeigen
 *   clear        – Alle Fragen eines Panels/einer Kategorie löschen
 *
 * Priorität beim Öffnen eines Tickets:
 *   Kategorie-Fragen → Panel-Fragen → Standard-Frage (eine Freitextbox)
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { success, error, info } from '../../utils/embeds';
import { tGuild } from '../../i18n';
import * as Repo from '../../modules/tickets/repository';
import type { FieldStyle } from '../../modules/tickets/types';

const MAX_FIELDS = 5;
const MAX_LABEL  = 45;
const MAX_PH     = 100;

export default {
  data: new SlashCommandBuilder()
    .setName('form')
    .setDescription('Manage ticket form questions (shown before opening a ticket)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    // /form add  — panel-weite Frage
    .addSubcommand(s =>
      s.setName('add').setDescription('Add a question to the panel form (applies to all categories)')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription(`Fragetext (max ${MAX_LABEL} Zeichen)`).setRequired(true))
        .addStringOption(o => o.setName('placeholder').setDescription(`Hinweistext (max ${MAX_PH} Zeichen)`))
        .addStringOption(o => o.setName('style').setDescription('Eingabefeld-Stil')
          .addChoices(
            { name: '▬ Kurzantwort (einzeilig)',     value: 'short'     },
            { name: '¶ Freitext (mehrzeilig)',        value: 'paragraph' },
          ))
        .addBooleanOption(o => o.setName('required').setDescription('Required field? (default: yes)'))
        .addIntegerOption(o => o.setName('min_length').setDescription('Minimum length (default: 0)').setMinValue(0).setMaxValue(4000))
        .addIntegerOption(o => o.setName('max_length').setDescription('Maximum length (default: 1000)').setMinValue(1).setMaxValue(4000)),
    )

    // /form add-category  — kategorie-spezifische Frage
    .addSubcommand(s =>
      s.setName('add-category').setDescription('Add a question to a specific category (overrides panel questions for this category)')
        .addIntegerOption(o => o.setName('category_id').setDescription('Category ID (from /category list)').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription(`Fragetext (max ${MAX_LABEL} Zeichen)`).setRequired(true))
        .addStringOption(o => o.setName('placeholder').setDescription(`Hinweistext (max ${MAX_PH} Zeichen)`))
        .addStringOption(o => o.setName('style').setDescription('Eingabefeld-Stil')
          .addChoices(
            { name: '▬ Kurzantwort (einzeilig)',     value: 'short'     },
            { name: '¶ Freitext (mehrzeilig)',        value: 'paragraph' },
          ))
        .addBooleanOption(o => o.setName('required').setDescription('Required field? (default: yes)'))
        .addIntegerOption(o => o.setName('min_length').setDescription('Minimum length').setMinValue(0).setMaxValue(4000))
        .addIntegerOption(o => o.setName('max_length').setDescription('Maximum length').setMinValue(1).setMaxValue(4000)),
    )

    // /form list
    .addSubcommand(s =>
      s.setName('list').setDescription('Show the questions of a panel or category')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID (for panel questions)'))
        .addIntegerOption(o => o.setName('category_id').setDescription('Category ID (for category questions)')),
    )

    // /form clear
    .addSubcommand(s =>
      s.setName('clear').setDescription('Delete all questions for a panel or category')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID'))
        .addIntegerOption(o => o.setName('category_id').setDescription('Category ID')),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── ADD (panel-level) ──────────────────────────────────────────────────────
    if (sub === 'add') {
      const panelId = ix.options.getInteger('panel_id', true);
      const panel   = Repo.getPanel(panelId);
      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error(tGuild(gid, 'tickets.panel.not_found'))], flags: MessageFlags.Ephemeral });
      }
      const existing = Repo.listFormQuestions(panelId);
      if (existing.length >= MAX_FIELDS) {
        return ix.reply({ embeds: [error(`Max ${MAX_FIELDS} Fragen pro Panel (Discord-Limit).`)], flags: MessageFlags.Ephemeral });
      }

      const { label, placeholder, style, required, minLen, maxLen } = parseOptions(ix);
      if (!validateLengths(ix, label, placeholder, minLen, maxLen)) return;

      const q = Repo.addFormQuestion({
        panel_id: panelId, label, placeholder: placeholder ?? null,
        style, required, min_length: minLen, max_length: maxLen,
      });

      return ix.reply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Panel question added')
          .setColor('#57f287')
          .setDescription(`This question appears for **all categories** in panel **${panel.title}**, unless overridden by a category-specific question.eine kategorie-spezifischen Fragen definiert sind.`)
          .addFields(
            { name: 'Position', value: `${q.position + 1} / ${MAX_FIELDS}`, inline: true },
            { name: 'Label',    value: label,                               inline: true },
            { name: 'Stil',     value: style,                               inline: true },
            { name: 'Pflicht',  value: required ? 'Ja' : 'Nein',            inline: true },
            { name: 'Length',   value: `${minLen}–${maxLen} chars`,       inline: true },
          )
          .setFooter({ text: `Panel: ${panel.title} | Tip: /form add-category for category-specific questions` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── ADD-CATEGORY ───────────────────────────────────────────────────────────
    if (sub === 'add-category') {
      const catId = ix.options.getInteger('category_id', true);
      const cat   = Repo.getCategory(catId);
      if (!cat || cat.guild_id !== gid) {
        return ix.reply({ embeds: [error('Kategorie nicht gefunden.')], flags: MessageFlags.Ephemeral });
      }
      const existing = Repo.listCategoryFormQuestions(catId);
      if (existing.length >= MAX_FIELDS) {
        return ix.reply({ embeds: [error(`Max ${MAX_FIELDS} Fragen pro Kategorie (Discord-Limit).`)], flags: MessageFlags.Ephemeral });
      }

      const { label, placeholder, style, required, minLen, maxLen } = parseOptions(ix);
      if (!validateLengths(ix, label, placeholder, minLen, maxLen)) return;

      const q = Repo.addCategoryFormQuestion({
        panel_id: cat.panel_id, category_id: catId,
        label, placeholder: placeholder ?? null,
        style, required, min_length: minLen, max_length: maxLen,
      });

      return ix.reply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Category question added')
          .setColor('#57f287')
          .setDescription(`This question appears **only** for category **${cat.label}** and overrides panel questions for this category.`)
          .addFields(
            { name: 'Kategorie', value: cat.label,                         inline: true },
            { name: 'Position',  value: `${q.position + 1} / ${MAX_FIELDS}`, inline: true },
            { name: 'Label',     value: label,                              inline: true },
            { name: 'Stil',      value: style,                              inline: true },
            { name: 'Pflicht',   value: required ? 'Ja' : 'Nein',           inline: true },
            { name: 'Length',    value: `${minLen}–${maxLen} chars`,      inline: true },
          )
          .setFooter({ text: `Kategorie-ID: ${catId}` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── LIST ────────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const panelId = ix.options.getInteger('panel_id');
      const catId   = ix.options.getInteger('category_id');

      if (!panelId && !catId) {
        return ix.reply({ embeds: [error('Bitte panel_id oder category_id angeben.')], flags: MessageFlags.Ephemeral });
      }

      if (catId) {
        const cat = Repo.getCategory(catId);
        if (!cat || cat.guild_id !== gid) {
          return ix.reply({ embeds: [error('Kategorie nicht gefunden.')], flags: MessageFlags.Ephemeral });
        }
        const catQs   = Repo.listCategoryFormQuestions(catId);
        const panelQs = Repo.listFormQuestions(cat.panel_id);

        const embed = new EmbedBuilder()
          .setColor('#5865f2')
          .setTitle(`📋 Formular — Kategorie "${cat.label}"`)
          .setFooter({ text: `Kategorie-ID: ${catId} | Panel-ID: ${cat.panel_id}` });

        if (catQs.length > 0) {
          embed.addFields({
            name: `✏️ Kategorie-spezifische Fragen (${catQs.length}/${MAX_FIELDS})`,
            value: catQs.map((q, i) => `**${i + 1}.** ${q.label} *(${q.style}, ${q.required ? 'Pflicht' : 'optional'})*`).join('\n'),
          });
          embed.setDescription('These questions override the panel questions for this category.');
        } else {
          embed.setDescription('No category-specific questions — the panel questions apply.');
        }

        if (panelQs.length > 0) {
          embed.addFields({
            name: `📄 Panel Questions (${panelQs.length}/${MAX_FIELDS}) ${catQs.length > 0 ? '*(inactive for this cattegorie)*' : '*(aktiv)*'}`,
            value: panelQs.map((q, i) => `**${i + 1}.** ${q.label} *(${q.style}, ${q.required ? 'Pflicht' : 'optional'})*`).join('\n'),
          });
        }

        return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Panel list
      const panel = Repo.getPanel(panelId!);
      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error(tGuild(gid, 'tickets.panel.not_found'))], flags: MessageFlags.Ephemeral });
      }
      const qs = Repo.listFormQuestions(panelId!);
      if (qs.length === 0) {
        return ix.reply({
          embeds: [info(`Formular — ${panel.title}`, 'Keine Panel-Fragen. Nutze `/form add` oder `/form add-category`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`📋 Panel-Fragen — ${panel.title}`)
        .setColor('#5865f2')
        .setDescription('Apply to all categories without their own questions.')
        .setFooter({ text: `${qs.length}/${MAX_FIELDS} Fragen` });
      for (const q of qs) {
        embed.addFields({
          name:  `${q.position + 1}. ${q.label}`,
          value: `Style: **${q.style}** • Required: **${q.required ? 'Yes' : 'No'}** • Length: **${q.min_length}–${q.max_length}**` +
                 (q.placeholder ? `\nHinweis: *${q.placeholder}*` : ''),
        });
      }
      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── CLEAR ────────────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const panelId = ix.options.getInteger('panel_id');
      const catId   = ix.options.getInteger('category_id');

      if (!panelId && !catId) {
        return ix.reply({ embeds: [error('Bitte panel_id oder category_id angeben.')], flags: MessageFlags.Ephemeral });
      }

      if (catId) {
        const cat = Repo.getCategory(catId);
        if (!cat || cat.guild_id !== gid) {
          return ix.reply({ embeds: [error('Kategorie nicht gefunden.')], flags: MessageFlags.Ephemeral });
        }
        Repo.clearCategoryFormQuestions(catId);
        return ix.reply({
          embeds: [success('🗑️ Category questions deleted', `All questions for category **${cat.label}** removedt.\nJetzt gelten wieder die Panel-Fragen (falls vorhanden).*`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const panel = Repo.getPanel(panelId!);
      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error(tGuild(gid, 'tickets.panel.not_found'))], flags: MessageFlags.Ephemeral });
      }
      Repo.clearFormQuestions(panelId!);
      return ix.reply({
        embeds: [success('🗑️ Panel questions deleted', `All questions for panel **${panel.title}** removed.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseOptions(ix: ChatInputCommandInteraction) {
  return {
    label:       ix.options.getString('label', true),
    placeholder: ix.options.getString('placeholder'),
    style:       (ix.options.getString('style') ?? 'short') as FieldStyle,
    required:    ix.options.getBoolean('required') !== false,
    minLen:      ix.options.getInteger('min_length') ?? 0,
    maxLen:      ix.options.getInteger('max_length') ?? 1000,
  };
}

function validateLengths(
  ix: ChatInputCommandInteraction,
  label: string,
  placeholder: string | null,
  minLen: number,
  maxLen: number,
): boolean {
  if (label.length > MAX_LABEL) {
    ix.reply({ embeds: [error(`Label max ${MAX_LABEL} Zeichen (Discord-Limit).`)], flags: MessageFlags.Ephemeral });
    return false;
  }
  if (placeholder && placeholder.length > MAX_PH) {
    ix.reply({ embeds: [error(`Hinweistext max ${MAX_PH} Zeichen.`)], flags: MessageFlags.Ephemeral });
    return false;
  }
  if (minLen > maxLen) {
    ix.reply({ embeds: [error('Minimum length cannot exceed maximum length.')], flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}
