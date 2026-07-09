import 'dotenv/config';
import http from 'http';
import { Client, GatewayIntentBits, Partials, Collection, Options } from 'discord.js';
import { BotClient } from './utils/types';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';
import { deployCommands } from './handlers/deploy';
import { startGiveawayScheduler, startReminderScheduler, startAutocloseScheduler, startLotteryScheduler, startPollScheduler, startInactivityScheduler, startStaffActivityScheduler, startAutoBackupScheduler, startDbSyncScheduler, startDbMaintenanceScheduler } from './handlers/schedulers';
import { VerificationService } from './services/verificationService';
import { GameManager } from './services/gameManager';
import { initializeVerification } from './database/db';
import { initEconomyTables } from './economy/db/EconomyDB';
// Init new panel DB tables on import
import './services/panelDB';
import { GamblingCooldown } from './economy/cooldown/GamblingCooldown';
import { EconomyConfig } from './economy/config/EconomyConfig';
import { initStatsTables } from './stats/StatsDB';

// ── New v2 modules — side-effect imports register tables ─────────────────────
import './modules/tickets/repository';
import './modules/welcome/repository';
import './modules/backup/repository';
import './modules/security/securityEngine'; // registers security_config table
import { loadLocales } from './i18n';
import { runMigrations } from './modules/backup/migrations';
import { runDeployGuard } from './modules/backup/deployGuard';

import { applyDueRoles } from './modules/welcome/service';
import { registerAntiNuke } from './modules/moderation/antiNuke';
import { cleanExpiredMutes } from './modules/moderation/stickyMute';
import { pushDbToGithub } from './services/dbSync';

// ── FIX: Global error handlers — prevent unhandled promise rejections from
//    crashing the process. Logs the error and keeps the bot alive.
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception — exiting for clean restart:', err);
  process.exit(1);
});

// ── Graceful shutdown — push bot.db to GitHub one last time before exiting.
//    Render sends SIGTERM on redeploy/restart and follows up with SIGKILL
//    after ~10s if the process hasn't exited — so the push is raced against
//    an 8s timeout to guarantee we still call process.exit() in time, rather
//    than risking a hung HTTP request eating the whole grace period.
//    SIGINT is handled the same way for local testing (Ctrl+C).
async function shutdownWithDbPush(signal: string): Promise<void> {
  console.log(`[Shutdown] ${signal} received — pushing bot.db to GitHub before exit...`);
  const timeout = new Promise<void>(resolve => setTimeout(resolve, 8_000));
  await Promise.race([pushDbToGithub(), timeout]).catch(() => {});
  console.log('[Shutdown] Done — exiting.');
  process.exit(0);
}

process.on('SIGTERM', () => { shutdownWithDbPush('SIGTERM'); });
process.on('SIGINT',  () => { shutdownWithDbPush('SIGINT'); });

