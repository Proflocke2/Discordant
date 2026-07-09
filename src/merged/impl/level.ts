/**
 * /level — Level-System mit Canvas-Rank-Karten.
 *
 * rank        → Rank-Karte als Bild (Avatar-Farbe als Akzent)
 * leaderboard → Leaderboard als Bild (Top-10 mit Mini-Avataren)
 * set         → XP setzen (Admin)
 * reset       → XP zurücksetzen (Admin)
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import db, { getUser, getGuild } from '../../database/db';
import { error } from '../../utils/embeds';
import { xpForLevel, levelFromXp } from '../../utils/helpers';
import { UserRow } from '../../utils/types';
import { createRankCard } from '../../modules/canvas/rankCard';
import { createLeaderboardCard, LeaderboardEntry } from '../../modules/canvas/leaderboardCard';

export default {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Level system')

    .addSubcommand(s =>
      s.setName('rank').setDescription('Show your rank card')
        .addUserOption(o => o.setName('user').setDescription('User (default: you)')),
    )

    .addSubcommand(s =>
      s.setName('leaderboard').setDescription('Show the top-10 leaderboard as an image'),
    )

    .addSubcommand(s =>
      s.setName('set').setDescription('[Admin] Set a user\'s XP')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addIntegerOption(o => o.setName('xp').setDescription('XP amount').setRequired(true).setMinValue(0)),
    )

    .addSubcommand(s =>
      s.setName('reset').setDescription('[Admin] Reset a user\'s XP')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── RANK CARD ────────────────────────────────────────────────────────────
    if (sub === 'rank') {
      await ix.deferReply();

      const target = ix.options.getUser('user') ?? ix.user;
      const u      = getUser(target.id, gid);

      // Sync level from XP
      const correctLevel = levelFromXp(u.xp);
      if (correctLevel !== u.level) {
        db.prepare('UPDATE users SET level = ? WHERE id = ? AND guild_id = ?').run(correctLevel, u.id, u.guild_id);
        u.level = correctLevel;
      }

      // XP within current level
      let spent = 0;
      for (let i = 1; i <= u.level; i++) spent += xpForLevel(i);
      const currentXp = u.xp - spent;
      const neededXp  = xpForLevel(u.level + 1);

      // Rank (position in guild leaderboard)
      const rankRow = db.prepare(
        'SELECT COUNT(*) + 1 as rank FROM users WHERE guild_id = ? AND xp > ?',
      ).get(gid, u.xp) as { rank: number };

      try {
        const buf = await createRankCard({
          avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
          username:  target.username,
          level:     u.level,
          rank:      rankRow.rank,
          currentXp,
          neededXp,
          totalXp:   u.xp,
          messages:  u.messages,
        });

        const att = new AttachmentBuilder(buf, { name: 'rank.png' });
        await ix.editReply({ files: [att] });
      } catch (err) {
        console.error('[RankCard] failed:', err);
        // Fallback to embed
        await ix.editReply({
          embeds: [new EmbedBuilder()
            .setTitle(`⭐ ${target.username}`)
            .setColor('#5865f2')
            .setThumbnail(target.displayAvatarURL())
            .addFields(
              { name: 'Level',    value: `**${u.level}**`,       inline: true },
              { name: 'Rank',     value: `**#${rankRow.rank}**`,  inline: true },
              { name: 'Total XP', value: `${u.xp}`,              inline: true },
              { name: 'Progress', value: `${currentXp} / ${neededXp} XP` },
            )],
        });
      }
    }

    // ── LEADERBOARD CARD ─────────────────────────────────────────────────────
    if (sub === 'leaderboard') {
      await ix.deferReply();

      const top = db
        .prepare('SELECT * FROM users WHERE guild_id = ? ORDER BY xp DESC LIMIT 10')
        .all(gid) as UserRow[];

      if (top.length === 0) {
        return ix.editReply({ embeds: [new EmbedBuilder().setDescription('No data yet.')] });
      }

      const entries: LeaderboardEntry[] = top.map((u, i) => {
        const member = ix.guild?.members.cache.get(u.id);
        return {
          rank:      i + 1,
          userId:    u.id,
          username:  member?.user.username ?? `User ${u.id.slice(-4)}`,
          avatarUrl: member?.user.displayAvatarURL({ extension: 'png', size: 64 }) ?? '',
          level:     u.level,
          totalXp:   u.xp,
          messages:  u.messages,
        };
      });

      try {
        const buf = await createLeaderboardCard(entries, ix.guild?.name ?? 'Server');
        const att = new AttachmentBuilder(buf, { name: 'leaderboard.png' });
        await ix.editReply({ files: [att] });
      } catch (err) {
        console.error('[LeaderboardCard] failed:', err);
        // Fallback to embed
        await ix.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('🏆 Leaderboard')
            .setColor('#5865f2')
            .setDescription(top.map((u, i) => `**${i+1}.** <@${u.id}> — Level ${u.level} (${u.xp} XP)`).join('\n'))],
        });
      }
    }

    // ── SET XP ───────────────────────────────────────────────────────────────
    if (sub === 'set') {
      if (!ix.memberPermissions?.has('ManageGuild')) {
        return ix.reply({ embeds: [error('Keine Berechtigung.')], flags: MessageFlags.Ephemeral });
      }

      const target   = ix.options.getUser('user', true);
      const xp       = ix.options.getInteger('xp', true);
      const newLevel = levelFromXp(xp);

      db.prepare('UPDATE users SET xp = ?, level = ? WHERE id = ? AND guild_id = ?')
        .run(xp, newLevel, target.id, gid);

      return ix.reply({
        embeds: [new EmbedBuilder()
          .setColor('#57f287')
          .setTitle('✅ XP gesetzt')
          .setDescription(`${target} → **${xp.toLocaleString()} XP** (Level **${newLevel}**)`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── RESET XP ─────────────────────────────────────────────────────────────
    if (sub === 'reset') {
      if (!ix.memberPermissions?.has('ManageGuild')) {
        return ix.reply({ embeds: [error('Keine Berechtigung.')], flags: MessageFlags.Ephemeral });
      }

      const target = ix.options.getUser('user', true);
      db.prepare('UPDATE users SET xp = 0, level = 0, messages = 0 WHERE id = ? AND guild_id = ?')
        .run(target.id, gid);

      return ix.reply({
        embeds: [new EmbedBuilder()
          .setColor('#ed4245')
          .setTitle('🗑️ XP Reset')
          .setDescription(`${target}'s XP has been reset to 0.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
