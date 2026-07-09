/**
 * /ticket-type — define reusable ticket category templates.
 *
 * Each type has a custom ID (e.g. "1", "support", "bewerbung") that you
 * can reference in `/panel setup types:1,2,3`.
 *
 * Subcommands:
 *   create  — define a new type (or overwrite existing ID)
 *   list    — show all types in this server
 *   delete  — remove a type by ID
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  ChannelType, EmbedBuilder, MessageFlags,
} from 'discord.js';
import { success, error } from '../../utils/embeds';
import * as Repo from '../../modules/tickets/repository';

const COLOR_CHOICES = [
  { name: '🔵 Blue (Primary)',   value: 'primary'   },
  { name: '⚫ Grey (Secondary)', value: 'secondary' },
  { name: '🟢 Green (Success)',  value: 'success'   },
  { name: '🔴 Red (Danger)',     value: 'danger'    },
];

export default {
  data: new SlashCommandBuilder()
    .setName('ticket-type')
    .setDescription('Manage reusable ticket type templates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(s => s
      .setName('create')
      .setDescription('Create or update a ticket type')
      .addStringOption(o => o
        .setName('id')
        .setDescription('Your custom ID for this type (e.g. 1, support, bewerbung)')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(20))
      .addStringOption(o => o
        .setName('label')
        .setDescription('Button/dropdown label shown to users')
        .setRequired(true)
        .setMaxLength(80))
      .addChannelOption(o => o
        .setName('category')
        .setDescription('Discord category where tickets are created')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true))
      .addRoleOption(o => o
        .setName('role')
        .setDescription('Support role that can see these tickets'))
      .addStringOption(o => o
        .setName('emoji')
        .setDescription('Emoji for the button — type a unicode emoji (🎫) or custom emoji (<:name:id>)')
        .setAutocomplete(true))
      .addStringOption(o => o
        .setName('color')
        .setDescription('Button color')
        .addChoices(...COLOR_CHOICES))
      .addStringOption(o => o
        .setName('welcome')
        .setDescription('First message in the ticket (use {user} for mention)')))

    .addSubcommand(s => s
      .setName('list')
      .setDescription('List all ticket types in this server'))

    .addSubcommand(s => s
      .setName('delete')
      .setDescription('Delete a ticket type by ID')
      .addStringOption(o => o
        .setName('id')
        .setDescription('The custom ID to delete')
        .setRequired(true))),

  async autocomplete(ix: import('discord.js').AutocompleteInteraction) {
    const focused = ix.options.getFocused().toLowerCase();
    const COMMON = [
      '🎫','🎟️','📩','📨','💬','🗨️','🆘','❓','❗','⭐','🔥','💡','🛠️','⚙️',
      '📋','📌','📎','🔔','🚨','✅','❌','🔒','🔓','🏆','💎','🤝','📣','📢',
      '🎮','🎲','🖥️','💻','📱','🌐','🔗','💰','💸','🏅','🎖️','👑','🛡️','⚔️',
    ];
    const filtered = COMMON.filter(e => e.includes(focused) || focused === '').slice(0, 25);
    await ix.respond(filtered.map(e => ({ name: e, value: e })));
  },

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── CREATE ────────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const customId   = ix.options.getString('id', true).trim().toLowerCase();
      const label      = ix.options.getString('label', true);
      const category   = ix.options.getChannel('category', true);
      const role       = ix.options.getRole('role');
      const emoji      = ix.options.getString('emoji');
      const color      = ix.options.getString('color') ?? 'primary';
      const welcome    = ix.options.getString('welcome');

      Repo.upsertTicketType({
        custom_id:       customId,
        guild_id:        gid,
        label,
        emoji:           emoji ?? null,
        color,
        category_id:     category.id,
        support_role_id: role?.id ?? null,
        welcome_message: welcome ?? null,
      });

      const e = new EmbedBuilder()
        .setTitle('✅ Ticket type saved')
        .setColor('#57f287')
        .addFields(
          { name: 'ID',       value: `\`${customId}\``,                     inline: true },
          { name: 'Label',    value: label,                                  inline: true },
          { name: 'Emoji',    value: emoji ?? '—',                           inline: true },
          { name: 'Category', value: `<#${category.id}>`,                   inline: true },
          { name: 'Role',     value: role ? `<@&${role.id}>` : '—',         inline: true },
          { name: 'Color',    value: color,                                  inline: true },
        )
        .setFooter({ text: `Use this type in: /panel setup types:${customId},...` });

      return ix.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
    }

    // ── LIST ──────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const types = Repo.listTicketTypes(gid);
      if (types.length === 0) {
        return ix.reply({
          embeds: [error('No ticket types yet', 'Use `/ticket-type create` to add one.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const e = new EmbedBuilder()
        .setTitle(`🎫 Ticket Types (${types.length})`)
        .setColor('#5865f2')
        .setDescription(
          types.map(t =>
            `**\`${t.custom_id}\`** ${t.emoji ?? ''} **${t.label}**\n` +
            `↳ Category: <#${t.category_id}>  •  Role: ${t.support_role_id ? `<@&${t.support_role_id}>` : '—'}  •  Color: ${t.color}`
          ).join('\n\n')
        )
        .setFooter({ text: 'Reference these IDs in /panel setup types:id1,id2,...' });

      return ix.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const customId = ix.options.getString('id', true).trim().toLowerCase();
      const deleted  = Repo.deleteTicketType(gid, customId);
      if (!deleted) {
        return ix.reply({
          embeds: [error(`No ticket type with ID \`${customId}\` found.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return ix.reply({
        embeds: [success(`Ticket type \`${customId}\` deleted.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
