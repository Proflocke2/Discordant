/**
 * /category — Ticket category management (Ticket Bot V2 style).
 *
 * Subcommands:
 *   add    – Add a category (with custom button text)
 *   remove – Remove a category
 *   list   – List categories of a panel
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  ChannelType, MessageFlags, EmbedBuilder,
} from 'discord.js';
import { success, error, info } from '../../utils/embeds';
import { promptText } from '../../utils/modalText';
import { tGuild } from '../../i18n';
import * as Repo from '../../modules/tickets/repository';
import { refreshPanelMessage } from '../../modules/tickets/service';

const COLOR_CHOICES = [
  { name: '🔵 Blue (Primary)',   value: 'primary'   },
  { name: '⚫ Grey (Secondary)', value: 'secondary' },
  { name: '🟢 Green (Success)',  value: 'success'   },
  { name: '🔴 Red (Danger)',     value: 'danger'    },
];

const MAX_CATEGORIES = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('category')
    .setDescription('Manage ticket categories')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    // /category add
    .addSubcommand(s =>
      s.setName('add').setDescription('Add a category to a ticket panel')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription('Category name (shown in modal & select options)').setRequired(true))
        .addChannelOption(o =>
          o.setName('category').setDescription('Discord category channel where tickets are created')
            .addChannelTypes(ChannelType.GuildCategory).setRequired(true),
        )
        // Ticket Bot V2 feature: custom button label
        .addStringOption(o =>
          o.setName('button_text').setDescription('Custom button / option label (default: same as label, max 80 chars)'),
        )
        .addStringOption(o => o.setName('emoji').setDescription('Button emoji (unicode or <:name:id>)'))
        .addStringOption(o =>
          o.setName('color').setDescription('Button color').addChoices(...COLOR_CHOICES),
        )
        .addRoleOption(o =>
          o.setName('support_role').setDescription('Role that can manage these tickets'),
        )
    )

    // /category setwelcome
    .addSubcommand(s =>
      s.setName('setwelcome').setDescription('Set the welcome message for a category (supports line breaks)')
        .addIntegerOption(o => o.setName('category_id').setDescription('Category ID').setRequired(true)),
    )

    // /category remove
    .addSubcommand(s =>
      s.setName('remove').setDescription('Remove a category from its panel')
        .addIntegerOption(o => o.setName('category_id').setDescription('Category ID').setRequired(true)),
    )

    // /category list
    .addSubcommand(s =>
      s.setName('list').setDescription('List all categories for a panel')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true)),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── ADD ─────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const panelId  = ix.options.getInteger('panel_id', true);
      const panel    = Repo.getPanel(panelId);

      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error(tGuild(gid, 'tickets.panel.not_found'))], flags: MessageFlags.Ephemeral });
      }

      const existing = Repo.listCategories(panelId);
      if (existing.length >= MAX_CATEGORIES) {
        return ix.reply({
          embeds: [error(`A panel can hold at most ${MAX_CATEGORIES} categories.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const label       = ix.options.getString('label', true);
      const buttonText  = ix.options.getString('button_text');
      const discordCat  = ix.options.getChannel('category', true);
      const emoji       = ix.options.getString('emoji');
      const color       = (ix.options.getString('color') ?? 'primary') as Repo.Category['color'];
      const supportRole = ix.options.getRole('support_role');

      if (label.length > 100) {
        return ix.reply({ embeds: [error('Label must be max 100 characters.')], flags: MessageFlags.Ephemeral });
      }
      if (buttonText && buttonText.length > 80) {
        return ix.reply({ embeds: [error('Button text must be max 80 characters.')], flags: MessageFlags.Ephemeral });
      }

      const cat = Repo.addCategory({
        panel_id:        panelId,
        guild_id:        gid,
        label,
        button_text:     buttonText ?? null,
        emoji:           emoji ?? null,
        color,
        category_id:     discordCat.id,
        support_role_id: supportRole?.id ?? null,
        welcome_message: null, // set via /category setwelcome
      });

      await refreshPanelMessage(ix.guild!, panel);

      return ix.reply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Category Added')
          .setColor('#57f287')
          .addFields(
            { name: 'Category ID',   value: `\`${cat.id}\``,                                    inline: true },
            { name: 'Label',         value: `${emoji ? emoji + ' ' : ''}${label}`,               inline: true },
            { name: 'Button Text',   value: buttonText ?? `*(same as label)*`,                   inline: true },
            { name: 'Discord Cat.',  value: `<#${discordCat.id}>`,                               inline: true },
            { name: 'Support Role',  value: supportRole ? `<@&${supportRole.id}>` : 'None',      inline: true },
            { name: 'Color',         value: color,                                               inline: true },
          )
          .setFooter({ text: `Panel: ${panel.title} • ${existing.length + 1}/${MAX_CATEGORIES} categories` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── SET WELCOME ─────────────────────────────────────────────────────────
    if (sub === 'setwelcome') {
      const catId = ix.options.getInteger('category_id', true);
      const cat   = Repo.getCategory(catId);
      if (!cat || cat.guild_id !== gid) {
        return ix.reply({ embeds: [error('Category not found.')], flags: MessageFlags.Ephemeral });
      }

      const result = await promptText(ix, {
        title:       'Welcome Message',
        label:       'Message shown in new tickets',
        placeholder: 'Welcome {user}! Staff will be with you shortly.\n\nPlease describe your issue.',
        current:     cat.welcome_message ?? '',
        maxLength:   2000,
        required:    false,
      });
      if (result === null) return;

      const msg = result.text.trim() || null;
      Repo.updateCategory(catId, { welcome_message: msg });
      return result.modal.reply({
        embeds: [success('✅ Welcome Message Set',
          msg ? `**Preview:**\n${msg.slice(0, 500)}` : 'Welcome message cleared.')],
        flags: MessageFlags.Ephemeral,
      });
    }

        // ── REMOVE ──────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const catId = ix.options.getInteger('category_id', true);
      const cat   = Repo.getCategory(catId);

      if (!cat || cat.guild_id !== gid) {
        return ix.reply({
          embeds: [error(tGuild(gid, 'tickets.panel.category_not_found'))],
          flags: MessageFlags.Ephemeral,
        });
      }

      Repo.deleteCategory(catId);
      const panel = Repo.getPanel(cat.panel_id);
      if (panel) await refreshPanelMessage(ix.guild!, panel);

      return ix.reply({
        embeds: [success('🗑️ Category Removed', `**${cat.label}** \`[${cat.id}]\` removed.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── LIST ────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const panelId = ix.options.getInteger('panel_id', true);
      const panel   = Repo.getPanel(panelId);

      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error(tGuild(gid, 'tickets.panel.not_found'))], flags: MessageFlags.Ephemeral });
      }

      const cats = Repo.listCategories(panelId);
      if (cats.length === 0) {
        return ix.reply({
          embeds: [info(`Categories — ${panel.title}`, 'No categories yet. Use `/category add` to add one.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`📂 Categories — ${panel.title}`)
        .setColor('#5865f2')
        .setFooter({ text: `${cats.length}/${MAX_CATEGORIES} categories` });

      for (const c of cats) {
        const buttonDisplay = c.button_text ? `"${c.button_text}"` : `*(= label)*`;
        embed.addFields({
          name:  `\`[${c.id}]\` ${c.emoji ? c.emoji + ' ' : ''}${c.label}`,
          value: `Button: ${buttonDisplay} • Color: ${c.color}\n` +
                 `Channel: <#${c.category_id}> • Role: ${c.support_role_id ? `<@&${c.support_role_id}>` : 'None'}`,
        });
      }

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
