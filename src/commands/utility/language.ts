import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { setGuildValue, getGuild } from '../../database/db';
import {
  getLocalized,
  getLanguageName,
  getSupportedLanguages,
  Language,
  isValidLanguage,
} from '../../utils/localization';
import { StatsService } from '../../stats/StatsService';
import { getStatsConfig } from '../../stats/StatsDB';
import { LanguageReloadService } from '../../services/languageReloadService';

export default {
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('Set or view the bot language for this server')
    .addSubcommand((s) =>
      s.setName('set').setDescription('Change the server language')
        .addStringOption((o) =>
          o.setName('lang').setDescription('Select a language').setRequired(true)
            .addChoices(
              { name: 'English', value: 'en' },
              { name: 'Deutsch', value: 'de' },
              { name: 'Français', value: 'fr' },
              { name: 'Русский', value: 'ru' }
            )
        )
    )
    .addSubcommand((s) =>
      s.setName('view').setDescription('View the current server language')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub             = interaction.options.getSubcommand();
    const guild           = getGuild(interaction.guildId!);
    const currentLanguage = (guild.language || 'en') as Language;

    // ── SET ─────────────────────────────────────────────────────────────────
    if (sub === 'set') {
      const newLanguage = interaction.options.getString('lang') as Language;

      if (!isValidLanguage(newLanguage)) {
        return interaction.reply({ content: getLocalized('common.error', currentLanguage), ephemeral: true });
      }

      // Sprache in DB speichern
      setGuildValue(interaction.guildId!, 'language', newLanguage);

      const langName    = getLanguageName(newLanguage);
      const statsConfig = getStatsConfig(interaction.guildId!);
      const hasStats    = statsConfig.channels.length > 0;

      const embed = new EmbedBuilder()
        .setTitle(getLocalized('language.set', newLanguage))
        .setDescription(getLocalized('language.changed', newLanguage, { language: langName }))
        .setColor('#5865f2')
        .setTimestamp();

      if (hasStats) {
        embed.addFields({
          name:  getLocalized('stats.reload', newLanguage),
          value: getLocalized('language.reload_hint', newLanguage),
        });
      }

      await interaction.reply({ embeds: [embed] });

      // Alle persistenten Nachrichten im Hintergrund aktualisieren
      if (interaction.guild) {
        LanguageReloadService.reloadAll(interaction.client, interaction.guildId!).catch(() => {});
      }
    }

    // ── VIEW ─────────────────────────────────────────────────────────────────
    if (sub === 'view') {
      const langName = getLanguageName(currentLanguage);
      const embed = new EmbedBuilder()
        .setTitle('🌍 Language Settings')
        .setDescription(getLocalized('language.current', currentLanguage, { language: langName }))
        .addFields({
          name:  'Available Languages',
          value: getSupportedLanguages().map((l) => `• ${getLanguageName(l)} (\`${l}\`)`).join('\n'),
        })
        .setColor('#5865f2')
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
};
