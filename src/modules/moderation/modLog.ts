/**
 * MOD LOG — Protokolliert Server-Ereignisse in einen Admin-Channel.
 *
 * Geloggte Events:
 *   messageDelete        – Gelöschte Nachrichten
 *   messageUpdate        – Bearbeitete Nachrichten
 *   messageReactionAdd    – Hinzugefügte Reaktionen
 *   messageReactionRemove – Entfernte Reaktionen
 *   guildMemberAdd        – Beitritte
 *   guildMemberRemove     – Abgänge (mit Reason wenn kick/ban)
 *
 * Channel setup: /automod logchannel channel:#your-channel viewer_role:@HighStaff
 * (the viewer_role option automatically locks the channel down — see
 * merged/impl/automod2.ts — so only that role + the bot can view it).
 *
 * Partials: message/reaction objects can arrive "partial" (uncached, e.g.
 * after a restart or for old messages) — see events/messageReactionAdd.ts
 * and events/messageReactionRemove.ts, which call `.fetch()` on partials
 * before handing off to the functions below. A deleted message that was
 * NEVER cached can't be recovered (Discord doesn't send its content), so
 * logMessageDelete() falls back to a clear "uncached message" placeholder
 * instead of silently showing nothing.
 */

import {
  Guild, Message, PartialMessage, GuildMember, PartialGuildMember,
  TextChannel, EmbedBuilder, AuditLogEvent, MessageReaction, PartialMessageReaction,
  User, PartialUser,
} from 'discord.js';
import db from '../../database/db';

// Distinct color per event type, per the logging spec.
const COLORS = {
  delete:         '#ed4245', // red
  edit:           '#e67e22', // orange
  reactionAdd:    '#57f287', // green
  reactionRemove: '#3498db', // blue
} as const;

// ── Config helpers ─────────────────────────────────────────────────────────────

export function getLogChannel(guildId: string): string | null {
  const row = db.prepare('SELECT mod_log_channel FROM guilds WHERE id = ?').get(guildId) as { mod_log_channel: string | null } | undefined;
  return row?.mod_log_channel ?? null;
}

async function sendLog(guild: Guild, embed: EmbedBuilder): Promise<void> {
  const channelId = getLogChannel(guild.id);
  if (!channelId) return;
  const ch = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!ch) return;
  await ch.send({ embeds: [embed] }).catch(() => {});
}

// ── Event handlers ─────────────────────────────────────────────────────────────

export async function logMessageDelete(message: Message | PartialMessage): Promise<void> {
  if (!message.guild || message.author?.bot) return;

  // A message that was never cached before deletion has no recoverable content —
  // Discord's gateway only sends the ID in that case. Say so clearly instead of
  // showing a blank/misleading field.
  const wasCached = !message.partial;
  const contentValue = wasCached
    ? ((message.content?.slice(0, 1024)) || '*No text (attachment-only, embed, or empty)*')
    : '*Unknown — this message was not cached before it was deleted (e.g. sent before the bot last restarted).*';

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message Deleted')
    .setColor(COLORS.delete)
    .addFields(
      { name: 'Kanal',    value: `<#${message.channelId}>`,              inline: true },
      { name: 'Autor',    value: message.author ? `<@${message.author.id}> (${message.author.tag})` : 'Unbekannt', inline: true },
      { name: 'Inhalt',   value: contentValue },
    )
    .setFooter({ text: `User-ID: ${message.author?.id ?? '?'}` })
    .setTimestamp();

  if (wasCached && message.attachments.size > 0) {
    embed.addFields({ name: 'Attachments', value: message.attachments.map(a => a.url).join('\n').slice(0, 1024) });
  }

  await sendLog(message.guild, embed);
}

