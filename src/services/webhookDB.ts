import db from '../database/db';

db.exec(`
  CREATE TABLE IF NOT EXISTS saved_webhooks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id  TEXT NOT NULL,
    name      TEXT NOT NULL,
    url       TEXT NOT NULL,
    UNIQUE(guild_id, name)
  );
`);

export function saveWebhook(guildId: string, name: string, url: string): void {
  db.prepare('INSERT OR REPLACE INTO saved_webhooks (guild_id, name, url) VALUES (?, ?, ?)').run(guildId, name, url);
}

export function getWebhook(guildId: string, name: string): { url: string } | null {
  return db.prepare('SELECT url FROM saved_webhooks WHERE guild_id = ? AND name = ?').get(guildId, name) as any;
}

export function listWebhooks(guildId: string): { name: string; url: string }[] {
  return db.prepare('SELECT name, url FROM saved_webhooks WHERE guild_id = ? ORDER BY name').all(guildId) as any[];
}

export function deleteWebhook(guildId: string, name: string): void {
  db.prepare('DELETE FROM saved_webhooks WHERE guild_id = ? AND name = ?').run(guildId, name);
}

export function removeWebhook(guildId: string, name: string): void {
  deleteWebhook(guildId, name);
}
