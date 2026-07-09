/**
 * /panel — Ticket panel management (V2).
 *
 * Subcommands:
 *   create   – Create a new ticket panel
 *   list     – List all panels
 *   send     – Post a panel to a channel
 *   delete   – Delete a panel
 *   edit     – Edit a specific field (title, description, color, mode, image, thumbnail, footer)
 *
 * Category management → /category
 * Form management     → /form
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
import { success, error, info } from '../../utils/embeds';
import { promptText } from '../../utils/modalText';
import { tGuild } from '../../i18n';
import * as Repo from '../../modules/tickets/repository';
import { buildPanelEmbed, buildPanelComponents } from '../../modules/tickets/builder';
import { refreshPanelMessage } from '../../modules/tickets/service';
const VALID_HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const CONSTRAINTS = { PANEL_TITLE: { min: 1, max: 256 } } as const;

export default {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Manage ticket panels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    // /panel create
    .addSubcommand(s =>
      s.setName('create').setDescription('Create a new ticket panel')
        .addStringOption(o => o.setName('title').setDescription('Panel title (1-256 chars)').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Panel description / subtitle'))
        .addStringOption(o => o.setName('color').setDescription('Embed color as hex (e.g. #5865f2)'))
        .addStringOption(o => o.setName('mode').setDescription('Rendering mode')
          .addChoices(
            { name: '🤖 Auto (recommended)', value: 'auto'     },
            { name: '🔘 Buttons',             value: 'button'   },
            { name: '📋 Dropdown',            value: 'dropdown' },
          ))
        .addStringOption(o => o.setName('image').setDescription('Large embed image URL'))
        .addStringOption(o => o.setName('thumbnail').setDescription('Small corner thumbnail URL'))
        .addStringOption(o => o.setName('footer').setDescription('Embed footer text'))
        .addStringOption(o => o.setName('content').setDescription('Plain text above the embed (supports @mentions)')),
    )

    // /panel list
    .addSubcommand(s =>
      s.setName('list').setDescription('List all panels in this guild'),
    )

    // /panel send
    .addSubcommand(s =>
      s.setName('send').setDescription('Send a panel to a channel')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Target channel')
          .addChannelTypes(ChannelType.GuildText).setRequired(true)),
    )

    // /panel delete
    .addSubcommand(s =>
      s.setName('delete').setDescription('Delete a panel permanently')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true)),
    )

    // /panel edit
    .addSubcommand(s =>
      s.setName('edit').setDescription('Edit a single field of an existing panel')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
        .addStringOption(o =>
          o.setName('field').setDescription('Which field to edit').setRequired(true)
            .addChoices(
              { name: 'Title',       value: 'title'       },
              { name: 'Description', value: 'description' },
              { name: 'Color',       value: 'color'       },
              { name: 'Mode',        value: 'mode'        },
              { name: 'Image',       value: 'image'       },
              { name: 'Thumbnail',   value: 'thumbnail'   },
              { name: 'Footer',      value: 'footer'      },
              { name: 'Content',     value: 'content'     },
            ),
        )
        .addStringOption(o => o.setName('value').setDescription('New value').setRequired(true)),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const title     = ix.options.getString('title', true);
      const color     = ix.options.getString('color') ?? '#5865f2';
      const mode      = (ix.options.getString('mode') ?? 'auto') as Repo.Panel['mode'];

      if (title.length < CONSTRAINTS.PANEL_TITLE.min || title.length > CONSTRAINTS.PANEL_TITLE.max) {
        return ix.reply({
          embeds: [error(`Title must be ${CONSTRAINTS.PANEL_TITLE.min}–${CONSTRAINTS.PANEL_TITLE.max} characters.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!VALID_HEX_COLOR_REGEX.test(color)) {
        return ix.reply({
          embeds: [error('Invalid color — use hex format, e.g. `#5865f2`')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const panel = Repo.createPanel({
        guild_id:    gid,
        title,
        description: ix.options.getString('description') ?? null,
        color,
        mode,
        image:       ix.options.getString('image'),
        thumbnail:   ix.options.getString('thumbnail'),
        footer:      ix.options.getString('footer'),
        content:     ix.options.getString('content') ?? null,
      });

      return ix.reply({
        embeds: [
          success(
            '✅ Panel Created',
            `**Title:** ${panel.title}  •  **Mode:** ${panel.mode}\n\n` +
            'Next steps:\n' +
            `• \`/category add panel_id:${panel.id}\` — add ticket categories\n` +
            `• \`/panel send panel_id:${panel.id}\` — post the panel to a channel\n` +
            `• \`/multipanel addpanel panel_ids:${panel.id}\` — add to a multi-panel`,
          ),
          new EmbedBuilder()
            .setColor(0x5865f2)
            .addFields({
              name: '🪪 Panel ID',
              value: `\`\`\`\n${panel.id}\n\`\`\``,
            }),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── LIST ────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const panels = Repo.listPanels(gid);
      if (panels.length === 0) {
        return ix.reply({
          embeds: [info('📋 Ticket Panels', 'No panels yet — create one with `/panel create`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder().setTitle('📋 Ticket Panels').setColor('#5865f2').setTimestamp();
      for (const p of panels) {
        const cats = Repo.listCategories(p.id);
        const sent = p.message_id ? `✅ <#${p.channel_id}>` : '⏳ Not sent yet';
        const list = cats.length > 0
          ? cats.map(c => `  └ \`[${c.id}]\` ${c.emoji ?? '🎫'} **${c.label}** → <#${c.category_id}>`).join('\n')
          : '  *No categories — use `/category add`*';
        embed.addFields({ name: `\`[${p.id}]\` ${p.title} • ${p.mode} • ${sent}`, value: list });
      }

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── SEND ────────────────────────────────────────────────────────────────
    if (sub === 'send') {
      const panel   = Repo.getPanel(ix.options.getInteger('panel_id', true));
      const channel = ix.options.getChannel('channel', true) as TextChannel;

      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error(tGuild(gid, 'tickets.panel.not_found'))], flags: MessageFlags.Ephemeral });
      }
      const cats = Repo.listCategories(panel.id);
      if (cats.length === 0) {
        return ix.reply({
          embeds: [error('This panel has no categories. Use `/category add` first.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const msg = await channel.send({
        content:    panel.content ?? undefined,
        embeds:     [buildPanelEmbed(panel)],
        components: buildPanelComponents(panel, cats) as any,
      });
      Repo.updatePanelMessage(panel.id, channel.id, msg.id);

      return ix.reply({
        embeds: [success('✅ Panel Sent', `**${panel.title}** posted in ${channel}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── DELETE ──────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const panel = Repo.getPanel(ix.options.getInteger('panel_id', true));
      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error(tGuild(gid, 'tickets.panel.not_found'))], flags: MessageFlags.Ephemeral });
      }
      Repo.deletePanel(panel.id);
      return ix.reply({
        embeds: [success('🗑️ Panel Deleted', `Panel \`[${panel.id}]\` **${panel.title}** deleted.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── EDIT ────────────────────────────────────────────────────────────────
    if (sub === 'edit') {
      const panelId = ix.options.getInteger('panel_id', true);
      const panel   = Repo.getPanel(panelId);
      const field   = ix.options.getString('field', true) as
        'title' | 'description' | 'color' | 'mode' | 'image' | 'thumbnail' | 'footer' | 'content';

      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error(tGuild(gid, 'tickets.panel.not_found'))], flags: MessageFlags.Ephemeral });
      }

      // description + content → Modal (echte Zeilenumbrüche)
      if (field === 'description' || field === 'content') {
        const current = field === 'description' ? panel.description : panel.content;
        const result = await promptText(ix, {
          title:       `Edit Panel: ${field}`,
          label:       field === 'description' ? 'Panel description' : 'Message above the panel',
          placeholder: 'Supports **markdown** and line breaks.',
          current:     current ?? '',
          maxLength:   2000,
          required:    false,
        });
        if (result === null) return;
        const resolvedValue = result.text.trim() || null;
        Repo.updatePanel(panelId, { [field]: resolvedValue });
        const updated = Repo.getPanel(panelId)!;
        if (updated.message_id && updated.channel_id) await refreshPanelMessage(ix.guild!, updated);
        return result.modal.reply({
          embeds: [success('✏️ Panel Updated', `**${field}** updated${updated.message_id ? ' — live panel refreshed.' : '.'}`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      // alle anderen Felder: String-Option wie bisher
      const value = ix.options.getString('value', true);
      if (field === 'color' && !VALID_HEX_COLOR_REGEX.test(value)) {
        return ix.reply({ embeds: [error('Invalid hex color — e.g. `#5865f2`')], flags: MessageFlags.Ephemeral });
      }
      if (field === 'mode' && !['auto', 'button', 'dropdown'].includes(value)) {
        return ix.reply({ embeds: [error('Invalid mode. Use `auto`, `button`, or `dropdown`.')], flags: MessageFlags.Ephemeral });
      }
      if (field === 'title' && (value.length < 1 || value.length > 256)) {
        return ix.reply({ embeds: [error('Title must be 1–256 characters.')], flags: MessageFlags.Ephemeral });
      }
      Repo.updatePanel(panelId, { [field]: value });
      const updated = Repo.getPanel(panelId)!;
      if (updated.message_id && updated.channel_id) await refreshPanelMessage(ix.guild!, updated);
      return ix.reply({
        embeds: [success('✏️ Panel Updated', `**${field}** set to \`${value}\`${updated.message_id ? ' — live panel refreshed.' : '.'}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