export async function logMessageEdit(oldMsg: Message | PartialMessage, newMsg: Message | PartialMessage): Promise<void> {
  if (!newMsg.guild || newMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return; // Embed-Updates ignorieren

  const beforeValue = oldMsg.partial
    ? '*Unknown — original content wasn\'t cached (e.g. sent before the last restart).*'
    : ((oldMsg.content?.slice(0, 512)) || '*Unbekannt*');
  const afterValue = (newMsg.content?.slice(0, 512)) || '*Leer*';

  const embed = new EmbedBuilder()
    .setTitle('✏️ Nachricht bearbeitet')
    .setColor(COLORS.edit)
    .addFields(
      { name: 'Kanal',   value: `<#${newMsg.channelId}>`, inline: true },
      { name: 'Autor',   value: `<@${newMsg.author?.id}>`, inline: true },
      { name: 'Vorher',  value: beforeValue },
      { name: 'Nachher', value: afterValue },
    )
    .setFooter({ text: `User-ID: ${newMsg.author?.id ?? '?'}` })
    .setTimestamp();

  // .url is always constructible from guild/channel/message IDs, even for a
  // partial message — no fetch needed for the link itself.
  if (newMsg.url) embed.setURL(newMsg.url);

  await sendLog(newMsg.guild, embed);
}

export async function logReactionAdd(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
  const message = reaction.message;
  if (!message.guild || user.bot) return;

  const emojiDisplay = reaction.emoji.id
    ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
    : (reaction.emoji.name ?? '❓');

  const embed = new EmbedBuilder()
    .setTitle('👍 Reaction Added')
    .setColor(COLORS.reactionAdd)
    .addFields(
      { name: 'User',    value: `<@${user.id}> (${user.id})`, inline: true },
      { name: 'Emoji',   value: emojiDisplay,                  inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`,     inline: true },
      { name: 'Message', value: message.url ? `[Jump to message](${message.url})` : '*Link unavailable*' },
    )
    .setTimestamp();

  await sendLog(message.guild, embed);
}

export async function logReactionRemove(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
  const message = reaction.message;
  if (!message.guild || user.bot) return;

  const emojiDisplay = reaction.emoji.id
    ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
    : (reaction.emoji.name ?? '❓');

  const embed = new EmbedBuilder()
    .setTitle('👎 Reaction Removed')
    .setColor(COLORS.reactionRemove)
    .addFields(
      { name: 'User',    value: `<@${user.id}> (${user.id})`, inline: true },
      { name: 'Emoji',   value: emojiDisplay,                  inline: true },
      { name: 'Channel', value: `<#${message.channelId}>`,     inline: true },
      { name: 'Message', value: message.url ? `[Jump to message](${message.url})` : '*Link unavailable*' },
    )
    .setTimestamp();

  await sendLog(message.guild, embed);
}

export async function logMemberJoin(member: GuildMember): Promise<void> {
  const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);

  const embed = new EmbedBuilder()
    .setTitle('📥 Mitglied beigetreten')
    .setColor('#57f287')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Nutzer',       value: `<@${member.id}> (${member.user.tag})`, inline: true },
      { name: 'Account-Alter', value: `${accountAge} Tage`,                  inline: true },
      { name: 'Erstellt',     value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `ID: ${member.id} • Mitglieder: ${member.guild.memberCount}` })
    .setTimestamp();

  await sendLog(member.guild, embed);
}

export async function logMemberLeave(member: GuildMember | PartialGuildMember): Promise<void> {
  // Check audit log to detect kick/ban
  let leaveReason = 'Freiwillig verlassen';
  let color: `#${string}` = '#99aab5';

  try {
    const auditLogs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
    const kickEntry = auditLogs?.entries.first();
    if (kickEntry && kickEntry.target?.id === member.id && Date.now() - kickEntry.createdTimestamp < 5000) {
      leaveReason = `Gekickt von <@${kickEntry.executor?.id}>${kickEntry.reason ? ` — ${kickEntry.reason}` : ''}`;
      color = '#ed4245';
    }
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle('📤 Mitglied verlassen')
    .setColor(color)
    .setThumbnail(member.user?.displayAvatarURL() ?? null)
    .addFields(
      { name: 'Nutzer',  value: `<@${member.id}> (${member.user?.tag ?? '?'})`, inline: true },
      { name: 'Grund',   value: leaveReason,                                     inline: true },
    )
    .setFooter({ text: `ID: ${member.id} • Mitglieder: ${member.guild.memberCount}` })
    .setTimestamp();

  await sendLog(member.guild, embed);
}
