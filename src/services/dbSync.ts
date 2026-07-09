/**
 * services/dbSync.ts
 *
 * DB PUSH to GitHub — the write-side counterpart to prestart.js (which pulls
 * bot.db from GitHub before the bot boots, in a separate process). This file
 * pushes bot.db back up, since Render's free tier has an ephemeral
 * filesystem: without a push mechanism, bot.db is lost on every
 * restart/redeploy and prestart.js would have nothing to restore.
 *
 * pushDbToGithub() is called from two places:
 *   - handlers/schedulers.ts → startDbSyncScheduler() — every 15 minutes
 *   - index.ts → SIGTERM/SIGINT handlers — on graceful shutdown
 *
 * This file does not touch prestart.js, EconomyDB, or the ticket
 * repository — it's a standalone, additive sync mechanism for the raw
 * bot.db file, using the same GitHub Contents API + env vars as the
 * existing pull logic in prestart.js.
 */

import axios, { AxiosError } from 'axios';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DB_PATH       = process.env.DB_PATH || path.join(process.cwd(), 'bot.db');

const CONTENTS_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/bot.db`;

function githubHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'MultiBotDbSync/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Pushes the current bot.db to GitHub via the Contents API (create-or-update).
 *
 * - No-op (with a log line) if GITHUB_TOKEN/GITHUB_REPO aren't set — same
 *   opt-in behavior as prestart.js.
 * - The Contents API requires the current file's `sha` to update an existing
 *   file (a PUT without it fails with 409 Conflict), so this does a GET
 *   first to fetch it. A 404 on that GET just means the file doesn't exist
 *   on GitHub yet — that's fine, no sha needed for the initial create.
 * - Never throws. Every failure is caught, logged, and swallowed — a failed
 *   backup push must never crash or destabilize the bot.
 */
export async function pushDbToGithub(): Promise<void> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log('[DbSync] No GITHUB_TOKEN/GITHUB_REPO — skipping DB push.');
    return;
  }

  if (!existsSync(DB_PATH)) {
    console.error(`[DbSync] bot.db not found at ${DB_PATH} — skipping push.`);
    return;
  }

  try {
    const buf = readFileSync(DB_PATH);
    const contentBase64 = buf.toString('base64');

    let sha: string | undefined;
    try {
      const getRes = await axios.get(`${CONTENTS_URL}?ref=${GITHUB_BRANCH}`, { headers: githubHeaders() });
      sha = getRes.data?.sha;
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status !== 404) throw err; // anything other than "doesn't exist yet" is a real problem
    }

    await axios.put(
      CONTENTS_URL,
      {
        message: `Auto DB backup — ${new Date().toISOString()}`,
        content: contentBase64,
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {}),
      },
      { headers: githubHeaders() },
    );

    console.log(`[DbSync] ✓ bot.db pushed to GitHub (${(buf.length / 1024).toFixed(1)} KB).`);
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DbSync] Push failed${status ? ` (HTTP ${status})` : ''}:`, message);
  }
}
