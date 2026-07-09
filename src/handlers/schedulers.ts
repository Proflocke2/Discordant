import { closePoll } from '../commands/utility/poll';
import { runInactivityKick } from '../merged/impl/inactivitykick';
import { BotClient } from '../utils/types';
import db, { getGuild } from '../database/db';
import { runAutoclose } from '../modules/tickets/service';
import * as Repo from '../modules/tickets/repository';
import { GiveawayRow } from '../utils/types';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { getLocalized, Language } from '../utils/localization';
import { runStaffActivityTick } from '../modules/staffActivity/service';
import { runAutoBackupTick } from '../modules/backup/service';
import { pushDbToGithub } from '../services/dbSync';
import { pruneOldData, vacuumDatabase } from '../modules/maintenance/dbMaintenance';

export function startGiveawayScheduler(client: BotClient) {
  setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    const due = db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?').all(now) as GiveawayRow[];

    for (const g of due) {
      db.prepare('UPDATE giveaways SET ended = 1 WHERE id = ?').run(g.id);
      const participants: string[] = JSON.parse(g.participants);

      try {
        const channel  = await client.channels.fetch(g.channel_id) as TextChannel;
        const msg      = g.message_id ? await channel.messages.fetch(g.message_id) : null;
        const guild    = getGuild(g.guild_id);
        const lang     = (guild.language || 'en') as Language;

        if (participants.length === 0) {
          const noWinners = new EmbedBuilder()
            .setTitle(getLocalized('giveaway.ended', lang))
            .setDescription(`**${g.prize}**\n\nNo valid participants.`)
            .setColor('#ed4245')
            .setTimestamp();
          if (msg) await msg.edit({ embeds: [noWinners], components: [] });
          continue;
        }

        const winners: string[] = [];
        const pool = [...participants];
        for (let i = 0; i < Math.min(g.winners, pool.length); i++) {
          const idx = Math.floor(Math.random() * pool.length);
          winners.push(pool.splice(idx, 1)[0]);
        }

        db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify(winners), g.id);

        const winEmbed = new EmbedBuilder()
          .setTitle(getLocalized('giveaway.ended', lang))
          .setDescription(`${getLocalized('giveaway.prize', lang)}: **${g.prize}**\n\n${getLocalized('giveaway.winners', lang)}: ${winners.map(w => `<@${w}>`).join(', ')}`)
          .setColor('#57f287')
          .setFooter({ text: `${participants.length} participants` })
          .setTimestamp();

        if (msg) await msg.edit({ embeds: [winEmbed], components: [] });
        await channel.send(`🎊 ${winners.map(w => `<@${w}>`).join(', ')} won **${g.prize}**!`);
      } catch {
        // channel or message was deleted, skip silently
      }
    }
  }, 10000);
}

export function startReminderScheduler(client: BotClient) {
  setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    const due = db.prepare('SELECT * FROM reminders WHERE done = 0 AND remind_at <= ?').all(now) as any[];

    for (const r of due) {
      try {
        const ch = await client.channels.fetch(r.channel_id) as TextChannel;
        await ch.send(`<@${r.user_id}> ⏰ Reminder: ${r.message}`);
      } catch {
        // channel may have been deleted
      }
      const repeatInterval = r.repeat_interval ?? 0;
      if (repeatInterval > 0) {
        const nextRemindAt = Math.floor(Date.now() / 1000) + repeatInterval;
        db.prepare('UPDATE reminders SET remind_at=? WHERE id=?').run(nextRemindAt, r.id);
      } else {
        db.prepare('UPDATE reminders SET done = 1 WHERE id = ?').run(r.id);
      }
    }
  }, 15000);
}

// ── Autoclose Scheduler ───────────────────────────────────────────────────────
// Runs every 5 minutes. Closes all inactive tickets in guilds with autoclose on.

export function startAutocloseScheduler(client: BotClient) {
  setInterval(async () => {
    // Collect all guilds that have autoclose enabled
    const guildsWithAutoclose = (db.prepare(
      `SELECT guild_id, autoclose_hours FROM ticket_settings WHERE autoclose_enabled = 1`,
    ).all() as Array<{ guild_id: string; autoclose_hours: number }>);

    for (const { guild_id } of guildsWithAutoclose) {
      const guild = client.guilds.cache.get(guild_id);
      if (!guild) continue;
      try {
        const closed = await runAutoclose(guild);
        if (closed > 0) {
          console.log(`[Autoclose] Closed ${closed} inactive ticket(s) in ${guild.name}`);
        }
      } catch (err) {
        console.error(`[Autoclose] Error in guild ${guild_id}:`, err);
      }
    }
  }, 5 * 60 * 1000); // every 5 minutes
}

