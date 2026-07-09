/**
 * WEBHOOK SESSION STORE
 * Hält den Zustand des Embed-Builders zwischen Modals und Button-Klicks.
 * TTL: 10 Minuten.
 */

import { WebhookEmbed, WebhookPayload } from '../services/webhookService';

export interface WebhookSession {
  webhookUrl:  string;
  payload:     WebhookPayload;
  editMsgId?:  string;          // gesetzt wenn Bearbeitung
}

const TTL     = 10 * 60_000;
const sessions = new Map<string, WebhookSession & { expiresAt: number }>();

// FIX: Cleanup expired sessions every 15 minutes to prevent memory leak under load.
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(k);
  }
}, 15 * 60_000);

function key(userId: string, guildId: string) { return `${userId}_${guildId}`; }

export function setSession(userId: string, guildId: string, s: WebhookSession): void {
  sessions.set(key(userId, guildId), { ...s, expiresAt: Date.now() + TTL });
}

export function getSession(userId: string, guildId: string): WebhookSession | null {
  const s = sessions.get(key(userId, guildId));
  if (!s || Date.now() > s.expiresAt) { sessions.delete(key(userId, guildId)); return null; }
  return s;
}

export function updateSession(userId: string, guildId: string, patch: Partial<WebhookSession>): void {
  const s = getSession(userId, guildId);
  if (!s) return;
  sessions.set(key(userId, guildId), { ...s, ...patch, expiresAt: Date.now() + TTL });
}

export function patchEmbed(userId: string, guildId: string, embedPatch: Partial<WebhookEmbed>): void {
  const s = getSession(userId, guildId);
  if (!s) return;
  const embed = s.payload.embeds?.[0] ?? {};
  const merged = { ...embed, ...embedPatch };
  updateSession(userId, guildId, { payload: { ...s.payload, embeds: [merged] } });
}

export function clearSession(userId: string, guildId: string): void {
  sessions.delete(key(userId, guildId));
}
