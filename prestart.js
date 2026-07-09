/**
 * prestart.js — DB pull from GitHub BEFORE any bot modules load.
 *
 * This runs as a completely separate Node.js process BEFORE index.js starts.
 * This guarantees bot.db is in place before any import touches the database.
 *
 * Called via: node prestart.js && node dist/index.js
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const DB_PATH       = process.env.DB_PATH || path.join(process.cwd(), 'bot.db');

if (!GITHUB_TOKEN || !GITHUB_REPO) {
  console.log('[PreStart] No GITHUB_TOKEN/GITHUB_REPO — skipping DB pull.');
  process.exit(0);
}

const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/bot.db?ref=${GITHUB_BRANCH}`;

console.log('[PreStart] Pulling bot.db from GitHub BEFORE bot starts...');

const options = {
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'MultiBotPreStart/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  }
};

https.get(API_URL, options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 404) {
      console.log('[PreStart] No bot.db on GitHub yet — fresh start.');
      process.exit(0);
    }
    if (res.statusCode !== 200) {
      console.error(`[PreStart] GitHub API error: ${res.statusCode} — continuing without pull.`);
      process.exit(0);
    }
    try {
      const json    = JSON.parse(data);
      const base64  = json.content.replace(/\n/g, '');
      const buf     = Buffer.from(base64, 'base64');
      fs.writeFileSync(DB_PATH, buf);
      console.log(`[PreStart] ✓ bot.db restored (${(buf.length / 1024).toFixed(1)} KB) — bot will now start.`);
      process.exit(0);
    } catch (err) {
      console.error('[PreStart] Failed to parse/write bot.db:', err.message);
      process.exit(0); // non-fatal — bot starts with whatever DB exists
    }
  });
}).on('error', (err) => {
  console.error('[PreStart] Network error pulling bot.db:', err.message);
  process.exit(0); // non-fatal
});
