/**
 * Runtime-Permission-Guards für Slash-Commands.
 *
 * setDefaultMemberPermissions() ist nur eine Discord-UI-Einschränkung —
 * sie verhindert nicht, dass die API direkt aufgerufen wird.
 * Diese Guards prüfen die Rechte serverseitig in der execute()-Methode.
 */

import {
  ChatInputCommandInteraction, PermissionResolvable, GuildMember, MessageFlags,
} from 'discord.js';
import { error } from './embeds';

export async function requirePermission(
  ix: ChatInputCommandInteraction,
  permission: PermissionResolvable,
  message = '❌ You do not have permission to use this command.',
): Promise<boolean> {
  const member = ix.member as GuildMember | null;
  if (!member?.permissions.has(permission)) {
    await ix.reply({
      embeds: [error('Keine Berechtigung', message)],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return false;
  }
  return true;
}

export async function requireAdmin(ix: ChatInputCommandInteraction): Promise<boolean> {
  return requirePermission(ix, 'ManageGuild', 'Dieser Befehl erfordert **Server verwalten**.');
}

export async function requireModerator(ix: ChatInputCommandInteraction): Promise<boolean> {
  return requirePermission(ix, 'ModerateMembers', 'Dieser Befehl erfordert **Mitglieder moderieren**.');
}
