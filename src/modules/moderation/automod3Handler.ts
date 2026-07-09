/**
 * AutoMod3 Handler — verarbeitet eingehende Nachrichten.
 *
 * Prüft:
 *   1. Regex-Filter
 *   2. Spam-Threshold (Sliding Window)
 *   3. Anti-Mass-Ping
 *   4. Phishing-Link-Filter
 */

import { Message, GuildMember, PermissionFlagsBits, TextChannel, EmbedBuilder } from 'discord.js';
import { getAutomod3Config } from '../../merged/impl/automod3';
import db from '../../database/db';

// ── Known phishing domains (subset — extend as needed) ──────────────────────
const PHISHING_PATTERNS = [
  /discord[_\-.]?gift[s]?\.[a-z]{2,}/i,
  /free[_\-.]?nitro\.[a-z]{2,}/i,
  /steamcommunity\.[a-z]{3,}/i,  // fake steam
  /dlscord\.[a-z]{2,}/i,
  /discordapp\.com\.[\w.]+/i,
  /nitro-gift\.[a-z]{2,}/i,
];

// ── Violation counter (in-memory, resets on bot restart) ─────────────────────
const violationCount = new Map<string, { count: number; resetAt: number }>();

function getViolations(userId: string, guildId: string): number {
  const key = `${guildId}:${userId}`;
  const entry = violationCount.get(key);
  if (!entry || Date.now() > entry.resetAt) return 0;
  return entry.count;
}

function incrementViolation(userId: string, guildId: string): number {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const entry = violationCount.get(key);
  if (!entry || now > entry.resetAt) {
    violationCount.set(key, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
    return 1;
  }
  entry.count++;
  return entry.count;
}

// ── Spam tracking (sliding window) ──────────────────────────────────────────
const spamLog = new Map<string, number[]>();

function isSpamming(userId: string, guildId: string, threshold: number, windowSeconds: number): boolean {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const times = (spamLog.get(key) ?? []).filter(t => now - t < windowMs);
  times.push(now);
  spamLog.set(key, times);
  return times.length > threshold;
}

// Cleanup spam log every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of spamLog.entries()) {
    const fresh = times.filter(t => now - t < 60_000);
    if (fresh.length === 0) spamLog.delete(key); else spamLog.set(key, fresh);
  }
}, 60_000);

// ── Apply punishment ─────────────────────────────────────────────────────────
async function applyPunishment(
  member: GuildMember,
  punishment: string,
  reason: string,
  logChannelId: string | null,
): Promise<void> {
  switch (punishment) {
    case 'delete': break; // message already deleted
    case 'warn':
      db.prepare('INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)')
        .run(member.guild.id, member.id, member.client.user!.id, reason);
      await member.send(`⚠️ Du wurdest auf **${member.guild.name}** verwarnt: ${reason}`).catch(() => {});
      break;
    case 'timeout_10m':
      await member.timeout(10 * 60 * 1000, reason).catch(() => {});
      break;
    case 'timeout_1h':
      await member.timeout(60 * 60 * 1000, reason).catch(() => {});
      break;
    case 'timeout_24h':
      await member.timeout(24 * 60 * 60 * 1000, reason).catch(() => {});
      break;
    case 'kick':
      await member.kick(reason).catch(() => {});
      break;
    case 'ban':
      await member.ban({ reason }).catch(() => {});
      break;
  }

  if (logChannelId) {
    const ch = member.guild.channels.cache.get(logChannelId) as TextChannel | undefined;
    if (ch) {
      await ch.send({
        embeds: [new EmbedBuilder()
          .setColor('#fee75c')
          .setTitle('🤖 AutoMod3 Eingriff')
          .addFields(
            { name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: true },
            { name: 'Strafe', value: punishment, inline: true },
            { name: 'Grund', value: reason },
          )
          .setTimestamp()],
      }).catch(() => {});
    }
  }
}

// ── Main message handler ─────────────────────────────────────────────────────
export async function handleAutomod3(message: Message): Promise<void> {
  if (!message.guild || message.author.bot) return;
  if (!(message.member instanceof GuildMember)) return;
  // Skip mods
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const gid = message.guild.id;
  const config = getAutomod3Config(gid);
  const logChannelId = (db.prepare('SELECT mod_log_channel FROM guilds WHERE id = ?').get(gid) as { mod_log_channel: string | null } | undefined)?.mod_log_channel ?? null;

  const content = message.content ?? '';
  let triggered = false;
  let triggerReason = '';

  // 1. Regex filters
  const filters = JSON.parse(config.regex_filters) as { pattern: string; name: string }[];
  for (const f of filters) {
    try {
      if (new RegExp(f.pattern, 'i').test(content)) {
        triggered = true;
        triggerReason = `Regex-Filter: ${f.name}`;
        break;
      }
    } catch { /* invalid regex — skip */ }
  }

  // 2. Anti-Mass-Ping
  if (!triggered && config.anti_mass_ping) {
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    if (mentions > config.mass_ping_limit) {
      triggered = true;
      triggerReason = `Mass-Ping (${mentions} Mentions)`;
    }
  }

  // 3. Phishing filter
  if (!triggered && config.phishing_filter) {
    if (PHISHING_PATTERNS.some(p => p.test(content))) {
      triggered = true;
      triggerReason = 'Phishing-Link erkannt';
    }
  }

  // 4. Spam threshold
  if (!triggered) {
    if (isSpamming(message.author.id, gid, config.spam_threshold, config.spam_window_seconds)) {
      triggered = true;
      triggerReason = `Spam (>${config.spam_threshold} Nachrichten in ${config.spam_window_seconds}s)`;
    }
  }

  if (!triggered) return;

  // Delete the message
  await message.delete().catch(() => {});

  // Determine punishment from profile
  const violations = incrementViolation(message.author.id, gid);
  const profile = JSON.parse(config.punishment_profile) as Record<string, string>;
  const punishment = profile[Math.min(violations, 3).toString()] ?? 'warn';

  await applyPunishment(message.member, punishment, triggerReason, logChannelId);
}
