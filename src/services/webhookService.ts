/**
 * WEBHOOK SERVICE
 * HTTP-Calls an Discord Webhook-URLs via axios.
 *
 * Unterstützt:
 *  - Senden (POST)
 *  - Bearbeiten (PATCH)
 *  - Löschen (DELETE)
 *  - Validierung der URL
 *  - Parsen von Nachrichten-Links
 */

import axios, { AxiosError } from 'axios';

export interface WebhookEmbed {
  title?:       string;
  description?: string;
  url?:         string;          // Title-Link
  color?:       number;          // Dezimalzahl, z.B. 0x5865f2
  timestamp?:   string;         // ISO 8601
  author?: {
    name:     string;
    url?:     string;
    icon_url?: string;
  };
  thumbnail?: { url: string };
  image?:     { url: string };
  footer?: {
    text:     string;
    icon_url?: string;
  };
  fields?: Array<{
    name:   string;
    value:  string;
    inline?: boolean;
  }>;
}

export interface WebhookPayload {
  content?:    string;
  username?:   string;
  avatar_url?: string;
  embeds?:     WebhookEmbed[];
}

export interface WebhookResult {
  ok:      boolean;
  status?: number;
  error?:  string;
  messageId?: string;
}

// ────────────────────────────────────────────────────────────────────────────

/** Prüft ob eine URL eine gültige Discord Webhook-URL ist. */
export function isValidWebhookUrl(url: string): boolean {
  return /^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/.+$/.test(url);
}

/**
 * Parst einen Discord-Nachrichtenlink und gibt guildId, channelId, messageId zurück.
 * Format: https://discord.com/channels/{guild}/{channel}/{message}
 */
export function parseMessageLink(link: string): { channelId: string; messageId: string } | null {
  const m = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { channelId: m[2], messageId: m[3] };
}

/** Sendet eine Webhook-Nachricht. Gibt die Message-ID zurück wenn wait=true. */
export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
): Promise<WebhookResult> {
  try {
    const res = await axios.post(`${url}?wait=true`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    return { ok: true, status: res.status, messageId: res.data?.id };
  } catch (e) {
    return formatError(e);
  }
}

/** Bearbeitet eine bestehende Webhook-Nachricht. */
export async function editWebhookMessage(
  webhookUrl: string,
  messageId: string,
  payload: WebhookPayload,
): Promise<WebhookResult> {
  try {
    const res = await axios.patch(`${webhookUrl}/messages/${messageId}`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    return { ok: true, status: res.status };
  } catch (e) {
    return formatError(e);
  }
}

/** Löscht eine Webhook-Nachricht. */
export async function deleteWebhookMessage(
  webhookUrl: string,
  messageId: string,
): Promise<WebhookResult> {
  try {
    const res = await axios.delete(`${webhookUrl}/messages/${messageId}`);
    return { ok: true, status: res.status };
  } catch (e) {
    return formatError(e);
  }
}

/** Konvertiert einen Hex-String (#rrggbb) in eine Dezimalzahl. */
export function hexToDecimal(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function formatError(e: unknown): WebhookResult {
  const err = e as any;
  const status  = err?.response?.status;
  const discord = err?.response?.data?.message ?? err?.message ?? String(e);
  return { ok: false, status, error: `${status ?? '?'}: ${discord}` };
}
