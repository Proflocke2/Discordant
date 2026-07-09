/**
 * /welcome — configure the welcome system.
 *
 * Subcommands: setup, disable, dm, leave, autorole, alt, background,
 *              cardimage (NEW — set a custom banner image for the card),
 *              preview.
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  ChannelType, TextChannel, GuildMember, EmbedBuilder, AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import { promptText } from '../../utils/modalText';
import { success, error } from '../../utils/embeds';
import { isSafeHttpsUrl } from '../../utils/validators';
import { tGuild } from '../../i18n';
import * as Repo from '../../modules/welcome/repository';
import { createWelcomeCard } from '../../modules/welcome/card';
import { setGuildValue } from '../../database/db';

export default {
  data: new SlashCommandBuilder()
    .setName('welcome').setDescription('Configure the welcome system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(s => s.setName('setup').setDescription('Configure welcome channel + message')
      .addChannelOption(o => o.setName('channel').setDescription('Welcome channel')
        .addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Use {user}/{username}/{mention}/{server}/{membercount}/{join_date}'))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex'))
      .addBooleanOption(o => o.setName('use_card').setDescription('Render the welcome canvas card (default: yes)')))

    .addSubcommand(s => s.setName('disable').setDescription('Disable welcome messages'))

    .addSubcommand(s => s.setName('dm').setDescription('Configure private welcome DM')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable / disable').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('DM body (placeholders supported)')))

    .addSubcommand(s => s.setName('leave').setDescription('Configure leave message')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable / disable').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Leave-message channel')
        .addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('message').setDescription('Body (placeholders supported)'))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex')))

    .addSubcommand(s => s.setName('autorole').setDescription('Configure auto-roles')
      .addRoleOption(o => o.setName('instant').setDescription('Role applied immediately on join'))
      .addRoleOption(o => o.setName('delayed').setDescription('Role applied after a delay'))
      .addIntegerOption(o => o.setName('delay_minutes').setDescription('Delay in minutes (0 to clear delayed)')
        .setMinValue(0).setMaxValue(10080))
      .addRoleOption(o => o.setName('after_verify').setDescription('Role applied after user verifies')))

    .addSubcommand(s => s.setName('alt').setDescription('Configure alt-account detection')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable / disable').setRequired(true))
      .addIntegerOption(o => o.setName('min_age_days').setDescription('Minimum account age (default 7)')
        .setMinValue(1).setMaxValue(365))
      .addChannelOption(o => o.setName('log_channel').setDescription('Log channel for alerts')
        .addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('action').setDescription('Action to take')
        .addChoices({ name: 'Log only',  value: 'log' }, { name: 'Auto-kick', value: 'kick' })))

    .addSubcommand(s => s.setName('background').setDescription('Set or clear the welcome card background image')
      .addStringOption(o => o.setName('url').setDescription('HTTPS image URL (PNG/JPG/GIF/WEBP) — leave blank to reset')))

    .addSubcommand(s => s.setName('cardimage').setDescription('Set a custom banner image shown on the right side of the card (like Welcomer bot)')
      .addStringOption(o => o.setName('url').setDescription('HTTPS image URL (PNG/JPG/GIF/WEBP) — leave blank to remove')))

    .addSubcommand(s => s.setName('avatarbg').setDescription("Use the member's own avatar as the card background")
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable avatar background').setRequired(true)))

    .addSubcommand(s => s.setName('preview').setDescription('Preview your welcome card')),

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    if (sub === 'setup') {
      const ch   = ix.options.getChannel('channel', true) as TextChannel;
      const col  = ix.options.getString('color') ?? '#5865f2';
      const card = ix.options.getBoolean('use_card') ?? true;
      const existMsg = Repo.getSettings(gid).message ?? '';

      const result = await promptText(ix, {
        title: 'Welcome Message',
        label: 'Message (leave empty for default)',
        placeholder: 'Welcome to {server}, {user}! You are member #{membercount}.',
        current: existMsg,
        maxLength: 2000,
        required: false,
      });
      if (result === null) return;

      const msg = result.text.trim() || null;
      Repo.updateSettings(gid, { enabled: 1, channel_id: ch.id, message: msg, color: col, use_card: card ? 1 : 0 });
      setGuildValue(gid, 'welcome_channel', ch.id);
      setGuildValue(gid, 'welcome_message', msg);
      setGuildValue(gid, 'welcome_color', col);
      setGuildValue(gid, 'welcome_embed', 1);

      return result.modal.reply({
        embeds: [success(
          tGuild(gid, 'welcome.setup.configured'),
          `${tGuild(gid, 'welcome.setup.channel_label', { channel: ch.toString() })}
${tGuild(gid, 'welcome.setup.message_label', { message: msg ?? '<default>' })}`,
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

        if (sub === 'disable') {
      Repo.updateSettings(gid, { enabled: 0 });
      setGuildValue(gid, 'welcome_channel', null);
      return ix.reply({ embeds: [success(tGuild(gid, 'welcome.setup.disabled'))], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'dm') {
      const en = ix.options.getBoolean('enabled', true);
      if (en) {
        const existDm = Repo.getSettings(gid).dm_message ?? '';
        const result = await promptText(ix, {
          title: 'DM Welcome Message',
          label: 'DM text (leave empty for default)',
          placeholder: 'Welcome {user}! Glad to have you.',
          current: existDm,
          maxLength: 2000,
          required: false,
        });
        if (result === null) return;
        Repo.updateSettings(gid, { dm_enabled: 1, dm_message: result.text.trim() || null });
        return result.modal.reply({
          embeds: [success(tGuild(gid, 'welcome.setup.dm_set'))],
          flags: MessageFlags.Ephemeral,
        });
      }
      Repo.updateSettings(gid, { dm_enabled: 0 });
      return ix.reply({ embeds: [success(tGuild(gid, 'welcome.setup.dm_disabled'))], flags: MessageFlags.Ephemeral });
    }

        if (sub === 'leave') {
      const en     = ix.options.getBoolean('enabled', true);
      const leaveCh = (ix.options.getChannel('channel') as TextChannel | null);
      const col    = ix.options.getString('color') ?? '#ed4245';
      const existLeave = Repo.getSettings(gid).leave_message ?? '';

      if (en) {
        const result = await promptText(ix, {
          title: 'Leave Message',
          label: 'Message (placeholders: {user}, {server})',
          placeholder: '{user} has left the server.',
          current: existLeave,
          maxLength: 2000,
          required: false,
        });
        if (result === null) return;
        Repo.updateSettings(gid, {
          leave_enabled: 1,
          leave_channel_id: leaveCh?.id ?? null,
          leave_message: result.text.trim() || null,
          leave_color: col,
        });
        return result.modal.reply({
          embeds: [success(tGuild(gid, 'welcome.setup.leave_configured'))],
          flags: MessageFlags.Ephemeral,
        });
      }
      Repo.updateSettings(gid, { leave_enabled: 0 });
      return ix.reply({
        embeds: [success(tGuild(gid, 'welcome.setup.leave_disabled'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'autorole') {
      const inst = ix.options.getRole('instant');
      const del  = ix.options.getRole('delayed');
      const min  = ix.options.getInteger('delay_minutes');
      const ver  = ix.options.getRole('after_verify');
      const lines: string[] = [];

      if (inst !== null) {
        Repo.updateSettings(gid, { autorole_id: inst.id });
        lines.push(tGuild(gid, 'welcome.autorole.instant_set', { role: inst.toString() }));
      }
      if (del !== null && (min ?? 0) > 0) {
        Repo.updateSettings(gid, { autorole_delay_id: del.id, autorole_delay_min: min ?? 0 });
        lines.push(tGuild(gid, 'welcome.autorole.delayed_set', { role: del.toString(), minutes: min ?? 0 }));
      } else if (min === 0) {
        Repo.updateSettings(gid, { autorole_delay_id: null, autorole_delay_min: 0 });
        lines.push(tGuild(gid, 'welcome.autorole.delayed_cleared'));
      }
      if (ver !== null) {
        Repo.updateSettings(gid, { autorole_after_verify: ver.id });
        lines.push(tGuild(gid, 'welcome.autorole.after_verify_set', { role: ver.toString() }));
      }
      if (lines.length === 0) lines.push('No changes.');
      return ix.reply({ embeds: [success('Auto-roles', lines.join('\n'))], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'alt') {
      const en = ix.options.getBoolean('enabled', true);
      const days = ix.options.getInteger('min_age_days') ?? 7;
      const log  = ix.options.getChannel('log_channel') as TextChannel | null;
      const act  = (ix.options.getString('action') ?? 'log') as 'log' | 'kick';
      Repo.updateSettings(gid, {
        alt_enabled: en ? 1 : 0,
        alt_min_age_days: days,
        alt_log_channel_id: log?.id ?? null,
        alt_action: act,
      });
      return ix.reply({
        embeds: [success(en ? tGuild(gid, 'welcome.alt.configured', { days }) : tGuild(gid, 'welcome.alt.disabled'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'background') {
      const url = ix.options.getString('url');
      if (url && !isSafeHttpsUrl(url)) {
        return ix.reply({ embeds: [error('Invalid URL', 'Only HTTPS URLs (PNG/JPG/GIF/WEBP) are allowed.')], flags: MessageFlags.Ephemeral });
      }
      Repo.updateSettings(gid, { background_url: url });
      return ix.reply({
        embeds: [success(url ? tGuild(gid, 'welcome.setup.background_set') : tGuild(gid, 'welcome.setup.background_cleared'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'cardimage') {
      const url = ix.options.getString('url');
      if (url && !isSafeHttpsUrl(url)) {
        return ix.reply({ embeds: [error('Invalid URL', 'Only HTTPS URLs (PNG/JPG/GIF/WEBP) are allowed.')], flags: MessageFlags.Ephemeral });
      }
      Repo.updateSettings(gid, { card_image_url: url });
      return ix.reply({
        embeds: [success(
          url ? '🖼️ Karten-Bild gesetzt' : '🖼️ Karten-Bild entfernt',
          url
            ? `Das Bild wird rechts auf der Welcome-Karte angezeigt.\nURL: \`${url.slice(0, 80)}\`\n\nTipp: Verwende \`/welcome preview\` um das Ergebnis zu sehen.`
            : 'Das benutzerdefinierte Karten-Bild wurde entfernt.',
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'avatarbg') {
      const enabled = ix.options.getBoolean('enabled', true);
      Repo.updateSettings(gid, { avatar_bg_enabled: enabled ? 1 : 0 });
      return ix.reply({
        embeds: [success(
          enabled ? '🖼️ Avatar-Hintergrund aktiviert' : '🖼️ Avatar-Hintergrund deaktiviert',
          enabled
            ? "Das Profilbild des beitretenden Members wird als Kartenhintergrund verwendet.\n\nHinweis: Ein eigenes Hintergrundbild via `/welcome background` hat keine Wirkung solange dies aktiv ist.\n\nVorschau: `/welcome preview`"
            : 'The card background reverts to the default or your set image.',
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'preview') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const member = ix.member as GuildMember;
      const s = Repo.getSettings(gid);
      try {
        const buf = await createWelcomeCard(member, s.background_url, s.card_image_url, s.avatar_bg_enabled === 1);
        const att = new AttachmentBuilder(buf, { name: 'welcome-preview.png' });
        const e = new EmbedBuilder()
          .setColor((s.color || '#5865f2') as `#${string}`)
          .setTitle(tGuild(gid, 'welcome.preview.title'))
          .setDescription(tGuild(gid, 'welcome.preview.body', {
            user: member.toString(), count: member.guild.memberCount,
          }))
          .setImage('attachment://welcome-preview.png');
        await ix.editReply({ embeds: [e], files: [att] });
      } catch {
        await ix.editReply({ content: tGuild(gid, 'welcome.setup.preview_failed') });
      }
    }
  },
};
