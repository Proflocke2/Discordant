import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  EmbedBuilder, MessageFlags, ChannelType, TextChannel,
} from 'discord.js';
import { requireAdmin } from '../../utils/guards';
import { success, error, info } from '../../utils/embeds';
import { getGuild } from '../../database/db';
import { getLocalized, Language } from '../../utils/localization';
import {
  getAntiNukeConfig, updateAntiNukeConfig,
  addToWhitelist, removeFromWhitelist, getWhitelist,
  getIncidents, isWhitelisted,
} from '../../modules/moderation/antiNuke';

export default {
  data: new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('Anti-Nuke protection — guards against compromised staff accounts')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(s => s.setName('setup').setDescription('Configure Anti-Nuke settings')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable').setRequired(true))
      .addStringOption(o => o.setName('action').setDescription('Action to take against the attacker')
        .addChoices(
          { name: '🔨 Ban (recommended)', value: 'ban' },
          { name: '👟 Kick',              value: 'kick' },
          { name: '🎭 Strip roles',       value: 'strip' },
        ))
      .addChannelOption(o => o.setName('log_channel').setDescription('Alert channel').addChannelTypes(ChannelType.GuildText))
      .addIntegerOption(o => o.setName('channel_delete_limit').setDescription('Max channel deletions in window_seconds (default: 3)').setMinValue(1).setMaxValue(20))
      .addIntegerOption(o => o.setName('role_delete_limit').setDescription('Max role deletions (default: 3)').setMinValue(1).setMaxValue(20))
      .addIntegerOption(o => o.setName('ban_limit').setDescription('Max bans by one mod (default: 5)').setMinValue(1).setMaxValue(30))
      .addIntegerOption(o => o.setName('webhook_limit').setDescription('Max webhook creations (default: 5)').setMinValue(1).setMaxValue(20))
      .addIntegerOption(o => o.setName('window_seconds').setDescription('Time window in seconds (default: 10)').setMinValue(5).setMaxValue(60)))
    .addSubcommand(s => s.setName('whitelist').setDescription('Add an admin to the whitelist (excluded from Anti-Nuke)')
      .addUserOption(o => o.setName('user').setDescription('Admin to whitelist').setRequired(true)))
    .addSubcommand(s => s.setName('unwhitelist').setDescription('Remove an admin from the whitelist')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(s => s.setName('whitelist-list').setDescription('Show current whitelist'))
    .addSubcommand(s => s.setName('incidents').setDescription('Show recent Anti-Nuke interventions'))
    .addSubcommand(s => s.setName('status').setDescription('Show current Anti-Nuke configuration')),

  async execute(ix: ChatInputCommandInteraction) {
    if (!await requireAdmin(ix)) return;
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;
    const lang = ((getGuild(gid) as any).language || 'en') as Language;
    const t = (key: string, vars?: Record<string, string>) => getLocalized(key, lang, vars);

    if (sub === 'setup') {
      const enabled    = ix.options.getBoolean('enabled', true);
      const action     = ix.options.getString('action') as 'ban' | 'kick' | 'strip' | null;
      const logCh      = ix.options.getChannel('log_channel') as TextChannel | null;
      const chDel      = ix.options.getInteger('channel_delete_limit');
      const roleDel    = ix.options.getInteger('role_delete_limit');
      const banLim     = ix.options.getInteger('ban_limit');
      const webhookLim = ix.options.getInteger('webhook_limit');
      const window     = ix.options.getInteger('window_seconds');

      updateAntiNukeConfig(gid, {
        enabled: enabled ? 1 : 0,
        ...(action     && { action }),
        ...(logCh      && { log_channel_id: logCh.id }),
        ...(chDel      && { channel_delete_limit: chDel }),
        ...(roleDel    && { role_delete_limit: roleDel }),
        ...(banLim     && { ban_limit: banLim }),
        ...(webhookLim && { webhook_limit: webhookLim }),
        ...(window     && { window_seconds: window }),
      });

      const cfg = getAntiNukeConfig(gid);
      return ix.reply({
        embeds: [success(
          t(enabled ? 'antinuke.enabled' : 'antinuke.disabled'),
          enabled ? t('antinuke.setup_desc', {
            action: cfg.action,
            ch_del:   String(cfg.channel_delete_limit),
            role_del: String(cfg.role_delete_limit),
            ban_lim:  String(cfg.ban_limit),
            wh_lim:   String(cfg.webhook_limit),
            window:   String(cfg.window_seconds),
            log_ch:   cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : t('antinuke.not_set'),
          }) : '',
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'whitelist') {
      const user = ix.options.getUser('user', true);
      if (user.id === ix.guild!.ownerId)
        return ix.reply({ embeds: [info('Info', t('antinuke.owner_exempt'))], flags: MessageFlags.Ephemeral });
      addToWhitelist(gid, user.id, ix.user.id);
      return ix.reply({
        embeds: [success('✅ Whitelist', t('antinuke.wl_added', { user: user.id }))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'unwhitelist') {
      const user = ix.options.getUser('user', true);
      if (!isWhitelisted(gid, user.id))
        return ix.reply({ embeds: [error('Error', t('antinuke.wl_not_found', { user: user.id }))], flags: MessageFlags.Ephemeral });
      removeFromWhitelist(gid, user.id);
      return ix.reply({ embeds: [success('🗑️', t('antinuke.wl_removed', { user: user.id }))], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'whitelist-list') {
      const list = getWhitelist(gid);
      if (!list.length)
        return ix.reply({ embeds: [info('Whitelist', t('antinuke.wl_empty'))], flags: MessageFlags.Ephemeral });
      return ix.reply({
        embeds: [new EmbedBuilder().setColor('#5865f2').setTitle('🛡️ Anti-Nuke Whitelist')
          .setDescription(list.map(e => `• <@${e.user_id}> — ${t('antinuke.wl_added_by')} <@${e.added_by}> <t:${e.added_at}:R>`).join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'incidents') {
      const incidents = getIncidents(gid);
      if (!incidents.length)
        return ix.reply({ embeds: [info('', t('antinuke.no_incidents'))], flags: MessageFlags.Ephemeral });
      return ix.reply({
        embeds: [new EmbedBuilder().setColor('#ed4245').setTitle(t('antinuke.incidents_title'))
          .setDescription(incidents.map(i =>
            `**#${i.id}** <t:${i.created_at}:R>\n<@${i.attacker_id}> — ${i.event_type} (${i.count}x) → **${i.action_taken}**`
          ).join('\n\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'status') {
      const cfg = getAntiNukeConfig(gid);
      const wl  = getWhitelist(gid);
      return ix.reply({
        embeds: [new EmbedBuilder()
          .setColor(cfg.enabled ? '#57f287' : '#ed4245')
          .setTitle(t('antinuke.status_title'))
          .addFields(
            { name: t('antinuke.field_status'),    value: cfg.enabled ? t('antinuke.active') : t('antinuke.inactive'), inline: true },
            { name: t('antinuke.field_action'),    value: cfg.action, inline: true },
            { name: t('antinuke.field_log'),       value: cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : t('antinuke.not_set'), inline: true },
            { name: t('antinuke.field_window'),    value: `${cfg.window_seconds}s`, inline: true },
            { name: t('antinuke.field_ch_del'),    value: t('antinuke.max', { n: String(cfg.channel_delete_limit) }), inline: true },
            { name: t('antinuke.field_role_del'),  value: t('antinuke.max', { n: String(cfg.role_delete_limit) }), inline: true },
            { name: t('antinuke.field_bans'),      value: t('antinuke.max', { n: String(cfg.ban_limit) }), inline: true },
            { name: t('antinuke.field_webhooks'),  value: t('antinuke.max', { n: String(cfg.webhook_limit) }), inline: true },
            { name: t('antinuke.field_whitelist'), value: t('antinuke.field_entries', { n: String(wl.length) }), inline: true },
          ).setTimestamp()],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
