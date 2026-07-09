/**
 * /setup — Interaktiver Einrichtungs-Wizard.
 *
 * Aktiviert Security- und Moderations-Features mit einem einzigen
 * Befehl. Alle gewählten Features werden sofort konfiguriert.
 *
 * Subcommands:
 *   wizard   — Interaktiver Button-basierter Setup mit Auswahl
 *   quick    — Schnellsetup: alle empfohlenen Features auf einmal
 *   status   — Übersicht aller aktuell aktiven Features
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags, ComponentType, TextChannel, ChannelType,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { requireAdmin } from '../../utils/guards';
import { success, error, info } from '../../utils/embeds';
import { setGuildValue, getGuild } from '../../database/db';
import { getAntiRaidConfig, updateAntiRaidConfig } from '../../modules/moderation/antiRaid';
import { getAutomod3Config } from '../../merged/impl/automod3';
import db from '../../database/db';

// ── Feature definitions ───────────────────────────────────────────────────────

interface Feature {
  id: string;
  label: string;
  emoji: string;
  description: string;
  category: 'security' | 'automod' | 'logging';
  recommended: boolean;
}

const FEATURES: Feature[] = [
  // Security
  { id: 'antiraid',       label: 'Anti-Raid',           emoji: '🛡️',  description: 'Erkennt Join-Spikes und kickt/bannt Raider automatisch',       category: 'security', recommended: true  },
  { id: 'alt_detection',  label: 'Alt-Detection',        emoji: '🔰',  description: 'Erkennt neue Accounts (< 7 Tage alt) beim Beitritt',            category: 'security', recommended: true  },
  { id: 'verification',   label: 'Verification Gate',   emoji: '✅',  description: 'New members must verify before accessing the server',  category: 'security', recommended: false },
  // AutoMod
  { id: 'antispam',       label: 'Anti-Spam',            emoji: '🔇',  description: 'Blockiert Nutzer die zu viele Nachrichten senden',              category: 'automod',  recommended: true  },
  { id: 'antilink',       label: 'Anti-Link',            emoji: '🔗',  description: 'Blockiert externe Links (nicht-Mods)',                          category: 'automod',  recommended: false },
  { id: 'antiinvite',     label: 'Anti-Invite',          emoji: '🚫',  description: 'Blockiert Discord-Einladungslinks',                             category: 'automod',  recommended: true  },
  { id: 'anticaps',       label: 'Anti-Caps',            emoji: '🔠',  description: 'Deletes messages with >70% uppercase lettersaben',                   category: 'automod',  recommended: false },
  { id: 'phishing',       label: 'Phishing Filter',      emoji: '🎣',  description: 'Detects and deletes phishing links automaticallymatisch',                category: 'automod',  recommended: true  },
  { id: 'masspings',      label: 'Anti-Mass-Ping',       emoji: '📢',  description: 'Blockiert Nachrichten mit zu vielen Mentions',                  category: 'automod',  recommended: true  },
  { id: 'regex',          label: 'Regex-Filter',         emoji: '🔍',  description: 'Benutzerdefinierte Textmuster blockieren',                      category: 'automod',  recommended: false },
  // Logging
  { id: 'modlog',         label: 'Mod-Log',              emoji: '📋',  description: 'Logs deleted/edited messages and member activitychrichten, Beitritte etc',category: 'logging',  recommended: true  },
  { id: 'badwords',       label: 'Word Filter',          emoji: '🤐',  description: 'Blocks specific words/phrases',                           category: 'automod',  recommended: false },
];

// ── Status helper ─────────────────────────────────────────────────────────────

function getFeatureStatus(guildId: string): Record<string, boolean> {
  const guild = getGuild(guildId);
  const antiRaid = getAntiRaidConfig(guildId);
  const am3 = getAutomod3Config(guildId);
  const welcomeSettings = db.prepare('SELECT * FROM welcome_settings WHERE guild_id = ?').get(guildId) as any;
  const verifyConfig = db.prepare('SELECT * FROM verification_config WHERE guild_id = ?').get(guildId) as any;

  return {
    antiraid:      !!antiRaid.enabled,
    alt_detection: !!welcomeSettings?.alt_enabled,
    verification:  !!verifyConfig?.enabled,
    antispam:      !!guild.automod_antispam,
    antilink:      !!guild.automod_antilink,
    antiinvite:    !!(guild as any).automod_antiinvite,
    anticaps:      !!(guild as any).automod_anticaps,
    phishing:      !!am3.phishing_filter,
    masspings:     !!am3.anti_mass_ping,
    regex:         JSON.parse(am3.regex_filters).length > 0,
    modlog:        !!(guild.mod_log_channel || guild.log_channel),
    badwords:      JSON.parse(guild.automod_badwords || '[]').length > 0,
  };
}

// ── Apply features ────────────────────────────────────────────────────────────

async function applyFeature(guildId: string, featureId: string, enable: boolean): Promise<string> {
  const val = enable ? 1 : 0;

  switch (featureId) {
    case 'antiraid':
      updateAntiRaidConfig(guildId, {
        enabled: val,
        threshold: 8,
        window_seconds: 10,
        action: 'kick',
        min_age_minutes: 30,
      });
      return enable
        ? '🛡️ Anti-Raid enabled (8 joins/10s → kick, min age 30min)'
        : '🛡️ Anti-Raid disabled';

    case 'alt_detection':
      db.prepare('INSERT OR IGNORE INTO welcome_settings (guild_id) VALUES (?)').run(guildId);
      db.prepare('UPDATE welcome_settings SET alt_enabled = ?, alt_min_age_days = 7, alt_action = ? WHERE guild_id = ?')
        .run(val, enable ? 'log' : 'log', guildId);
      return enable
        ? '🔰 Alt-Detection enabled (< 7 day old accounts flagged)'
        : '🔰 Alt-Detection disabled';

    case 'antispam':
      setGuildValue(guildId, 'automod_enabled', val);
      setGuildValue(guildId, 'automod_antispam', val);
      return enable ? '🔇 Anti-Spam enabled' : '🔇 Anti-Spam disabled';

    case 'antilink':
      setGuildValue(guildId, 'automod_enabled', 1);
      setGuildValue(guildId, 'automod_antilink', val);
      return enable ? '🔗 Anti-Link enabled' : '🔗 Anti-Link disabled';

    case 'antiinvite':
      setGuildValue(guildId, 'automod_enabled', 1);
      setGuildValue(guildId, 'automod_antiinvite', val);
      return enable ? '🚫 Anti-Invite enabled' : '🚫 Anti-Invite disabled';

    case 'anticaps':
      setGuildValue(guildId, 'automod_enabled', 1);
      setGuildValue(guildId, 'automod_anticaps', val);
      return enable ? '🔠 Anti-Caps enabled' : '🔠 Anti-Caps disabled';

    case 'phishing': {
      db.prepare('INSERT OR IGNORE INTO automod3_config (guild_id) VALUES (?)').run(guildId);
      db.prepare('UPDATE automod3_config SET phishing_filter = ? WHERE guild_id = ?').run(val, guildId);
      return enable ? '🎣 Phishing filter enabled' : '🎣 Phishing filter disabled';
    }

    case 'masspings': {
      db.prepare('INSERT OR IGNORE INTO automod3_config (guild_id) VALUES (?)').run(guildId);
      db.prepare('UPDATE automod3_config SET anti_mass_ping = ?, mass_ping_limit = 5 WHERE guild_id = ?').run(val, guildId);
      return enable ? '📢 Anti-Mass-Ping enabled (max 5 mentions)' : '📢 Anti-Mass-Ping disabled';
    }

    case 'modlog':
      // Can only log if a mod_log_channel exists — just enable automod so events fire
      setGuildValue(guildId, 'automod_enabled', val);
      return enable
        ? '📋 Mod-Log enabled — set a channel with `/automod modlog`'
        : '📋 Mod-Log disabled';

    default:
      return `⚠️ Feature "${featureId}" muss manuell konfiguriert werden`;
  }
}

// ── Build status embed ────────────────────────────────────────────────────────

function buildStatusEmbed(guildId: string): EmbedBuilder {
  const status = getFeatureStatus(guildId);
  const categories = ['security', 'automod', 'logging'] as const;
  const catLabels = { security: '🔒 Sicherheit', automod: '🤖 AutoMod', logging: '📋 Protokollierung' };

  const embed = new EmbedBuilder()
    .setTitle('⚙️ MultiBotV2 — Feature Overview')
    .setColor('#5865f2')
    .setTimestamp()
    .setFooter({ text: 'Verwende /setup wizard zum interaktiven Einrichten' });

  for (const cat of categories) {
    const features = FEATURES.filter(f => f.category === cat);
    const lines = features.map(f => `${status[f.id] ? '✅' : '❌'} ${f.emoji} **${f.label}** — ${f.description}`);
    embed.addFields({ name: catLabels[cat], value: lines.join('\n') });
  }

  const active = Object.values(status).filter(Boolean).length;
  const total = Object.keys(status).length;
  embed.setDescription(`**${active}/${total}** features active`);

  return embed;
}

// ── Export ────────────────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Interactive setup wizard for security & moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)

    .addSubcommand(s => s.setName('wizard').setDescription('Interactive wizard — select features via menu'))
    .addSubcommand(s => s.setName('quick').setDescription('Quick setup: enable all recommended features instantly'))
    .addSubcommand(s => s.setName('status').setDescription('Overview of all active/inactive features'))
    .addSubcommand(s => s.setName('disable-all').setDescription('⚠️ Disable all AutoMod/Security features')),

  async execute(ix: ChatInputCommandInteraction) {
    if (!await requireAdmin(ix)) return;
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── Status ──────────────────────────────────────────────────────────────
    if (sub === 'status') {
      return ix.reply({ embeds: [buildStatusEmbed(gid)], flags: MessageFlags.Ephemeral });
    }

    // ── Quick Setup ─────────────────────────────────────────────────────────
    if (sub === 'quick') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const recommended = FEATURES.filter(f => f.recommended);
      const results: string[] = [];
      for (const f of recommended) {
        results.push(await applyFeature(gid, f.id, true));
      }
      const embed = new EmbedBuilder()
        .setColor('#57f287')
        .setTitle('✅ Quick Setup Complete')
        .setDescription(`**${recommended.length}** recommended features have been enabled:`)
        .addFields({ name: 'Aktiviert', value: results.join('\n') })
        .addFields({
          name: '⚠️ Next Steps',
          value: [
            '• `/antiraid setup` — Aktion anpassen (kick/ban)',
            '• `/automod modlog channel:#kanal` — Log-Kanal festlegen',
            '• `/welcome setup` — Willkommens-System einrichten',
          ].join('\n'),
        })
        .setTimestamp();
      return ix.editReply({ embeds: [embed] });
    }

    // ── Disable All ─────────────────────────────────────────────────────────
    if (sub === 'disable-all') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      setGuildValue(gid, 'automod_enabled', 0);
      setGuildValue(gid, 'automod_antispam', 0);
      setGuildValue(gid, 'automod_antilink', 0);
      setGuildValue(gid, 'automod_antiinvite', 0);
      setGuildValue(gid, 'automod_anticaps', 0);
      updateAntiRaidConfig(gid, { enabled: 0 });
      db.prepare('UPDATE automod3_config SET phishing_filter=0, anti_mass_ping=0 WHERE guild_id=?').run(gid);
      return ix.editReply({ embeds: [success('Alle Features deaktiviert', 'AutoMod und Security wurden abgeschaltet.')] });
    }

    // ── Wizard ──────────────────────────────────────────────────────────────
    if (sub === 'wizard') {
      const status = getFeatureStatus(gid);

      const selectSecurity = new StringSelectMenuBuilder()
        .setCustomId('setup:security')
        .setPlaceholder('🔒 Select security features…')
        .setMinValues(0)
        .setMaxValues(FEATURES.filter(f => f.category === 'security').length)
        .addOptions(
          FEATURES.filter(f => f.category === 'security').map(f =>
            new StringSelectMenuOptionBuilder()
              .setLabel(f.label)
              .setValue(f.id)
              .setDescription(f.description.slice(0, 100))
              .setEmoji(f.emoji)
              .setDefault(!!status[f.id])
          )
        );

      const selectAutomod = new StringSelectMenuBuilder()
        .setCustomId('setup:automod')
        .setPlaceholder('🤖 Select AutoMod features…')
        .setMinValues(0)
        .setMaxValues(FEATURES.filter(f => f.category === 'automod').length)
        .addOptions(
          FEATURES.filter(f => f.category === 'automod').map(f =>
            new StringSelectMenuOptionBuilder()
              .setLabel(f.label)
              .setValue(f.id)
              .setDescription(f.description.slice(0, 100))
              .setEmoji(f.emoji)
              .setDefault(!!status[f.id])
          )
        );

      const applyBtn = new ButtonBuilder()
        .setCustomId('setup:apply')
        .setLabel('✅ Apply')
        .setStyle(ButtonStyle.Success);

      const cancelBtn = new ButtonBuilder()
        .setCustomId('setup:cancel')
        .setLabel('Abbrechen')
        .setStyle(ButtonStyle.Secondary);

      const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectSecurity);
      const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectAutomod);
      const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(applyBtn, cancelBtn);

      const embed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle('⚙️ Setup Wizard')
        .setDescription(
          'Select the features you want to enable.\n' +
          'Already active options are pre-selected.\n\n' +
          '**Green features** = currently active\n' +
          'Then click **✅ Apply**.'
        )
        .addFields(
          { name: '🔒 Sicherheit', value: FEATURES.filter(f => f.category === 'security').map(f => `${status[f.id] ? '✅' : '⬜'} ${f.emoji} ${f.label}`).join('\n'), inline: true },
          { name: '🤖 AutoMod', value: FEATURES.filter(f => f.category === 'automod').map(f => `${status[f.id] ? '✅' : '⬜'} ${f.emoji} ${f.label}`).join('\n'), inline: true },
        )
        .setFooter({ text: 'Expires in 3 minutes' });

      const resp = await ix.reply({
        embeds: [embed],
        components: [row1, row2, row3],
        flags: MessageFlags.Ephemeral,
      });

      // Collect selections
      const selectedFeatures = new Set<string>(
        FEATURES.filter(f => !!status[f.id]).map(f => f.id)
      );

      const collector = resp.createMessageComponentCollector({
        filter: i => i.user.id === ix.user.id,
        time: 180_000,
      });

      collector.on('collect', async interaction => {
        if (interaction.customId === 'setup:cancel') {
          collector.stop('cancel');
          await interaction.update({ embeds: [info('Cancelled', 'Setup was not changed.')], components: [] });
          return;
        }

        if (interaction.isStringSelectMenu()) {
          // Clear all features from this category, then re-add selected
          const cat = interaction.customId.replace('setup:', '') as 'security' | 'automod' | 'logging';
          FEATURES.filter(f => f.category === cat).forEach(f => selectedFeatures.delete(f.id));
          interaction.values.forEach(v => selectedFeatures.add(v));
          await interaction.deferUpdate();
          return;
        }

        if (interaction.customId === 'setup:apply') {
          collector.stop('apply');
          await interaction.deferUpdate();

          const results: string[] = [];
          // For each feature, enable if selected, disable if not
          for (const feature of FEATURES) {
            if (feature.id === 'verification' || feature.id === 'regex' || feature.id === 'badwords' || feature.id === 'modlog') {
              if (selectedFeatures.has(feature.id)) {
                results.push(`⚠️ ${feature.emoji} **${feature.label}** — braucht manuelle Einrichtung (siehe unten)`);
              }
              continue;
            }
            const shouldEnable = selectedFeatures.has(feature.id);
            results.push(await applyFeature(gid, feature.id, shouldEnable));
          }

          const manualSteps: string[] = [];
          if (selectedFeatures.has('verification')) manualSteps.push('• **Verification:** run `/verify setup`');
          if (selectedFeatures.has('modlog'))       manualSteps.push('• **Mod-Log:** `/automod modlog channel:#kanal`');
          if (selectedFeatures.has('badwords'))     manualSteps.push('• **Wort-Filter:** `/automod badwords words:wort1,wort2`');
          if (selectedFeatures.has('regex'))        manualSteps.push('• **Regex-Filter:** `/automod3 regex-add`');

          const finalEmbed = new EmbedBuilder()
            .setColor('#57f287')
            .setTitle('✅ Setup Complete')
            .addFields({ name: 'Changes', value: results.join('\n') || 'No changes' });

          if (manualSteps.length > 0) {
            finalEmbed.addFields({ name: '⚠️ Manual steps required', value: manualSteps.join('\n') });
          }

          await interaction.editReply({ embeds: [finalEmbed], components: [] });
        }
      });

      collector.on('end', (_c, reason) => {
        if (reason === 'time') {
          ix.editReply({ embeds: [error('Timeout', 'Setup expired.')], components: [] }).catch(() => {});
        }
      });
    }
  },
};
