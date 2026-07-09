import { Message, TextChannel, ChannelType } from 'discord.js';
import { BotClient } from '../utils/types';
import db, { getGuild, getUser } from '../database/db';
import { xpForLevel, levelFromXp } from '../utils/helpers';
import { handleApplicationDM } from '../commands/application/applyHandler';
import { getLocalized, Language } from '../utils/localization';
import { recordActivity } from '../merged/impl/inactivitykick';
import { touchTicketActivity } from '../modules/tickets/repository';
import { handleAutomod3 } from '../modules/moderation/automod3Handler';
import { handleSecurityMessage } from '../modules/security/securityEngine';
import { onChannelMessage as onStickyChannelMessage } from '../modules/stickyMessage/service';

const SPAM_MAP = new Map<string, number[]>();

setInterval(() => {
  const cutoff = Date.now() - 5_000;
  for (const [key, times] of SPAM_MAP) {
    if (times.every(t => t < cutoff)) SPAM_MAP.delete(key);
  }
}, 60_000);

export default {
  async execute(message: Message, client: BotClient) {
    if (message.author.bot) return;

    if (message.channel.type === ChannelType.DM) {
      await handleApplicationDM(message);
      return;
    }

    if (!message.guild) return;

    try { touchTicketActivity(message.channelId); } catch (_) {}
    try { recordActivity(message.guild.id, message.author.id); } catch (_) {}

    // ── Sticky Messages — re-post the pinned-style sticky at the bottom of
    //    the channel, if this channel has one configured. Fire-and-forget so
    //    a slow repost never delays the rest of message handling.
    onStickyChannelMessage(message).catch(() => {});

    // ── Per-user slowmode check ───────────────────────────────────────────────
    try {
      const slowRow = db.prepare('SELECT * FROM user_slowmode WHERE guild_id=? AND user_id=? AND channel_id=?')
        .get(message.guild.id, message.author.id, message.channelId) as any;
      if (slowRow) {
        const now = Math.floor(Date.now() / 1000);
        if (now - slowRow.last_message < slowRow.cooldown_seconds) {
          await message.delete().catch(() => {});
          const warn = await (message.channel as TextChannel).send(`<@${message.author.id}> You're in slowmode (${slowRow.cooldown_seconds}s).`);
          setTimeout(() => warn.delete().catch(() => {}), 4000);
          return;
        }
        db.prepare('UPDATE user_slowmode SET last_message=? WHERE guild_id=? AND user_id=? AND channel_id=?')
          .run(now, message.guild.id, message.author.id, message.channelId);
      }
    } catch (_) {}

    // ── Security Engine — highest priority, fire-and-forget for latency ───────
    // Returns true if message was handled (deleted/action taken) → skip further processing
    const handled = await handleSecurityMessage(message).catch(() => false);
    if (handled) return;

    const guild = getGuild(message.guild.id);
    const lang  = (guild.language || 'en') as Language;

    // ── AutoMod3 (Regex/Spam/MassPing/Phishing — higher-priority) ────────────
    await handleAutomod3(message);
    if (!message.deletable && !message.channel) return; // message was deleted by automod3

    // ── AutoMod (existing) ────────────────────────────────────────────────────
    if (guild.automod_enabled) {
      const lowerContent = message.content.toLowerCase();

      if (guild.automod_badwords) {
        const words: string[] = JSON.parse(guild.automod_badwords);
        if (words.some(w => lowerContent.includes(w))) {
          await message.delete().catch(() => {});
          await (message.channel as TextChannel)
            .send(`<@${message.author.id}> ${getLocalized('automod.watch_language', lang)}`)
            .then((m: Message) => setTimeout(() => m.delete().catch(() => {}), 5000));
          return;
        }
      }

      if (guild.automod_antilink) {
        const linkRegex = /(https?:\/\/|www\.)\S+/i;
        if (linkRegex.test(message.content) && !message.member?.permissions.has('ManageMessages')) {
          await message.delete().catch(() => {});
          await (message.channel as TextChannel)
            .send(`<@${message.author.id}> Externe Links sind nicht erlaubt.`)
            .then((m: Message) => setTimeout(() => m.delete().catch(() => {}), 5000));
          return;
        }
      }

      if (guild.automod_antiinvite) {
        const inviteRegex = /discord\.gg\/\S+|discord\.com\/invite\/\S+/i;
        if (inviteRegex.test(message.content) && !message.member?.permissions.has('ManageMessages')) {
          await message.delete().catch(() => {});
          await (message.channel as TextChannel)
            .send(`<@${message.author.id}> Discord-Einladungen sind nicht erlaubt.`)
            .then((m: Message) => setTimeout(() => m.delete().catch(() => {}), 5000));
          return;
        }
      }

      if (guild.automod_anticaps) {
        const text = message.content;
        if (text.length > 10) {
          const upper = text.replace(/[^a-zA-Z]/g, '');
          const capsRatio = upper.length > 0 ? (text.replace(/[^A-Z]/g, '').length / upper.length) : 0;
          if (capsRatio > 0.7) {
            await message.delete().catch(() => {});
            await (message.channel as TextChannel)
              .send(`<@${message.author.id}> Please avoid excessive CAPS LOCK.`)
              .then((m: Message) => setTimeout(() => m.delete().catch(() => {}), 5000));
            return;
          }
        }
      }

      if (guild.automod_antispam) {
        const key    = `${message.guild.id}-${message.author.id}`;
        const now    = Date.now();
        const times  = SPAM_MAP.get(key) ?? [];
        times.push(now);
        const recent = times.filter(t => now - t < 5000);
        SPAM_MAP.set(key, recent);
        if (recent.length >= 5) {
          await message.delete().catch(() => {});
          await message.member?.timeout(30000, 'Spam detected').catch(() => {});
          return;
        }
      }
    }

    // ── XP & Level System ─────────────────────────────────────────────────────
    if (!guild.level_enabled) return;

    const user = getUser(message.author.id, message.guild.id);
    const now  = Math.floor(Date.now() / 1000);

    if (now - user.last_xp < 30) return;

    const xpGain   = Math.floor(Math.random() * 11) + 15;
    const newXp    = user.xp + xpGain;
    const oldLevel = user.level;
    const newLevel = levelFromXp(newXp);

    db.prepare(
      'UPDATE users SET xp = ?, level = ?, messages = messages + 1, last_xp = ? WHERE id = ? AND guild_id = ?'
    ).run(newXp, newLevel, now, message.author.id, message.guild.id);

    if (newLevel > oldLevel) {
      const levelRoles: Record<string, string> = JSON.parse(guild.level_roles || '{}');
      if (levelRoles[String(newLevel)] && message.member) {
        message.member.roles.add(levelRoles[String(newLevel)]).catch(() => {});
      }

      const levelChannel = guild.level_channel
        ? message.guild.channels.cache.get(guild.level_channel)
        : null;
      const target = levelChannel?.isTextBased() ? levelChannel : message.channel;

      if (target && 'send' in target) {
        const xpNeeded = xpForLevel(newLevel + 1);
        const lvlUpMsg = getLocalized('level.levelup', lang, {
          user:    message.author.toString(),
          level:   String(newLevel),
          xp:      String(newXp),
          needed:  String(xpNeeded),
        });
        await (target as TextChannel).send({ content: lvlUpMsg }).catch(() => {});
      }
    }
  },
};
