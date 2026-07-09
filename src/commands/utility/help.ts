/**
 * /help — sends a plain-English (A2-B1 level) .txt guide explaining every
 * command in the bot. Open to everyone — most people benefit from it, even
 * if most documented commands are staff/admin-only.
 *
 * The actual text lives in docs/commandGuideText.ts — update it there when
 * commands change (it's hand-written, not auto-generated, so it stays
 * simple and readable).
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from 'discord.js';
import { COMMAND_GUIDE_TEXT } from '../../docs/commandGuideText';
import { info } from '../../utils/embeds';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get a simple text guide explaining every bot command'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const file = new AttachmentBuilder(Buffer.from(COMMAND_GUIDE_TEXT.trim(), 'utf-8'), {
      name: 'multibotv2-command-guide.txt',
    });

    await interaction.reply({
      embeds: [info('📖 Command Guide', "Here's a simple guide to every command, in easy English.")],
      files: [file],
      ephemeral: true,
    });
  },
};
