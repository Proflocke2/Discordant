import { requireAdmin } from '../../utils/guards';
/**
 * /reactionroles — Button-based self-assignable roles.
 *
 * Subcommands:
 *   create  – Create a new reaction-role message with up to 5 buttons
 *   add     – Add a role-button to an existing message
 *   remove  – Remove a role-button
 *   delete  – Delete the whole reaction-role message
 *   list    – List all reaction-role panels in this guild
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  ChannelType, TextChannel, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, EmbedBuilder, MessageFlags,
} from 'discord.js';
import { success, error, info } from '../../utils/embeds';
import db from '../../database/db';

// ── DB schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS reaction_role_panels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT    NOT NULL,
    channel_id  TEXT    NOT NULL,
    message_id  TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT,
    color       TEXT    DEFAULT '#5865f2',
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS reaction_role_buttons (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id  INTEGER NOT NULL,
    guild_id  TEXT    NOT NULL,
    role_id   TEXT    NOT NULL,
    label     TEXT    NOT NULL,
    emoji     TEXT,
    style     TEXT    DEFAULT 'primary',
    FOREIGN KEY (panel_id) REFERENCES reaction_role_panels(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_rrp_guild ON reaction_role_panels(guild_id);
  CREATE INDEX IF NOT EXISTS idx_rrb_panel ON reaction_role_buttons(panel_id);
`);

// ── Types ──────────────────────────────────────────────────────────────────────

interface RRPanel {
  id: number; guild_id: string; channel_id: string; message_id: string;
  title: string; description: string | null; color: string;
}

interface RRButton {
  id: number; panel_id: number; guild_id: string;
  role_id: string; label: string; emoji: string | null; style: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STYLE_MAP: Record<string, ButtonStyle> = {
  primary:   ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success:   ButtonStyle.Success,
  danger:    ButtonStyle.Danger,
};

function buildPanelComponents(buttons: RRButton[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const chunk = buttons.slice(i, i + 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...chunk.map(b => {
        const btn = new ButtonBuilder()
          .setCustomId(`rr:toggle:${b.role_id}`)
          .setLabel(b.label)
          .setStyle(STYLE_MAP[b.style] ?? ButtonStyle.Primary);
        if (b.emoji) btn.setEmoji(b.emoji);
        return btn;
      }),
    );
    rows.push(row);
  }
  return rows;
}

function getPanel(id: number): RRPanel | null {
  return db.prepare('SELECT * FROM reaction_role_panels WHERE id = ?').get(id) as RRPanel | null;
}

function getButtons(panelId: number): RRButton[] {
  return db.prepare('SELECT * FROM reaction_role_buttons WHERE panel_id = ?').all(panelId) as RRButton[];
}

// ── Command ───────────────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('reactionroles')
    .setDescription('Manage self-assignable button roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)

    .addSubcommand(s =>
      s.setName('create').setDescription('Create a new reaction-role panel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post in')
          .addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Embed description'))
        .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #5865f2')),
    )

    .addSubcommand(s =>
      s.setName('add').setDescription('Add a role-button to a panel')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to assign/remove').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription('Button label').setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('Button emoji'))
        .addStringOption(o => o.setName('style').setDescription('Button color')
          .addChoices(
            { name: '🔵 Blue',  value: 'primary'   },
            { name: '⚫ Grey',  value: 'secondary' },
            { name: '🟢 Green', value: 'success'   },
            { name: '🔴 Red',   value: 'danger'    },
          )),
    )

    .addSubcommand(s =>
      s.setName('remove').setDescription('Remove a role-button from a panel')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)),
    )

    .addSubcommand(s =>
      s.setName('delete').setDescription('Delete a reaction-role panel')
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true)),
    )

    .addSubcommand(s =>
      s.setName('list').setDescription('List all reaction-role panels'),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    if (!await requireAdmin(ix)) return;
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const ch    = ix.options.getChannel('channel', true) as TextChannel;
      const title = ix.options.getString('title', true);
      const desc  = ix.options.getString('description');
      const color = (ix.options.getString('color') ?? '#5865f2') as `#${string}`;

      const embed = new EmbedBuilder().setTitle(title).setColor(color);
      if (desc) embed.setDescription(desc);
      embed.setFooter({ text: 'Click a button to assign/remove a role' });

      const msg = await ch.send({ embeds: [embed] });

      const result = db.prepare(`
        INSERT INTO reaction_role_panels (guild_id, channel_id, message_id, title, description, color)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(gid, ch.id, msg.id, title, desc, color);

      return ix.reply({
        embeds: [success('✅ Panel Created',
          `**ID:** \`${result.lastInsertRowid}\`\nAdd buttons with \`/reactionroles add panel_id:${result.lastInsertRowid}\``,
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── ADD ──────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const panelId = ix.options.getInteger('panel_id', true);
      const panel   = getPanel(panelId);

      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error('Panel not found.')], flags: MessageFlags.Ephemeral });
      }

      const buttons = getButtons(panelId);
      if (buttons.length >= 25) {
        return ix.reply({ embeds: [error('Max 25 buttons per panel.')], flags: MessageFlags.Ephemeral });
      }

      const role  = ix.options.getRole('role', true);
      const label = ix.options.getString('label', true);
      const emoji = ix.options.getString('emoji');
      const style = ix.options.getString('style') ?? 'primary';

      // Check duplicate
      if (buttons.some(b => b.role_id === role.id)) {
        return ix.reply({ embeds: [error(`${role} is already on this panel.`)], flags: MessageFlags.Ephemeral });
      }

      db.prepare(`
        INSERT INTO reaction_role_buttons (panel_id, guild_id, role_id, label, emoji, style)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(panelId, gid, role.id, label, emoji, style);

      // Refresh message
      const allButtons = getButtons(panelId);
      const ch  = ix.guild!.channels.cache.get(panel.channel_id) as TextChannel | undefined;
      const msg = await ch?.messages.fetch(panel.message_id).catch(() => null);
      if (msg) {
        await msg.edit({ components: buildPanelComponents(allButtons) }).catch(() => {});
      }

      return ix.reply({
        embeds: [success('✅ Button Added', `${role} → **${label}** added to panel \`${panelId}\``)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── REMOVE ───────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const panelId = ix.options.getInteger('panel_id', true);
      const panel   = getPanel(panelId);
      const role    = ix.options.getRole('role', true);

      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error('Panel not found.')], flags: MessageFlags.Ephemeral });
      }

      db.prepare('DELETE FROM reaction_role_buttons WHERE panel_id = ? AND role_id = ?').run(panelId, role.id);

      const remaining = getButtons(panelId);
      const ch  = ix.guild!.channels.cache.get(panel.channel_id) as TextChannel | undefined;
      const msg = await ch?.messages.fetch(panel.message_id).catch(() => null);
      if (msg) {
        await msg.edit({ components: buildPanelComponents(remaining) }).catch(() => {});
      }

      return ix.reply({
        embeds: [success('🗑️ Button Removed', `${role} removed from panel \`${panelId}\``)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const panelId = ix.options.getInteger('panel_id', true);
      const panel   = getPanel(panelId);

      if (!panel || panel.guild_id !== gid) {
        return ix.reply({ embeds: [error('Panel not found.')], flags: MessageFlags.Ephemeral });
      }

      const ch  = ix.guild!.channels.cache.get(panel.channel_id) as TextChannel | undefined;
      const msg = await ch?.messages.fetch(panel.message_id).catch(() => null);
      await msg?.delete().catch(() => {});

      db.prepare('DELETE FROM reaction_role_panels WHERE id = ?').run(panelId);

      return ix.reply({
        embeds: [success('🗑️ Panel Deleted', `Panel \`${panelId}\` deleted.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const panels = db.prepare('SELECT * FROM reaction_role_panels WHERE guild_id = ? ORDER BY id')
        .all(gid) as RRPanel[];

      if (panels.length === 0) {
        return ix.reply({
          embeds: [info('🎭 Reaction Roles', 'No panels yet — create one with `/reactionroles create`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder().setTitle('🎭 Reaction Role Panels').setColor('#5865f2');
      for (const p of panels) {
        const btns = getButtons(p.id);
        embed.addFields({
          name:  `\`[${p.id}]\` ${p.title} • <#${p.channel_id}>`,
          value: btns.length > 0
            ? btns.map(b => `  └ <@&${b.role_id}> — ${b.label}`).join('\n')
            : '  *No buttons yet*',
        });
      }

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
