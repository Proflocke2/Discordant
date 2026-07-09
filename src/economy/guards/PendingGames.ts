/**
 * PENDING GAMES STORE
 * Speichert Spielanfragen die noch auf den Disclaimer-Accept warten.
 * Läuft nach 60 Sekunden automatisch ab.
 */

export type PendingGameType = 'slots' | 'blackjack' | 'challenge';

export interface PendingGame {
  type:       PendingGameType;
  userId:     string;
  guildId:    string;
  channelId:  string;
  bet:        number;
  // Nur für Challenge:
  opponentId?:   string;
  challengeGame?: 'blackjack' | 'coinflip';
}

const EXPIRY_MS = 60_000; // 60 Sekunden zum Akzeptieren
const store = new Map<string, PendingGame & { expiresAt: number }>();

function key(userId: string, guildId: string): string {
  return `${userId}_${guildId}`;
}

export function storePending(game: PendingGame): void {
  const k = key(game.userId, game.guildId);
  store.set(k, { ...game, expiresAt: Date.now() + EXPIRY_MS });
  setTimeout(() => store.delete(k), EXPIRY_MS);
}

export function getPending(userId: string, guildId: string): PendingGame | null {
  const k     = key(userId, guildId);
  const entry = store.get(k);
  if (!entry || Date.now() > entry.expiresAt) {
    store.delete(k);
    return null;
  }
  return entry;
}

export function removePending(userId: string, guildId: string): void {
  store.delete(key(userId, guildId));
}
