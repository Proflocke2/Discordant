import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, ButtonInteraction, PermissionFlagsBits,
} from 'discord.js';
import db from '../../database/db';
import { getEconomyUser, addPoints } from '../../economy/db/EconomyDB';
import { success, error } from '../../utils/embeds';
import { requireAdmin } from '../../utils/guards';

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shop_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price INTEGER NOT NULL,
      type TEXT DEFAULT 'cosmetic',
      role_id TEXT,
      stock INTEGER DEFAULT -1,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS shop_inventory (
      user_id TEXT NOT NULL, guild_id TEXT NOT NULL, item_id INTEGER NOT NULL,
      purchased_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, guild_id, item_id)
    );
  `);
}

export default {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Server item shop')
    .addSubcommand(s => s.setName('browse').setDescription('Browse available items'))
    .addSubcommand(s => s.setName('buy').setDescription('Buy an item')
      .addIntegerOption(o => o.setName('item_id').setDescription('Item ID from /shop browse').setRequired(true)))
    .addSubcommand(s => s.setName('inventory').setDescription('View your purchased items'))
    .addSubcommand(s => s.setName('add').setDescription('[Admin] Add a shop item')
      .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('Price in coins').setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName('description').setDescription('Item description'))
      .addRoleOption(o => o.setName('role').setDescription('Role to grant on purchase'))
      .addIntegerOption(o => o.setName('stock').setDescription('Stock (-1 = unlimited)').setMinValue(-1)))
    .addSubcommand(s => s.setName('remove').setDescription('[Admin] Remove a shop item')
      .addIntegerOption(o => o.setName('item_id').setDescription('Item ID').setRequired(true))),

  async execute(ix: ChatInputCommandInteraction) {
    initTables();
    const sub = ix.options.getSubcommand();
    const guildId = ix.guildId!;

    if (sub === 'browse') {
      const items = db.prepare('SELECT * FROM shop_items WHERE guild_id=? AND (stock=-1 OR stock>0) ORDER BY price').all(guildId) as any[];
      if (!items.length) return ix.reply({ embeds: [new EmbedBuilder().setTitle('🛍️ Shop').setColor('#faa61a').setDescription('No items available.')], ephemeral: true });

      const embed = new EmbedBuilder().setTitle('🛍️ Server Shop').setColor('#faa61a')
        .setDescription(items.map(i =>
          `**#${i.id} ${i.name}** — ${i.price.toLocaleString()} coins\n*${i.description || 'No description'}*${i.role_id ? ` • Grants <@&${i.role_id}>` : ''}${i.stock !== -1 ? ` • Stock: ${i.stock}` : ''}`
        ).join('\n\n'))
        .setFooter({ text: 'Use /shop buy <item_id> to purchase' });
      return ix.reply({ embeds: [embed] });
    }

    if (sub === 'buy') {
      const itemId = ix.options.getInteger('item_id', true);
      const item = db.prepare('SELECT * FROM shop_items WHERE id=? AND guild_id=?').get(itemId, guildId) as any;
      if (!item) return ix.reply({ embeds: [error('Item not found')], ephemeral: true });
      if (item.stock === 0) return ix.reply({ embeds: [error('Out of stock')], ephemeral: true });

      const already = db.prepare('SELECT 1 FROM shop_inventory WHERE user_id=? AND guild_id=? AND item_id=?').get(ix.user.id, guildId, itemId);
      if (already) return ix.reply({ embeds: [error('Already owned')], ephemeral: true });

      const eco = getEconomyUser(ix.user.id, guildId);
      if (eco.points < item.price) return ix.reply({ embeds: [error('Insufficient funds', `You need ${item.price.toLocaleString()} coins but have ${eco.points.toLocaleString()}`)], ephemeral: true });

      addPoints(ix.user.id, guildId, -item.price);
      db.prepare('INSERT INTO shop_inventory (user_id, guild_id, item_id) VALUES (?,?,?)').run(ix.user.id, guildId, itemId);
      if (item.stock !== -1) db.prepare('UPDATE shop_items SET stock=stock-1 WHERE id=?').run(itemId);

      // Grant role if applicable
      if (item.role_id) {
        const member = await ix.guild?.members.fetch(ix.user.id).catch(() => null);
        await member?.roles.add(item.role_id).catch(() => {});
      }

      return ix.reply({ embeds: [success('Purchase successful!', `You bought **${item.name}** for ${item.price.toLocaleString()} coins!${item.role_id ? `\n<@&${item.role_id}> has been granted.` : ''}`)] });
    }

    if (sub === 'inventory') {
      const rows = db.prepare(`
        SELECT si.*, s.name, s.description FROM shop_inventory si
        JOIN shop_items s ON s.id = si.item_id
        WHERE si.user_id=? AND si.guild_id=?`).all(ix.user.id, guildId) as any[];
      if (!rows.length) return ix.reply({ embeds: [new EmbedBuilder().setTitle('🎒 Inventory').setColor('#5865f2').setDescription('No items owned.')], ephemeral: true });
      return ix.reply({
        embeds: [new EmbedBuilder().setTitle('🎒 Your Inventory').setColor('#5865f2')
          .setDescription(rows.map(r => `• **${r.name}** — *${r.description || 'No description'}*`).join('\n'))],
        ephemeral: true,
      });
    }

    if (sub === 'add') {
      if (!await requireAdmin(ix)) return;
      const name = ix.options.getString('name', true);
      const price = ix.options.getInteger('price', true);
      const desc = ix.options.getString('description') ?? '';
      const role = ix.options.getRole('role');
      const stock = ix.options.getInteger('stock') ?? -1;
      db.prepare('INSERT INTO shop_items (guild_id, name, description, price, role_id, stock) VALUES (?,?,?,?,?,?)')
        .run(guildId, name, desc, price, role?.id ?? null, stock);
      return ix.reply({ embeds: [success('Item added', `**${name}** — ${price.toLocaleString()} coins`)] });
    }

    if (sub === 'remove') {
      if (!await requireAdmin(ix)) return;
      const itemId = ix.options.getInteger('item_id', true);
      const item = db.prepare('SELECT * FROM shop_items WHERE id=? AND guild_id=?').get(itemId, guildId) as any;
      if (!item) return ix.reply({ embeds: [error('Item not found')], ephemeral: true });
      db.prepare('DELETE FROM shop_items WHERE id=?').run(itemId);
      return ix.reply({ embeds: [success('Item removed', `**${item.name}** has been removed.`)] });
    }
  },
};