// ── HTTP Server für Render Web Service ───────────────────────────────────────
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!');
});
server.listen(process.env.PORT || 3000, () => {
  console.log(`[HTTP] Server listening on port ${process.env.PORT || 3000}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration,  // Required for guildAuditLogEntryCreate (Anti-Nuke)
    GatewayIntentBits.GuildPresences,   // Required for presence?.status in StatsService online-counter
  ],
  // Partials.User is required so uncached reaction authors (messageReactionAdd/Remove
  // on old/unfetched messages) arrive as fetchable partials instead of being dropped —
  // see events/messageReactionAdd.ts and modules/moderation/modLog.ts.
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],

  // ── RAM efficiency ─────────────────────────────────────────────────────────
  // discord.js caches almost everything forever by default. On Render's free
  // tier (512MB) that adds up fast across many guilds/channels. We can afford
  // to cut these aggressively because:
  //  - Message deletes/edits are logged via modLog.ts, which already handles
  //    `.partial` (uncached) messages gracefully — see that file's header
  //    comment. So we don't need a big message cache just for logging.
  //  - Nothing in this codebase reads `message.reactions.cache`,
  //    `guild.bans.cache`, `guild.stickers.cache`, or voice states from
  //    cache (verified by grep) — reaction-roles use buttons, not native
  //    emoji reactions, and moderation commands fetch bans/etc on demand.
  //  - GuildMemberManager and PresenceManager are deliberately left at
  //    default (unlimited): /report-staff and /team-activity's quota
  //    reminder both read `role.members` from the member cache, and the
  //    `/stats` online-counter reads `member.presence` — capping either
  //    would silently break those features.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 25,        // per-channel cache; default is 200 — we don't need history, just recent context
    ReactionManager: 0,        // not read from cache anywhere in this codebase
    GuildBanManager: 0,        // ban commands fetch on demand
    GuildStickerManager: 0,
    GuildScheduledEventManager: 0,
    VoiceStateManager: 0,      // no voice features in this bot
    ThreadManager: 25,         // tickets/panels don't use threads; keep a small cap just in case
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings, // keeps the built-in archived-thread sweep
    messages: {
      interval: 600,  // sweep every 10 minutes
      lifetime: 900,  // evict cached messages older than 15 minutes
    },
  },
}) as BotClient;

client.commands = new Collection();

(async () => {
  initializeVerification();
  initEconomyTables();
  // Session-Limit aus EconomyConfig synchronisieren
  GamblingCooldown.SESSION_LIMIT = EconomyConfig.SETTINGS.sessionLimit;
  initStatsTables();

  // Locales: load translation bundles from src/locales/
  loadLocales();

  // ── DEPLOY GUARD: always-on config protection ─────────────────────────────
  // Must run BEFORE runMigrations() so configs are snapshotted before any
  // schema change. Cannot be disabled. Detects version changes automatically.
  try {
    const guard = runDeployGuard();
    if (guard.versionChanged) {
      console.log(`[DeployGuard] Protected ${guard.snapshotsTaken} guild(s) before upgrade.`);
      if (guard.snapshotsFailed > 0) {
        console.warn(`[DeployGuard] ${guard.snapshotsFailed} snapshot(s) failed — check logs.`);
      }
    }
    if (guard.columnsAdded.length > 0) {
      console.log(`[DeployGuard] Schema updated: +${guard.columnsAdded.length} column(s).`);
    }
  } catch (err) {
    console.error('[DeployGuard] WARN: guard encountered an error (non-fatal):', err);
  }

  // Schema migrations: forward-only, idempotent
  try {
    const r = runMigrations();
    if (r.applied.length > 0) {
      console.log(`[Migrations] ${r.from} → ${r.to} (${r.applied.length} applied)`);
    } else {
      console.log(`[Migrations] up to date at ${r.to}`);
    }
  } catch (err) {
    console.error('[Migrations] FATAL:', err);
    process.exit(1);
  }

  VerificationService.initialize();
  GameManager.initialize();

  await loadCommands(client);
  await loadEvents(client);

  if (process.env.BOT_TOKEN && process.env.CLIENT_ID) {
    try {
      await deployCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID);
    } catch (err) {
      console.error('[Deploy] Command deploy failed — bot continues anyway:', err instanceof Error ? err.message : err);
    }
  }

  startGiveawayScheduler(client);
  startReminderScheduler(client);
  startAutocloseScheduler(client);
  startLotteryScheduler(client);
  startPollScheduler(client);
  startInactivityScheduler(client);
  startStaffActivityScheduler(client);
  startAutoBackupScheduler(client);
  startDbSyncScheduler(client);
  startDbMaintenanceScheduler(client);

  // Welcome delayed-role scheduler (every minute)
  setInterval(() => {
    applyDueRoles(client).catch(err => console.error('[Welcome] applyDueRoles failed:', err));
  }, 60_000);

  // Anti-Nuke — register audit log listener after login
  client.once('clientReady', () => {
    registerAntiNuke(client);
  });

  // Sticky Mute — cleanup expired entries every 5 minutes
  setInterval(() => {
    try { cleanExpiredMutes(); } catch { /* ignore */ }
  }, 5 * 60_000);

  await client.login(process.env.BOT_TOKEN);
})();
