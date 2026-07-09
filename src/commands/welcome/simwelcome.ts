/**
 * /simwelcome — Admin-Simulation des Welcome-Systems.
 *
 * Zeigt das Welcome-Embed und (optional) die Welcome-Card live im Kanal,
 * damit Admins Layout, Zeilenabstände und Platzhalter vorab prüfen können.
 *
 * Platzhalter im Simulationsmodus:
 *   {user}        → @Admin (der ausführende User)
 *   {username}    → Admin-Username
 *   {mention}     → @Admin-Mention
 *   {server}      → Servername
 *   {membercount} → Echte aktuelle Mitgliederzahl
 *   {join_date}   → Heutiges Datum
 *
 * Subcommands:
 *   run      – Sendet eine simulierte Welcome-Nachricht in den konfigurierten Kanal
 *   here     – Sendet die Simulation in den aktuellen Kanal (ohne Kanal-Konfiguration nötig)
 *   leave    – Simuliert eine Leave-Nachricht
 *   dm       – Zeigt die DM-Vorschau als ephemere Antwort
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
  EmbedBuilder,
  AttachmentBuilder,
  TextChannel,
  MessageFlags,
} from 'discord.js';
import { error, info } from '../../utils/embeds';
import * as Repo from '../../modules/welcome/repository';
import { createWelcomeCard } from '../../modules/welcome/card';
import { replacePlaceholders } from '../../utils/helpers';

// ── Platzhalter für den Simulationsmodus ──────────────────────────────────────

function simPlaceholders(member: GuildMember): Record<string, string> {
  return {
    user:        member.user.tag,
    username:    member.user.username,
    mention:     member.toString(),
    server:      member.guild.name,
    membercount: member.guild.memberCount.toString(),
    join_date:   new Date().toISOString().slice(0, 10),
  };
}

// ── Simulation-Badge (damit klar ist, dass es ein Test ist) ───────────────────

function simBadgeField() {
  return { name: '🧪 Simulation', value: 'Dies ist eine Testvorschau — keine echte Welcome-Nachricht.', inline: false };
}

// ── Welcome-Embed bauen (exakte Formatierung beibehalten) ────────────────────

async function buildSimWelcomeEmbed(
  member: GuildMember,
  s: Repo.WelcomeSettings,
  withCard: boolean,
): Promise<{ embed: EmbedBuilder; attachment: AttachmentBuilder | null }> {
  const ph   = simPlaceholders(member);
  // replacePlaceholders nutzt replaceAll — Zeilenumbrüche, Markdown, Leerzeichen bleiben exakt erhalten
  const text = s.message
    ? replacePlaceholders(s.message, ph)
    : `Willkommen auf **${member.guild.name}**, ${member.toString()}! 🎉\nDu bist Mitglied **#${member.guild.memberCount}**.`;

  let attachment: AttachmentBuilder | null = null;
  if (withCard && s.use_card) {
    try {
      const buf = await createWelcomeCard(member, s.background_url, s.card_image_url);
      attachment = new AttachmentBuilder(buf, { name: 'welcome-sim.png' });
    } catch (err) {
      console.error('[SimWelcome] card failed:', err);
    }
  }

  const embed = new EmbedBuilder()
    .setColor((s.color || '#5865f2') as `#${string}`)
    .setDescription(text)  // Keine Manipulation — exakt wie eingegeben
    .setTimestamp()
    .addFields(simBadgeField());

  if (attachment) embed.setImage('attachment://welcome-sim.png');

  return { embed, attachment };
}

// ── Leave-Embed bauen ────────────────────────────────────────────────────────

function buildSimLeaveEmbed(member: GuildMember, s: Repo.WelcomeSettings): EmbedBuilder {
  const ph   = simPlaceholders(member);
  const text = s.leave_message
    ? replacePlaceholders(s.leave_message, ph)
    : `**${member.user.tag}** hat den Server verlassen. (${member.guild.memberCount} Mitglieder)`;

  return new EmbedBuilder()
    .setColor((s.leave_color || '#ed4245') as `#${string}`)
    .setDescription(text)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp()
    .addFields(simBadgeField());
}

// ── Command-Definition ────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('simwelcome')
    .setDescription('Simulate welcome/leave messages for testing (admins only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    // /simwelcome run — in den konfigurierten Welcome-Kanal
    .addSubcommand(s =>
      s.setName('run')
        .setDescription('Send simulation to the configured welcome channel')
        .addBooleanOption(o =>
          o.setName('card').setDescription('Render welcome card? (default: yes)'),
        ),
    )

    // /simwelcome here — in den aktuellen Kanal
    .addSubcommand(s =>
      s.setName('here')
        .setDescription('Sends the simulation to this channel')
        .addBooleanOption(o =>
          o.setName('card').setDescription('Render welcome card? (default: yes)'),
        ),
    )

    // /simwelcome leave — Leave-Nachricht simulieren
    .addSubcommand(s =>
      s.setName('leave')
        .setDescription('Simulates a leave message in the configured leave channel'),
    )

    // /simwelcome dm — DM-Vorschau als ephemere Antwort
    .addSubcommand(s =>
      s.setName('dm')
        .setDescription('Shows the DM message as an ephemeral preview'),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const sub    = ix.options.getSubcommand();
    const gid    = ix.guildId!;
    const member = ix.member as GuildMember;
    const s      = Repo.getSettings(gid);

    // ── /simwelcome run ──────────────────────────────────────────────────────
    if (sub === 'run') {
      if (!s.channel_id) {
        return ix.reply({
          embeds: [error('Kein Welcome-Kanal konfiguriert.', 'Nutze zuerst `/welcome setup`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const ch = ix.guild!.channels.cache.get(s.channel_id) as TextChannel | undefined;
      if (!ch) {
        return ix.reply({
          embeds: [error('Welcome channel not found.', 'Channel may have been deleted.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await ix.deferReply({ flags: MessageFlags.Ephemeral });

      const withCard = ix.options.getBoolean('card') ?? true;
      const { embed, attachment } = await buildSimWelcomeEmbed(member, s, withCard);

      await ch.send({
        content: member.toString(),
        embeds: [embed],
        files: attachment ? [attachment] : [],
      });

      return ix.editReply({
        embeds: [info('✅ Simulation gesendet', `Welcome-Nachricht wurde in ${ch} gepostet.`)],
      });
    }

    // ── /simwelcome here ─────────────────────────────────────────────────────
    if (sub === 'here') {
      await ix.deferReply();

      const withCard = ix.options.getBoolean('card') ?? true;
      const { embed, attachment } = await buildSimWelcomeEmbed(member, s, withCard);

      return ix.editReply({
        content: member.toString(),
        embeds: [embed],
        files: attachment ? [attachment] : [],
      });
    }

    // ── /simwelcome leave ────────────────────────────────────────────────────
    if (sub === 'leave') {
      if (!s.leave_enabled || !s.leave_channel_id) {
        return ix.reply({
          embeds: [error(
            'Leave-Nachrichten nicht konfiguriert.',
            'Nutze `/welcome leave enabled:true channel:#kanal message:...`.',
          )],
          flags: MessageFlags.Ephemeral,
        });
      }

      const ch = ix.guild!.channels.cache.get(s.leave_channel_id) as TextChannel | undefined;
      if (!ch) {
        return ix.reply({
          embeds: [error('Leave-Kanal nicht gefunden.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = buildSimLeaveEmbed(member, s);
      await ch.send({ embeds: [embed] });

      return ix.reply({
        embeds: [info('✅ Leave-Simulation gesendet', `Leave-Nachricht wurde in ${ch} gepostet.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── /simwelcome dm ───────────────────────────────────────────────────────
    if (sub === 'dm') {
      if (!s.dm_enabled) {
        return ix.reply({
          embeds: [error('DM-Nachrichten sind deaktiviert.', 'Aktiviere sie mit `/welcome dm enabled:true`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const ph   = simPlaceholders(member);
      // Exakte Formatierung beibehalten — kein Trimming
      const text = s.dm_message
        ? replacePlaceholders(s.dm_message, ph)
        : `Welcome to **${member.guild.name}**! Great to have you here.`;

      const embed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle('📨 DM-Vorschau')
        .setDescription(text)
        .setTimestamp()
        .addFields(simBadgeField());

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
