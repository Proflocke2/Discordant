/**
 * /enable — re-activates a command previously turned off with /disable.
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { enableCommand, isCommandDisabled, listDisabledCommands } from '../../database/db';
import { success, error } from '../../utils/embeds';
import { MODULE_HOOKS } from '../../utils/moduleHooks';

export default {
  data: new SlashCommandBuilder()
    .setName('enable')
    .setDescription('Re-activate a previously disabled command')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('command')
        .setDescription('The command to enable')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction: AutocompleteInteraction) {
    const guildId = interaction.guildId;
    const focused = interaction.options.getFocused().toLowerCase();
    if (!guildId) return interaction.respond([]).catch(() => {});

    const choices = listDisabledCommands(guildId)
      .filter(name => name.includes(focused))
      .slice(0, 25)
      .map(name => ({ name: `/${name}`, value: name }));

    await interaction.respond(choices).catch(() => {});
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const name    = interaction.options.getString('command', true).toLowerCase().trim();
    const guildId = interaction.guildId!;

    if (!isCommandDisabled(guildId, name)) {
      await interaction.reply({
        embeds: [error('Not disabled', `\`/${name}\` is not currently disabled.`)],
        ephemeral: true,
      });
      return;
    }

    enableCommand(guildId, name);

    const hook = MODULE_HOOKS[name];
    if (hook) {
      try {
        hook.onEnable(guildId);
      } catch (err) {
        console.error(`[Enable] module hook failed for "${name}":`, err);
      }
    }

    const extra = hook ? ' The underlying system has been turned back on too.' : '';

    await interaction.reply({
      embeds: [success('Command enabled', `\`/${name}\` can be used again.${extra}`)],
      ephemeral: true,
    });
  },
};
