/**
 * /settings — Guild-wide ticket system configuration.
 *
 * Subcommand group: ticket
 *   view              – Show current settings
 *   cooldown          – Cooldown between ticket opens (seconds)
 *   max_open          – Max concurrent open tickets per user
 *   log_channel       – Channel where ticket events are logged
 *   archive_channel   – Channel where closed ticket transcripts are archived
 *   transcript_format – txt or html
 *   dm_on_close       – DM user when ticket is closed
 *   name_pattern      – Channel name pattern (supports {username}, {id})
 *   branding          – Toggle footer branding removal
 *   autoclose         – Enable/disable + set inactivity hours
 *   support_hours     – Configure support hours window (UTC)
 *   survey            – Enable/disable exit surveys
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { success, error } from '../../utils/embeds';
import * as Repo from '../../modules/tickets/repository';
import type { TranscriptFormat } from '../../modules/tickets/types';

const CONSTRAINTS = {
  COOLDOWN_SECONDS:  { min: 0,  max: 3600 },
  MAX_OPEN_TICKETS:  { min: 1,  max: 100  },
  AUTOCLOSE_HOURS:   { min: 1,  max: 720  },
} as const;

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export default {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure the ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    .addSubcommandGroup(group =>
      group
        .setName('ticket')
        .setDescription('Ticket system settings')

        .addSubcommand(s => s.setName('view').setDescription('View current ticket system settings'))

        .addSubcommand(s =>
          s.setName('cooldown').setDescription('Cooldown between ticket opens')
            .addIntegerOption(o =>
              o.setName('seconds').setDescription('Seconds (0 = disabled)')
                .setMinValue(CONSTRAINTS.COOLDOWN_SECONDS.min)
                .setMaxValue(CONSTRAINTS.COOLDOWN_SECONDS.max)
                .setRequired(true),
            ),
        )

        .addSubcommand(s =>
          s.setName('max_open').setDescription('Max open tickets per user')
            .addIntegerOption(o =>
              o.setName('count').setDescription('Maximum open tickets')
                .setMinValue(CONSTRAINTS.MAX_OPEN_TICKETS.min)
                .setMaxValue(CONSTRAINTS.MAX_OPEN_TICKETS.max)
                .setRequired(true),
            ),
        )

        .addSubcommand(s =>
          s.setName('log_channel').setDescription('Set the channel for ticket event logs')
            .addChannelOption(o =>
              o.setName('channel').setDescription('Log channel (leave empty to clear)')
                .addChannelTypes(ChannelType.GuildText),
            ),
        )

        .addSubcommand(s =>
          s.setName('archive_channel').setDescription('Channel where closed ticket transcripts are archived')
            .addChannelOption(o =>
              o.setName('channel').setDescription('Archive channel (leave empty to clear)')
                .addChannelTypes(ChannelType.GuildText),
            ),
        )

        .addSubcommand(s =>
          s.setName('transcript_format').setDescription('Set the transcript file format')
            .addStringOption(o =>
              o.setName('format').setDescription('Format').setRequired(true)
                .addChoices(
                  { name: 'TXT (plain text)', value: 'txt'  },
                  { name: 'HTML (styled)',     value: 'html' },
                ),
            ),
        )

        .addSubcommand(s =>
          s.setName('dm_on_close').setDescription('DM the ticket opener when their ticket is closed')
            .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable DMs on close').setRequired(true)),
        )

        .addSubcommand(s =>
          s.setName('name_pattern').setDescription('Channel name pattern (supports {username} and {id})')
            .addStringOption(o =>
              o.setName('pattern').setDescription('e.g. ticket-{username}-{id}').setRequired(true),
            ),
        )

        .addSubcommand(s =>
          s.setName('branding').setDescription('Remove "Powered by MultiBot" footer from ticket embeds')
            .addBooleanOption(o => o.setName('remove').setDescription('true = remove branding').setRequired(true)),
        )

        .addSubcommand(s =>
          s.setName('autoclose').setDescription('Auto-close inactive tickets')
            .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable autoclose').setRequired(true))
            .addIntegerOption(o =>
              o.setName('hours').setDescription('Hours of inactivity before closing (1–720)')
                .setMinValue(CONSTRAINTS.AUTOCLOSE_HOURS.min)
                .setMaxValue(CONSTRAINTS.AUTOCLOSE_HOURS.max),
            ),
        )

        .addSubcommand(s =>
          s.setName('support_hours').setDescription('Restrict ticket creation to specific UTC hours')
            .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable support hours').setRequired(true))
            .addStringOption(o =>
              o.setName('start').setDescription('Support start time in UTC (HH:MM) e.g. 09:00'),
            )
            .addStringOption(o =>
              o.setName('end').setDescription('Support end time in UTC (HH:MM) e.g. 18:00'),
            ),
        )

        .addSubcommand(s =>
          s.setName('survey').setDescription('Enable/disable exit survey when a ticket is closed')
            .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable exit surveys').setRequired(true)),
        ),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const gid   = ix.guildId!;
    const group = ix.options.getSubcommandGroup();
    const sub   = ix.options.getSubcommand();

    if (group !== 'ticket') return;

    if (sub === 'view') {
      const s = Repo.getSettings(gid);

      const supportHoursValue = s.support_hours_enabled
        ? (s.support_hours_start && s.support_hours_end
          ? `✅ ${s.support_hours_start}–${s.support_hours_end} UTC`
          : '✅ Enabled (no times set)')
        : '❌ Disabled';

      const autocloseValue = s.autoclose_enabled
        ? `✅ After **${s.autoclose_hours}h** inactivity`
        : '❌ Disabled';

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Ticket System Settings')
        .setColor('#5865f2')
        .addFields(
          { name: 'Log Channel',         value: s.log_channel_id     ? `<#${s.log_channel_id}>`     : '—', inline: true },
          { name: 'Archive Channel',     value: s.archive_channel_id ? `<#${s.archive_channel_id}>` : '—', inline: true },
          { name: 'Transcript Format',   value: s.transcript_format.toUpperCase(),                          inline: true },
          { name: 'Cooldown',            value: s.cooldown_seconds === 0 ? 'Disabled' : `${s.cooldown_seconds}s`, inline: true },
          { name: 'Max Open / User',     value: String(s.max_open),                                         inline: true },
          { name: 'DM on Close',         value: s.dm_on_close      ? '✅' : '❌',                            inline: true },
          { name: 'Branding Removed',    value: s.remove_branding  ? '✅' : '❌',                            inline: true },
          { name: 'Exit Survey',         value: s.survey_enabled   ? '✅' : '❌',                            inline: true },
          { name: 'Name Pattern',        value: `\`${s.name_pattern}\``,                                     inline: true },
          { name: 'Autoclose',           value: autocloseValue,                                              inline: false },
          { name: 'Support Hours (UTC)', value: supportHoursValue,                                           inline: false },
        )
        .setTimestamp();

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'cooldown') {
      const seconds = ix.options.getInteger('seconds', true);
      Repo.updateSettings(gid, { cooldown_seconds: seconds });
      return ix.reply({
        embeds: [success('Cooldown Updated', seconds === 0 ? 'No cooldown — users can open tickets immediately.' : `Cooldown set to **${seconds}s**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'max_open') {
      const count = ix.options.getInteger('count', true);
      Repo.updateSettings(gid, { max_open: count });
      return ix.reply({
        embeds: [success('Max Open Updated', `Users can now have at most **${count}** open ticket(s).`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'log_channel') {
      const channel = ix.options.getChannel('channel') as TextChannel | null;
      Repo.updateSettings(gid, { log_channel_id: channel?.id ?? null });
      return ix.reply({
        embeds: [success('Log Channel Updated', channel ? `Events logged in ${channel}.` : 'Log channel cleared.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'archive_channel') {
      const channel = ix.options.getChannel('channel') as TextChannel | null;
      Repo.updateSettings(gid, { archive_channel_id: channel?.id ?? null });
      return ix.reply({
        embeds: [success('Archive Channel Updated', channel ? `Closed ticket transcripts archived to ${channel}.` : 'Archive channel cleared.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'transcript_format') {
      const fmt = ix.options.getString('format', true) as TranscriptFormat;
      Repo.updateSettings(gid, { transcript_format: fmt });
      return ix.reply({
        embeds: [success('Transcript Format Updated', `Transcripts will now be generated as **${fmt.toUpperCase()}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'dm_on_close') {
      const enabled = ix.options.getBoolean('enabled', true);
      Repo.updateSettings(gid, { dm_on_close: enabled });
      return ix.reply({
        embeds: [success('DM on Close Updated', enabled ? 'Users will receive a DM with their transcript when closed.' : 'DM on close disabled.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'name_pattern') {
      const pattern = ix.options.getString('pattern', true);
      if (!pattern.includes('{username}') && !pattern.includes('{id}')) {
        return ix.reply({
          embeds: [error('Pattern must include `{username}` or `{id}`')],
          flags: MessageFlags.Ephemeral,
        });
      }
      Repo.updateSettings(gid, { name_pattern: pattern });
      return ix.reply({
        embeds: [success('Name Pattern Updated', `Using: \`${pattern}\``)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'branding') {
      const remove = ix.options.getBoolean('remove', true);
      Repo.updateSettings(gid, { remove_branding: remove });
      return ix.reply({
        embeds: [success('Branding Updated', remove ? '"Powered by MultiBot" footer removed.' : 'Default branding footer restored.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'autoclose') {
      const enabled = ix.options.getBoolean('enabled', true);
      const hours   = ix.options.getInteger('hours');
      const patch: Parameters<typeof Repo.updateSettings>[1] = { autoclose_enabled: enabled };
      if (hours !== null) patch.autoclose_hours = hours;
      Repo.updateSettings(gid, patch);
      const current = Repo.getSettings(gid);
      return ix.reply({
        embeds: [success('Autoclose Updated', enabled
          ? `Inactive tickets closed after **${current.autoclose_hours}h** of inactivity.`
          : 'Autoclose disabled.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'support_hours') {
      const enabled = ix.options.getBoolean('enabled', true);
      const start   = ix.options.getString('start');
      const end     = ix.options.getString('end');

      if (start && !TIME_REGEX.test(start)) {
        return ix.reply({ embeds: [error('Invalid start time — use HH:MM (e.g. `09:00`).')], flags: MessageFlags.Ephemeral });
      }
      if (end && !TIME_REGEX.test(end)) {
        return ix.reply({ embeds: [error('Invalid end time — use HH:MM (e.g. `18:00`).')], flags: MessageFlags.Ephemeral });
      }

      const patch: Parameters<typeof Repo.updateSettings>[1] = { support_hours_enabled: enabled };
      if (start !== null) patch.support_hours_start = start;
      if (end !== null)   patch.support_hours_end   = end;
      Repo.updateSettings(gid, patch);

      const current = Repo.getSettings(gid);
      const timeDesc = current.support_hours_start && current.support_hours_end
        ? `**${current.support_hours_start}–${current.support_hours_end} UTC**`
        : 'No hours set yet — use the `start` and `end` options.';

      return ix.reply({
        embeds: [success('Support Hours Updated', enabled ? `Tickets can only be opened during ${timeDesc}.` : 'Support hours disabled.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'survey') {
      const enabled = ix.options.getBoolean('enabled', true);
      Repo.updateSettings(gid, { survey_enabled: enabled });
      return ix.reply({
        embeds: [success('Exit Survey Updated', enabled ? 'Users will be asked to rate their experience on ticket close.' : 'Exit surveys disabled.')],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