export function startLotteryScheduler(client: BotClient) {
  setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    const dueLotteries = db.prepare('SELECT * FROM lottery WHERE drawn=0 AND draw_at<=?').all(now) as any[];
    for (const lottery of dueLotteries) {
      db.prepare('UPDATE lottery SET drawn=1 WHERE id=?').run(lottery.id);
      const tickets = db.prepare('SELECT * FROM lottery_tickets WHERE lottery_id=?').all(lottery.id) as any[];
      if (tickets.length === 0) continue;
      const winner = tickets[Math.floor(Math.random() * tickets.length)];
      db.prepare('UPDATE lottery SET winner_id=? WHERE id=?').run(winner.user_id, lottery.id);
      const { addPoints } = await import('../economy/db/EconomyDB');
      addPoints(winner.user_id, lottery.guild_id, lottery.pot);
      try {
        const guild = client.guilds.cache.get(lottery.guild_id);
        if (!guild) continue;
        const cfg = db.prepare('SELECT log_channel FROM inactivity_config WHERE guild_id=?').get(lottery.guild_id) as any;
        const channels = guild.channels.cache.filter(c => c.isTextBased());
        const ch = channels.first() as any;
        if (ch) await ch.send({ embeds: [{ title: '🎰 Lottery Draw!', color: 0x57f287, description: `<@${winner.user_id}> won the lottery and claimed **${lottery.pot.toLocaleString()} coins**! 🎉
${tickets.length} participants.` }] });
      } catch {}
    }
  }, 60_000);
}

export function startPollScheduler(client: BotClient) {
  setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    const duePolls = db.prepare('SELECT * FROM polls WHERE ended=0 AND ends_at IS NOT NULL AND ends_at<=?').all(now) as any[];
    for (const poll of duePolls) {
      await closePoll(client, poll.id);
    }
  }, 30_000);
}

export function startInactivityScheduler(client: BotClient) {
  // Run once per day
  setInterval(async () => {
    await runInactivityKick(client);
  }, 24 * 60 * 60 * 1000);
}

// ── Staff Activity Tracking Scheduler ────────────────────────────────────────
// Runs every 15 minutes. Handles: weekly quota DM reminders (fires once at the
// configured weekday+hour), the weekly counter reset (always, every Monday
// 00:00 UTC), and auto-posting the leaderboard on its configured interval.
// Every check is individually guarded (see modules/staffActivity/weekUtils.ts),
// so re-running this every 15 minutes is safe and never double-fires.

export function startStaffActivityScheduler(client: BotClient) {
  setInterval(async () => {
    try {
      await runStaffActivityTick(client.guilds.cache);
    } catch (err) {
      console.error('[StaffActivity] Scheduler tick failed:', err);
    }
  }, 15 * 60 * 1000); // every 15 minutes
}

// ── Auto-Backup Scheduler ────────────────────────────────────────────────────
// Runs every hour. Guarded by a stored day/week key per guild (see
// modules/backup/repository.ts), so it only actually creates + delivers a
// backup once per day (or once per week), no matter how often this fires.

export function startAutoBackupScheduler(client: BotClient) {
  setInterval(async () => {
    try {
      await runAutoBackupTick(client.guilds.cache);
    } catch (err) {
      console.error('[AutoBackup] Scheduler tick failed:', err);
    }
  }, 60 * 60 * 1000); // every hour
}

// ── DB Sync Scheduler ─────────────────────────────────────────────────────────
// Pushes bot.db to GitHub every 15 minutes — see services/dbSync.ts. This is
// the periodic counterpart to the SIGTERM/SIGINT push in index.ts (shutdown
// isn't guaranteed to always fire cleanly, e.g. a hard crash or host-level
// kill, so relying on shutdown alone would risk losing up to a full session).

export function startDbSyncScheduler(client: BotClient) {
  setInterval(async () => {
    try {
      await pushDbToGithub();
    } catch (err) {
      console.error('[DbSync] Scheduler tick failed:', err);
    }
  }, 15 * 60 * 1000); // every 15 minutes
}

// ── DB Maintenance Scheduler ─────────────────────────────────────────────────
// Runs once a day. Prunes transient/log-style tables (see dbMaintenance.ts for
// exactly which ones and why) and then VACUUMs — this is what actually keeps
// bot.db small on disk (and therefore what gets pushed to GitHub). Runs once
// shortly after startup too, so a freshly-deployed instance doesn't wait a
// full day for its first cleanup.

export function startDbMaintenanceScheduler(client: BotClient) {
  const run = () => {
    try {
      const { totalDeleted } = pruneOldData();
      vacuumDatabase();
      if (totalDeleted > 0) {
        console.log(`[DbMaintenance] Pruned ${totalDeleted} old rows and vacuumed bot.db.`);
      }
    } catch (err) {
      console.error('[DbMaintenance] Run failed:', err);
    }
  };

  setTimeout(run, 5 * 60 * 1000);            // once, 5 minutes after boot
  setInterval(run, 24 * 60 * 60 * 1000);     // then once a day
}
