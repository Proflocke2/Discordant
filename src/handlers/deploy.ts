import { REST, Routes, SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import { readdirSync } from 'fs';
import path from 'path';
import { Command } from '../utils/types';
import {
  COMMAND_DESC_LOCALIZATIONS,
  COMMAND_NAME_LOCALIZATIONS,
} from '../i18n/commandDescriptions';

/**
 * Applies Discord locale-aware description (and optionally name) localizations
 * to a SlashCommandBuilder before it is serialized and uploaded.
 *
 * This is what makes command descriptions appear in the user's own language
 * inside the Discord client — completely independent of the server language.
 */
function applyLocalizations(
  builder: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder,
): void {
  const name = builder.name;

  const descLocs = COMMAND_DESC_LOCALIZATIONS[name];
  if (descLocs && Object.keys(descLocs).length > 0) {
    (builder as SlashCommandBuilder).setDescriptionLocalizations(descLocs);
  }

  const nameLocs = COMMAND_NAME_LOCALIZATIONS[name];
  if (nameLocs && Object.keys(nameLocs).length > 0) {
    (builder as SlashCommandBuilder).setNameLocalizations(nameLocs);
  }
}

export async function deployCommands(token: string, clientId: string) {
  const cmdsByName = new Map<string, unknown>();
  const cmdDir = path.join(__dirname, '../commands');

  let localized = 0;
  let duplicatesSkipped = 0;

  for (const folder of readdirSync(cmdDir)) {
    const files = readdirSync(path.join(cmdDir, folder)).filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'));
    for (const file of files) {
      const cmd = require(path.join(cmdDir, folder, file)) as { default: Command };
      if (cmd.default?.data) {
        const builder = cmd.default.data as SlashCommandBuilder;
        applyLocalizations(builder);
        if (COMMAND_DESC_LOCALIZATIONS[builder.name]) localized++;

        // Defensive dedupe: two command files must never produce the same
        // top-level name. Bulk-registering duplicate names causes Discord
        // to reject the whole PUT (or silently show the command twice in
        // the client). Last one found wins; the collision is logged loudly
        // so it gets fixed at the source instead of hidden.
        if (cmdsByName.has(builder.name)) {
          duplicatesSkipped++;
          console.warn(`[Deploy] WARNING: duplicate command name "${builder.name}" in ${file} — overwriting previous definition.`);
        }
        cmdsByName.set(builder.name, builder.toJSON());
      }
    }
  }

  const cmds = Array.from(cmdsByName.values());

  console.log(`[Deploy] Applied localizations to ${localized} commands (de/fr/ru)`);
  if (duplicatesSkipped > 0) {
    console.warn(`[Deploy] ${duplicatesSkipped} duplicate command name(s) detected and collapsed — check the warnings above.`);
  }

  const rest = new REST().setToken(token);

  // Multi-server: register the exact same command set on EVERY guild the
  // bot is currently a member of — instead of only the single GUILD_ID
  // server. Guild-scoped commands still propagate instantly (vs ~1h for
  // global), so this keeps that speed while covering all servers, including
  // ones the bot joins later (this runs automatically on every boot, plus
  // manually via /deploy).
  let guilds: { id: string }[] = [];
  try {
    guilds = await rest.get(Routes.userGuilds()) as { id: string }[];
  } catch (err) {
    console.error('[Deploy] Could not fetch guild list — falling back to global deploy:', err instanceof Error ? err.message : err);
    await rest.put(Routes.applicationCommands(clientId), { body: cmds });
    console.log(`[Deploy] Registered ${cmds.length} slash commands globally (may take ~1h)`);
    return;
  }

  let ok = 0;
  for (const g of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, g.id), { body: cmds });
      ok++;
    } catch (err) {
      console.error(`[Deploy] Failed to register commands in guild ${g.id}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[Deploy] Registered ${cmds.length} slash commands to ${ok}/${guilds.length} guild(s) (instant)`);

  // Clear any stray GLOBAL commands from an earlier global-deploy era.
  // Without this, old global registrations keep living forever alongside
  // the per-guild ones — every command appears twice in Discord, and
  // clicking the orphaned copy times out ("app did not respond") because
  // it no longer matches anything in client.commands.
  try {
    const existingGlobal = await rest.get(Routes.applicationCommands(clientId)) as unknown[];
    if (existingGlobal.length > 0) {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      console.log(`[Deploy] Cleared ${existingGlobal.length} stray global command(s) to prevent duplicates.`);
    }
  } catch (err) {
    console.warn('[Deploy] Could not check/clear global commands (non-fatal):', err instanceof Error ? err.message : err);
  }
}
