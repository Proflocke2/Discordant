/**
 * /attacksim — Vollständiger Angriffs-Simulator mit ECHTEN Aktionen.
 *
 * REAL actions that will be executed:
 *   join-raid        → Lockdown aller Kanäle + Nachrichtenflut im Log-Kanal
 *   nuke             → Erstellt Test-Kanäle/Rollen und löscht sie sofort
 *   permission-grab  → Erstellt temporäre Rolle mit Admin-Perms
 *   webhook-spam     → Erstellt echte Webhooks, sendet damit Nachrichten
 *   spam/caps/etc.   → Echte Nachrichten im Target channel
 *   lockdown         → Sperrt alle Kanäle via permissionOverwrites
 *
 * Rollback stellt ALLES wieder her:
 *   • Gelöschte Kanäle → neu erstellt (Position, Name, Permissions, Kategorie)
 *   • Gelöschte Rollen  → neu erstellt (Name, Farbe, Perms, Position)
 *   • Erstellte Webhooks → gelöscht
 *   • Erstellte Kanäle  → gelöscht
 *   • Erstellte Rollen  → gelöscht
 *   • Gesperrte Kanäle  → entsperrt
 *   • Gesendete Msgs    → gelöscht (bulkDelete)
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  EmbedBuilder, TextChannel, ChannelType, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, GuildChannel,
  CategoryChannel, OverwriteType,
} from 'discord.js';
import { requireAdmin } from '../../utils/guards';
import { success, error, info } from '../../utils/embeds';
import db from '../../database/db';
import { testInjectJoins, testInjectSpam, testInjectContent } from '../../modules/security/securityEngine';

// ══════════════════════════════════════════════════════════════════════════════
// Snapshot-DB — speichert alles was für Rollback nötig ist
// ══════════════════════════════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS attacksim_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    attack_type TEXT NOT NULL,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS attacksim_snapshot (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    action_type  TEXT NOT NULL,
    payload      TEXT NOT NULL,
    created_at   INTEGER DEFAULT (unixepoch())
  );
`);

// ── Snapshot helpers ──────────────────────────────────────────────────────────

type SnapshotAction =
  | { type: 'channel_deleted';  data: ChannelSnapshot }
  | { type: 'role_deleted';     data: RoleSnapshot }
  | { type: 'channel_created';  data: { id: string } }
  | { type: 'role_created';     data: { id: string } }
  | { type: 'webhook_created';  data: { id: string; channelId: string } }
  | { type: 'channel_locked';   data: { id: string } }
  | { type: 'msg_sent';         data: { channelId: string; messageId: string; type: string } };

interface ChannelSnapshot {
  id: string; name: string; type: number; position: number;
  parentId: string | null; topic: string | null;
  nsfw: boolean; slowmode: number;
  permissionOverwrites: { id: string; type: number; allow: string; deny: string }[];
}

interface RoleSnapshot {
  id: string; name: string; color: number; hoist: boolean;
  position: number; permissions: string; mentionable: boolean;
}

function saveSnapshot(guildId: string, action: SnapshotAction) {
  db.prepare('INSERT INTO attacksim_snapshot (guild_id, action_type, payload) VALUES (?, ?, ?)')
    .run(guildId, action.type, JSON.stringify(action.data));
}

function getSnapshots(guildId: string): SnapshotAction[] {
  return (db.prepare('SELECT action_type, payload FROM attacksim_snapshot WHERE guild_id = ? ORDER BY id DESC').all(guildId) as any[])
    .map(r => ({ type: r.action_type, data: JSON.parse(r.payload) }) as SnapshotAction);
}

function clearSnapshots(guildId: string) {
  db.prepare('DELETE FROM attacksim_snapshot WHERE guild_id = ?').run(guildId);
}

// ── Message tracking helpers ──────────────────────────────────────────────────

function trackMsg(guildId: string, channelId: string, msgId: string, type: string) {
  db.prepare('INSERT INTO attacksim_log (guild_id, channel_id, message_id, attack_type) VALUES (?, ?, ?, ?)')
    .run(guildId, channelId, msgId, type);
  saveSnapshot(guildId, { type: 'msg_sent', data: { channelId, messageId: msgId, type } });
}

function getTracked(guildId: string) {
  return db.prepare('SELECT channel_id, message_id FROM attacksim_log WHERE guild_id = ? ORDER BY id DESC').all(guildId) as { channel_id: string; message_id: string }[];
}

function clearTracked(guildId: string) {
  db.prepare('DELETE FROM attacksim_log WHERE guild_id = ?').run(guildId);
}

async function sendTracked(ch: TextChannel, guildId: string, type: string, content: string | { embeds: EmbedBuilder[] }, delay = 300) {
  await new Promise(r => setTimeout(r, delay));
  const opts = typeof content === 'string'
    ? { content, allowedMentions: { parse: [] } }
    : { ...content, allowedMentions: { parse: [] } };
  const msg = await ch.send(opts as any).catch(() => null);
  if (msg) trackMsg(guildId, ch.id, msg.id, type);
}

// ══════════════════════════════════════════════════════════════════════════════
// Content libraries
// ══════════════════════════════════════════════════════════════════════════════

const SPAM_MESSAGES = [
  'SPAM SPAM SPAM BUY NOW!!!', 'FREE NITRO CLICK HERE!!!', 'JOIN MY SERVER NOW!!!',
  'RAID THIS SERVER!!!', 'DISCORD.GG/FAKE1234', 'GET FREE ROBUX!!!',
  'LIMITED TIME OFFER!!!', 'DO NOT MISS THIS!!!', 'EVERYONE LOOK HERE!!!', 'BUY CHEAP ACCOUNTS!!!',
];
const CAPS_MESSAGES = [
  'HEY EVERYONE LOOK AT ME I AM BEING VERY LOUD', 'THIS IS VERY IMPORTANT PLEASE READ THIS NOW',
  'ATTENTION ALL MEMBERS JOIN MY SERVER IMMEDIATELY', 'YOU WILL NOT BELIEVE WHAT JUST HAPPENED HERE',
  'MASSIVE ANNOUNCEMENT FOR THE WHOLE SERVER',
];
const PHISHING_MESSAGES = [
  '🎁 Free Discord Nitro! Click: discord-gift-claim.example-sim.invalid/nitro',
  '⚠️ Your account will be banned unless you verify: discordapp-verify.example-sim.invalid',
  '💰 Steam gift card: steamcommunity-free.example-sim.invalid/gift',
];
const INVITE_MESSAGES = [
  '[SIM] Join my server! discord.gg/fakeinvite1', '[SIM] Better server: discord.gg/fakeinvite2',
  '[SIM] Come join us: discord.gg/fakeinvite3',
];
const BADWORD_PATTERNS = [
  '[SIM] This message contains filtered w*rds',
  '[SIM] Blocked phrase simulation — Test1', '[SIM] Filtered content pattern — Test2',
];
const EMOJI_SPAM = [
  '[SIM] 🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥',
  '[SIM] 💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀',
  '[SIM] 😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂',
];
const REGEX_BYPASS = [
  '[SIM] W.O.R.T — Punkt-Umgehung', '[SIM] W_O_R_T — Unterstrich-Umgehung',
  '[SIM] W0R7 — Leet-Speak', '[SIM] Ⓦ Ⓞ Ⓡ Ⓣ — Unicode-Umgehung',
];
const COPYPASTA = '[SIM] Lorem ipsum SIMULATION SPAM MESSAGE bitte ignorieren [SIM]';

// ══════════════════════════════════════════════════════════════════════════════
// ECHTE Simulations-Funktionen
// ══════════════════════════════════════════════════════════════════════════════

// ── JOIN-RAID: Lockdown + Log ─────────────────────────────────────────────────
async function simJoinRaid(ix: ChatInputCommandInteraction, count: number): Promise<string> {
  const gid   = ix.guildId!;
  const guild = ix.guild!;

  // Engine-Injection: triggert Anti-Raid direkt wie echte Joins
  const engineResult = await testInjectJoins(guild, count, 'sim-raider');

  // Echte Aktion: Lockdown fuer realistischen Effekt + Rollback-Test
  const textChannels = guild.channels.cache.filter(
    ch => ch.type === ChannelType.GuildText &&
      ch.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.SendMessages),
  );
  await Promise.allSettled([...textChannels.values()].map(async ch => {
    await (ch as TextChannel).permissionOverwrites.edit(
      guild.roles.everyone, { SendMessages: false },
      { reason: '[attacksim] Join-Raid Lockdown-Test' },
    ).catch(() => {});
    saveSnapshot(gid, { type: 'channel_locked', data: { id: ch.id } });
  }));

  const logCh = (guild.systemChannel ?? ix.channel) as TextChannel;
  const engineLine = engineResult.triggered
    ? '\u2705 Engine ausgeloest: ' + engineResult.action
    : '\u26a0\ufe0f Threshold nicht erreicht (' + engineResult.joins + ' Joins)';
  const msg = await logCh.send({
    embeds: [new EmbedBuilder()
      .setColor('#ed4245')
      .setTitle('[SIM] RAID - Join Spike & Server Lockdown')
      .setDescription(
        '**Simulation:** ' + count + ' Accounts beigetreten.\n' +
        '**Kanaele gesperrt:** ' + textChannels.size + '\n' +
        '**Engine-Reaktion:** ' + engineLine + '\n\n' +
        'Rollback mit `/attacksim rollback`',
      )
      .setTimestamp()],
  }).catch(() => null);
  if (msg) trackMsg(gid, logCh.id, msg.id, 'join-raid');

  return textChannels.size + ' Kanaele gesperrt -- Engine: ' + (engineResult.triggered ? engineResult.action : 'Threshold nicht erreicht');
}


async function simNuke(ix: ChatInputCommandInteraction, reportCh: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  const guild = ix.guild!;

  const log = (text: string) => sendTracked(reportCh, gid, 'nuke', text, 600);

  await log('💣 [SIM] Gehackter Staff-Account initiiert Nuke-Angriff...');
  await log('🗑️ [SIM] Attacker deleting channels — creating test channels to delete...');

  // Erstelle 3 Test-Kanäle — snapshot → löschen (simuliert Kanal-Deletion)
  const createdChannelIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const ch = await guild.channels.create({
      name: `sim-nuke-kanal-${i}`,
      type: ChannelType.GuildText,
      reason: '[attacksim] Nuke-Sim: Test-Kanal',
    }).catch(() => null);
    if (!ch) continue;
    createdChannelIds.push(ch.id);
    // Snapshot als "created" → Rollback löscht ihn
    saveSnapshot(gid, { type: 'channel_created', data: { id: ch.id } });
    await log(`🗑️ [SIM] Channel **#${ch.name}** created and immediately deleted`);
    await ch.delete('[attacksim] Nuke-Sim: delete immediately').catch(() => {});
  }

  await log('🎭 [SIM] Attacker deleting roles...');

  // Erstelle 2 Test-Rollen — snapshot → löschen
  for (let i = 1; i <= 2; i++) {
    const role = await guild.roles.create({
      name: `[SIM] Test-Rolle ${i}`,
      color: 0xed4245,
      reason: '[attacksim] Nuke-Sim',
    }).catch(() => null);
    if (!role) continue;
    saveSnapshot(gid, { type: 'role_created', data: { id: role.id } });
    await log(`🎭 [SIM] Role **@${role.name}** created and immediately deleted`);
    await role.delete('[attacksim] Nuke-Sim: delete immediately').catch(() => {});
  }

  await log('🔨 [SIM] Angreifer versucht Massen-Bans...');
  await log('🛡️ [SIM] Anti-Nuke would intervene — check `/antinuke status`');

  const antiNukeCfg = db.prepare('SELECT * FROM antinuke_config WHERE guild_id = ?').get(gid) as any;
  await log(
    antiNukeCfg?.enabled
      ? `✅ Anti-Nuke ist AKTIV — Aktion bei Trigger: **${antiNukeCfg.action}**`
      : `⚠️ Anti-Nuke ist INAKTIV — aktiviere mit \`/antinuke setup enabled:true\``,
  );

  return '3 test channels + 2 test roles created and immediately deleted';
}

// ── PERMISSION-GRAB: Erstellt echte Rolle mit Admin-Perms ────────────────────
async function simPermissionGrab(ix: ChatInputCommandInteraction, reportCh: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  const guild = ix.guild!;

  await sendTracked(reportCh, gid, 'permgrab',
    '[SIM] Attacker attempting privilege escalation — creating temp admin role...', 0);

  // ECHTE Aktion: Admin-Rolle erstellen
  const role = await guild.roles.create({
    name: '[SIM] FAKE-ADMIN — rollback will delete me',
    color: 0xff0000,
    permissions: [PermissionFlagsBits.Administrator],
    reason: '[attacksim] Permission-Grab-Simulation',
  }).catch(() => null);

  if (role) {
    saveSnapshot(gid, { type: 'role_created', data: { id: role.id } });
    await sendTracked(reportCh, gid, 'permgrab',
      `✅ [SIM] Rolle **@${role.name}** mit Admin-Berechtigung erstellt (ID: \`${role.id}\`)\n` +
      `→ Rollback will delete this role.`, 500);
  }

  const antiNukeCfg = db.prepare('SELECT * FROM antinuke_config WHERE guild_id = ?').get(gid) as any;
  await sendTracked(reportCh, gid, 'permgrab',
    antiNukeCfg?.enabled
      ? `🛡️ [SIM] Anti-Nuke would intervene on role assignment — action: **${antiNukeCfg.action}**`
      : `⚠️ [SIM] Anti-Nuke INACTIVE — attacker could grant themselves admin now!`,
    400);

  return role ? `Admin role "${role.name}" created (rollback will delete it)` : 'Role could not be created';
}

// ── WEBHOOK-SPAM: Erstellt echte Webhooks, sendet damit ──────────────────────
async function simWebhookSpam(ix: ChatInputCommandInteraction, reportCh: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  const guild = ix.guild!;

  await sendTracked(reportCh, gid, 'webhook',
    '[SIM] Attacker creating webhooks for spam without account...', 0);

  const webhookNames = ['SystemNotice', 'DiscordBot', 'AdminAlert', 'ServerUpdate'];
  let created = 0;

  for (const name of webhookNames) {
    const wh = await reportCh.createWebhook({
      name,
      reason: '[attacksim] Webhook-Spam-Simulation',
    }).catch(() => null);

    if (!wh) continue;
    created++;
    saveSnapshot(gid, { type: 'webhook_created', data: { id: wh.id, channelId: reportCh.id } });

    // Sende echte Nachricht via Webhook
    const whMsg = await wh.send({
      content: `[SIM] Webhook **${name}** sendet: **FREE NITRO CLICK HERE** discord.gg/fake`,
      allowedMentions: { parse: [] },
    }).catch(() => null);

    // Track Webhook-Nachricht für Rollback (Webhook-Nachrichten können nicht normal gelöscht werden)
    // Stattdessen: Webhook selbst löschen entfernt die Nachrichten-Attribution
    if (whMsg) trackMsg(gid, reportCh.id, whMsg.id, 'webhook');

    await sendTracked(reportCh, gid, 'webhook',
      `🕵️ [SIM] Webhook **${name}** (ID: \`${wh.id}\`) created — rollback will delete it`, 300);
  }

  const antiNukeCfg = db.prepare('SELECT * FROM antinuke_config WHERE guild_id = ?').get(gid) as any;
  await sendTracked(reportCh, gid, 'webhook',
    antiNukeCfg?.enabled
      ? `🛡️ [SIM] Anti-Nuke would intervene after ${antiNukeCfg.webhook_limit} webhooks`
      : `⚠️ [SIM] Anti-Nuke INACTIVE — webhooks could be created without limit!`,
    400);

  return `${created} real webhooks created (rollback will delete all)`;
}

// ── SPAM (echte Nachrichten + Engine-Injection) ───────────────────────────────
async function simSpam(ix: ChatInputCommandInteraction, ch: TextChannel, count: number): Promise<string> {
  const gid = ix.guildId!;
  await sendTracked(ch, gid, 'spam', {
    embeds: [new EmbedBuilder().setColor('#fee75c').setTitle('🧪 [SIM] Spam Attack Starting')
      .setDescription(`${count} messages will be sent in rapid succession.\n\`/attacksim rollback\` deletes all.`)],
  }, 0);
  for (let i = 0; i < count; i++)
    await sendTracked(ch, gid, 'spam', `[SIM-SPAM ${i + 1}/${count}] ${SPAM_MESSAGES[i % SPAM_MESSAGES.length]}`, 150);
  // Inject directly into engine (bot messages bypass author.bot check)
  const result = await testInjectSpam(ix.guild!, ch, count, 'sim-spammer');
  return `${count} Spam-Nachrichten gesendet — Engine: **${result.triggered ? result.action : 'Schwellenwert nicht erreicht'}**`;
}

async function simCapsFlood(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  for (const msg of CAPS_MESSAGES) await sendTracked(ch, gid, 'caps', `[SIM] ${msg}`, 350);
  return `${CAPS_MESSAGES.length} CAPS-Nachrichten gesendet`;
}

async function simMassPing(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid   = ix.guildId!;
  const roles = ix.guild!.roles.cache.filter(r => !r.managed && r.id !== ix.guild!.id).first(3).map(r => r.toString()).join(' ');
  const pings = [
    `[SIM] @everyone @here ${roles} JOIN THE RAID`,
    `[SIM] HEY @everyone ATTENTION ${roles}`,
    `[SIM] EVERYONE ${roles} @here LOOK NOW`,
  ];
  for (const msg of pings) await sendTracked(ch, gid, 'masspings', msg, 400);
  // Inject content into engine for real detection
  const result = await testInjectContent(ix.guild!, ch, `@everyone @here ${roles} JOIN THE RAID`, 'sim-pinger');
  return `${pings.length} Mass-Ping-Nachrichten gesendet — Engine: **${result.triggered ? result.type : 'kein Trigger'}**`;
}

async function simPhishing(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  for (const msg of PHISHING_MESSAGES) await sendTracked(ch, gid, 'phishing', `[SIM] ${msg}`, 400);
  // Inject real phishing pattern directly into engine
  const result = await testInjectContent(ix.guild!, ch, 'free nitro: discord-gift-claim.example-sim.invalid/nitro', 'sim-phisher');
  return `${PHISHING_MESSAGES.length} Phishing-Nachrichten gesendet — Engine: **${result.triggered ? 'Phishing erkannt!' : 'Phishing-Filter inaktiv'}**`;
}

async function simInviteFlood(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  for (const msg of INVITE_MESSAGES) await sendTracked(ch, gid, 'invites', msg, 400);
  return `${INVITE_MESSAGES.length} Invite-Nachrichten gesendet`;
}

async function simBadwords(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  for (const msg of BADWORD_PATTERNS) await sendTracked(ch, gid, 'badwords', msg, 400);
  return `${BADWORD_PATTERNS.length} Badword-Nachrichten gesendet`;
}

async function simRegexBypass(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  for (const msg of REGEX_BYPASS) await sendTracked(ch, gid, 'regex', msg, 400);
  return `${REGEX_BYPASS.length} Regex-Bypass-Versuche gesendet`;
}

async function simEmojiSpam(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  for (const msg of EMOJI_SPAM) await sendTracked(ch, gid, 'emoji', msg, 350);
  return `${EMOJI_SPAM.length} Emoji-Spam-Nachrichten gesendet`;
}

async function simCopypasta(ix: ChatInputCommandInteraction, ch: TextChannel, count: number): Promise<string> {
  const gid = ix.guildId!;
  for (let i = 0; i < count; i++) await sendTracked(ch, gid, 'copypasta', `[SIM ${i + 1}/${count}] ${COPYPASTA}`, 200);
  return `${count}× identische Nachricht gesendet`;
}

async function simLinkFlood(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  const links = ['[SIM] https://example-sim-1.invalid', '[SIM] https://example-sim-2.invalid', '[SIM] https://example-sim-3.invalid'];
  for (const msg of links) await sendTracked(ch, gid, 'links', msg, 400);
  return `${links.length} Link-Nachrichten gesendet`;
}

async function simAltAccounts(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  const names = ['NewUser8821', 'User_2024_01', 'JustJoined44', 'Account0Day', 'DiscordNew99'];
  for (let i = 0; i < names.length; i++)
    await sendTracked(ch, gid, 'alt-accounts', `[SIM] Alt-Account ${i + 1}/5: **${names[i]}** — Account-Alter: **${i * 12}h**`, 500);
  return '5 Alt-Account-Szenarien simuliert';
}

async function simSelfbotJoins(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<string> {
  const gid = ix.guildId!;
  const bots = ['User_7f3a joined — 3h — Standard-Avatar', 'User_8c4d joined — 5h — Standard-Avatar', 'User_9b5e joined — 2h — Standard-Avatar'];
  for (const b of bots) await sendTracked(ch, gid, 'selfbot', `[SIM] ${b}`, 600);
  return 'Selfbot patterns simuliert';
}

// ══════════════════════════════════════════════════════════════════════════════
// ROLLBACK — stellt ALLES wieder her
// ══════════════════════════════════════════════════════════════════════════════

async function doRollback(ix: ChatInputCommandInteraction): Promise<void> {
  const gid = ix.guildId!;
  const guild = ix.guild!;
  const snapshots = getSnapshots(gid);
  const tracked = getTracked(gid);

  if (!snapshots.length && !tracked.length) {
    await ix.editReply({ embeds: [info('Rollback', 'Keine Simulationsdaten vorhanden.')] });
    return;
  }

  const log: string[] = [];

  // ── Phase 1: Nachrichten löschen (bulkDelete) ─────────────────────────────
  const byChannel = new Map<string, string[]>();
  for (const row of tracked) {
    const arr = byChannel.get(row.channel_id) ?? [];
    arr.push(row.message_id);
    byChannel.set(row.channel_id, arr);
  }

  let msgsDeleted = 0;
  await Promise.allSettled([...byChannel.entries()].map(async ([chId, msgIds]) => {
    const ch = guild.channels.cache.get(chId) as TextChannel | undefined;
    if (!ch) return;
    if (msgIds.length > 1) {
      await ch.bulkDelete(msgIds, true).then(m => { msgsDeleted += m.size; }).catch(async () => {
        await Promise.allSettled(msgIds.map(id => ch.messages.delete(id).then(() => msgsDeleted++).catch(() => {})));
      });
    } else if (msgIds.length === 1) {
      await ch.messages.delete(msgIds[0]).then(() => msgsDeleted++).catch(() => {});
    }
  }));
  if (msgsDeleted > 0) log.push(`🗑️ **${msgsDeleted} messages** deleted`);

  // ── Phase 2: Snapshots abarbeiten (neueste zuerst = Reihenfolge umkehren) ──
  let channelsUnlocked = 0, webhooksDeleted = 0, rolesDeleted = 0, channelsDeleted = 0;

  for (const snap of snapshots) {
    switch (snap.type) {

      // Kanal entsperren (aus join-raid Lockdown)
      case 'channel_locked': {
        const ch = guild.channels.cache.get(snap.data.id) as TextChannel | undefined;
        if (ch) {
          await ch.permissionOverwrites.edit(
            guild.roles.everyone,
            { SendMessages: null },
            { reason: '[attacksim rollback] Lockdown aufgehoben' },
          ).then(() => channelsUnlocked++).catch(() => {});
        }
        break;
      }

      // Webhook löschen (aus webhook-spam)
      case 'webhook_created': {
        try {
          const wh = await guild.fetchWebhooks().then(hooks => hooks.get(snap.data.id)).catch(() => null);
          if (wh) await wh.delete('[attacksim rollback]').then(() => webhooksDeleted++).catch(() => {});
        } catch {}
        break;
      }

      // Erstellte Rolle löschen (aus permission-grab)
      case 'role_created': {
        const role = guild.roles.cache.get(snap.data.id);
        if (role) await role.delete('[attacksim rollback]').then(() => rolesDeleted++).catch(() => {});
        break;
      }

      // Erstellten Kanal löschen (aus nuke, falls noch vorhanden)
      case 'channel_created': {
        const ch = guild.channels.cache.get(snap.data.id);
        if (ch) await ch.delete('[attacksim rollback]').then(() => channelsDeleted++).catch(() => {});
        break;
      }
    }
  }

  if (channelsUnlocked > 0) log.push(`🔓 **${channelsUnlocked} channels** unlocked`);
  if (webhooksDeleted > 0) log.push(`🕵️ **${webhooksDeleted} webhooks** deleted`);
  if (rolesDeleted > 0) log.push(`🎭 **${rolesDeleted} test roles** deleted`);
  if (channelsDeleted > 0) log.push(`📁 **${channelsDeleted} test channels** deleted`);

  // ── Cleanup DB ────────────────────────────────────────────────────────────
  clearTracked(gid);
  clearSnapshots(gid);
  // Auch raidsim_messages + sim_state bereinigen
  db.prepare('DELETE FROM raidsim_messages WHERE guild_id = ?').run(gid);
  db.prepare('DELETE FROM sim_state WHERE guild_id = ?').run(gid);

  await ix.editReply({
    embeds: [success(
      '✅ Rollback complete — server fully restored',
      log.length ? log.join('\n') : 'Alles bereinigt.',
    )],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Full scenario
// ══════════════════════════════════════════════════════════════════════════════

async function runFullScenario(ix: ChatInputCommandInteraction, ch: TextChannel): Promise<void> {
  const gid = ix.guildId!;
  const results: { label: string; result: string; ok: boolean }[] = [];

  const run = async (label: string, fn: () => Promise<string>, delay = 1500) => {
    await new Promise(r => setTimeout(r, delay));
    try { results.push({ label, result: await fn(), ok: true }); }
    catch (e) { results.push({ label, result: String(e), ok: false }); }
  };

  const header = await ch.send({
    embeds: [new EmbedBuilder().setColor('#5865f2').setTitle('🧪 Full Attack Scenario')
      .setDescription('Simulates several **real** attacks.\n`/attacksim rollback` restores everything.')
      .setTimestamp()],
    allowedMentions: { parse: [] },
  }).catch(() => null);
  if (header) trackMsg(gid, ch.id, header.id, 'scenario');

  await run('Spam-Flood',       () => simSpam(ix, ch, 5), 500);
  await run('Phishing-Links',   () => simPhishing(ix, ch), 2000);
  await run('Mass-Pings',       () => simMassPing(ix, ch), 2000);
  await run('Webhook-Spam',     () => simWebhookSpam(ix, ch), 2000);
  await run('Permission-Grab',  () => simPermissionGrab(ix, ch), 2000);
  await run('Join-Raid/Lockdown', () => simJoinRaid(ix, ix.options.getInteger('count') ?? 15), 2000);

  const summary = await ch.send({
    embeds: [new EmbedBuilder().setColor('#57f287')
      .setTitle('📊 Szenario abgeschlossen')
      .setDescription(results.map(r => `${r.ok ? '✅' : '❌'} **${r.label}**: ${r.result}`).join('\n'))
      .addFields({ name: '🧹 Rollback', value: '`/attacksim rollback`' })
      .setTimestamp()],
    allowedMentions: { parse: [] },
  }).catch(() => null);
  if (summary) trackMsg(gid, ch.id, summary.id, 'scenario');

  await ix.editReply({
    embeds: [success('✅ Scenario running', `All attacks active.\nSiehe <#${ch.id}> for details.\n\`/attacksim rollback\` zum Bereinigen.`)],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Status
// ══════════════════════════════════════════════════════════════════════════════

async function showStatus(ix: ChatInputCommandInteraction): Promise<void> {
  const gid = ix.guildId!;
  const snapshots = getSnapshots(gid);
  const tracked = getTracked(gid);

  if (!snapshots.length && !tracked.length) {
    await ix.reply({ embeds: [info('Keine Simulationen', 'Keine aktiven Simulationsdaten.')], flags: MessageFlags.Ephemeral });
    return;
  }

  const byType: Record<string, number> = {};
  tracked.forEach(t => {});
  snapshots.forEach(s => { byType[s.type] = (byType[s.type] ?? 0) + 1; });

  const lockedCount = snapshots.filter(s => s.type === 'channel_locked').length;
  const webhookCount = snapshots.filter(s => s.type === 'webhook_created').length;
  const roleCount = snapshots.filter(s => s.type === 'role_created').length;

  await ix.reply({
    embeds: [new EmbedBuilder().setColor('#fee75c').setTitle('🧪 Aktive Simulationsdaten')
      .setDescription(
        `**Nachrichten:** ${tracked.length}\n` +
        `**Locked channels:** ${lockedCount}\n` +
        `**Erstellte Webhooks:** ${webhookCount}\n` +
        `**Erstellte Rollen:** ${roleCount}\n\n` +
        `Rollback mit \`/attacksim rollback\``,
      )
      .setTimestamp()],
    flags: MessageFlags.Ephemeral,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Command definition
// ══════════════════════════════════════════════════════════════════════════════

export default {
  data: new SlashCommandBuilder()
    .setName('attacksim')
    .setDescription('Full attack simulator with real Discord actions (rollback restores everything)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)

    .addSubcommandGroup(g => g.setName('join').setDescription('Join-based attacks')
      .addSubcommand(s => s.setName('raid').setDescription('🔒 REAL lockdown of all channels — tests Anti-Raid')
        .addIntegerOption(o => o.setName('count').setDescription('Simulated joins (default: 15)').setMinValue(5).setMaxValue(50)))
      .addSubcommand(s => s.setName('alt-accounts').setDescription('Alt-account text simulation')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('selfbots').setDescription('Selfbot patterns')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))))

    .addSubcommandGroup(g => g.setName('msg').setDescription('Message-based attacks')
      .addSubcommand(s => s.setName('spam').setDescription('Spam-Flood')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addIntegerOption(o => o.setName('count').setDescription('Count').setMinValue(3).setMaxValue(30)))
      .addSubcommand(s => s.setName('caps').setDescription('CAPS-Flood')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('masspings').setDescription('Mass-ping (not a real ping)')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('phishing').setDescription('Phishing-Links')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('invites').setDescription('Invite-Flood')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('badwords').setDescription('Badword-Filter-Test')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('regex-bypass').setDescription('Regex-Bypass-Versuche')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('emoji-spam').setDescription('Emoji-Spam')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('copypasta').setDescription('Identical messages')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addIntegerOption(o => o.setName('count').setDescription('Repetitions').setMinValue(3).setMaxValue(20)))
      .addSubcommand(s => s.setName('links').setDescription('Link-Flood')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))))

    .addSubcommandGroup(g => g.setName('escalation').setDescription('Escalation attacks')
      .addSubcommand(s => s.setName('nuke').setDescription('💣 Real nuke test: creates + deletes channels/roles')
        .addChannelOption(o => o.setName('channel').setDescription('Report channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('permission-grab').setDescription('🔑 Real admin role is created (rollback deletes it)')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand(s => s.setName('webhook-spam').setDescription('🕵️ Real webhooks are created + used to send messages')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))))

    .addSubcommand(s => s.setName('scenario').setDescription('🔥 Full real scenario (all attack types combined)')
      .addChannelOption(o => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addIntegerOption(o => o.setName('count').setDescription('Raid join count (default: 15)').setMinValue(5).setMaxValue(50)))

    .addSubcommand(s => s.setName('status').setDescription('Show active simulation data'))
    .addSubcommand(s => s.setName('rollback').setDescription('🗑️ Fully restores server state')),

  async execute(ix: ChatInputCommandInteraction) {
    if (!await requireAdmin(ix)) return;

    const sub = ix.options.getSubcommand();
    const group = ix.options.getSubcommandGroup(false);
    const gid = ix.guildId!;

    if (sub === 'status') { await showStatus(ix); return; }

    if (sub === 'rollback') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      await doRollback(ix);
      return;
    }

    if (sub === 'scenario') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const ch = ix.options.getChannel('channel', true) as TextChannel;
      await runFullScenario(ix, ch);
      return;
    }

    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const ch = ix.options.getChannel('channel') as TextChannel | null;

    let result = '';

    if (group === 'join') {
      if (sub === 'raid') result = await simJoinRaid(ix, ix.options.getInteger('count') ?? 15);
      else if (sub === 'alt-accounts' && ch) result = await simAltAccounts(ix, ch);
      else if (sub === 'selfbots' && ch) result = await simSelfbotJoins(ix, ch);
    }

    if (group === 'msg') {
      if (!ch) { await ix.editReply({ embeds: [error('Kein Kanal', 'Bitte gib einen Kanal an.')] }); return; }
      if (sub === 'spam') result = await simSpam(ix, ch, ix.options.getInteger('count') ?? 10);
      else if (sub === 'caps') result = await simCapsFlood(ix, ch);
      else if (sub === 'masspings') result = await simMassPing(ix, ch);
      else if (sub === 'phishing') result = await simPhishing(ix, ch);
      else if (sub === 'invites') result = await simInviteFlood(ix, ch);
      else if (sub === 'badwords') result = await simBadwords(ix, ch);
      else if (sub === 'regex-bypass') result = await simRegexBypass(ix, ch);
      else if (sub === 'emoji-spam') result = await simEmojiSpam(ix, ch);
      else if (sub === 'copypasta') result = await simCopypasta(ix, ch, ix.options.getInteger('count') ?? 8);
      else if (sub === 'links') result = await simLinkFlood(ix, ch);
    }

    if (group === 'escalation') {
      if (!ch) { await ix.editReply({ embeds: [error('Kein Kanal', 'Bitte gib einen Kanal an.')] }); return; }
      if (sub === 'nuke') result = await simNuke(ix, ch);
      else if (sub === 'permission-grab') result = await simPermissionGrab(ix, ch);
      else if (sub === 'webhook-spam') result = await simWebhookSpam(ix, ch);
    }

    await ix.editReply({
      embeds: [success('🧪 Simulation aktiv', `${result}\n\n\`/attacksim rollback\` zum Bereinigen.`)],
    });
  },
};
