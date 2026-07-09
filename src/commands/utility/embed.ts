import { isSafeImageUrl } from '../../utils/validators';
/**
 * /embed — Sendet ein custom Embed via Modal
 *
 * Da Discord bei Slash-Command-Optionen alle Zeilenumbrüche entfernt,
 * öffnet dieser Command ein Modal (Popup). Dort kann man
 * Titel, Description (mehrzeilig!), Farbe und Footer eingeben.
 *
 * Syntax in der Description:
 *   Normale Zeilenumbrüche funktionieren direkt.
 *   \n  wird ebenfalls als Zeilenumbruch interpretiert.
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  TextChannel,
} from 'discord.js';
import { getGuild } from '../../database/db';
import { getLocalized, Language } from '../../utils/localization';
import { error } from '../../utils/embeds';

// ── Modal-ID ─────────────────────────────────────────────────────────────────
// Format: embed_modal_{userId}_{channelId}
// channelId wird mitgegeben damit der Handler weiß wohin er senden soll.

export function isEmbedModal(customId: string): boolean {
  return customId.startsWith('embed_modal_');
}

export async function handleEmbedModal(modal: ModalSubmitInteraction): Promise<void> {
  const parts     = modal.customId.split('_');
  // embed_modal_{userId}_{channelId}
  const channelId = parts[parts.length - 1];

  const guild = getGuild(modal.guildId!);
  const lang  = (guild.language || 'en') as Language;

  const title   = modal.fields.getTextInputValue('embed_title').trim();        // metadata — trim OK
  const rawDesc = modal.fields.getTextInputValue('embed_description');          // user content — NO trim ever
  const color   = modal.fields.getTextInputValue('embed_color').trim() || '#5865f2'; // hex — trim OK
  const footer  = modal.fields.getTextInputValue('embed_footer').trim();       // metadata — trim OK

  // Modal inputs preserve real newlines natively. This only catches literal \n typed as escape sequence.
  const description = rawDesc.replace(/\\n/g, '\n');

  // Farb-Validierung
  const colorValid = /^#[0-9a-fA-F]{6}$/.test(color) || /^[0-9a-fA-F]{6}$/.test(color);
  if (!colorValid) {
    return void modal.reply({
      embeds: [error(
        getLocalized('common.error', lang),
        getLocalized('utility.embed.invalid_color', lang),
      )],
      ephemeral: true,
    });
  }

  const hex = color.startsWith('#') ? color : `#${color}`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(hex as any)
    .setTimestamp();

  if (footer) embed.setFooter({ text: footer });

  const image = (modal as any).__imageUrl as string | undefined;
  if (image) embed.setImage(image);

  const channel = modal.client.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) {
    return void modal.reply({
      embeds: [error(getLocalized('common.error', lang), 'Channel not found.')],
      ephemeral: true,
    });
  }

  await channel.send({ embeds: [embed] });
  await modal.reply({
    content: getLocalized('utility.embed.sent', lang, { channel: `<#${channelId}>` }),
    ephemeral: true,
  });
}

// ── Command ───────────────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Create and send a custom embed with full formatting support')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Target channel (default: current channel)')
    )
    .addStringOption(o =>
      o.setName('image')
        .setDescription('Image URL to attach to the embed')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const ch = (interaction.options.getChannel('channel') as TextChannel | null)
      ?? interaction.channel as TextChannel;
    const image    = interaction.options.getString('image') ?? '';
    const guild    = getGuild(interaction.guildId!);
    const lang     = (guild.language || 'en') as Language;
    const modalId  = `embed_modal_${interaction.user.id}_${ch.id}`;

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(getLocalized('utility.embed.modal_title', lang));

    const titleInput = new TextInputBuilder()
      .setCustomId('embed_title')
      .setLabel(getLocalized('utility.embed.field_title', lang))
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(true);

    const descInput = new TextInputBuilder()
      .setCustomId('embed_description')
      .setLabel(getLocalized('utility.embed.field_desc', lang))
      .setPlaceholder(getLocalized('utility.embed.desc_placeholder', lang))
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setRequired(true);

    const colorInput = new TextInputBuilder()
      .setCustomId('embed_color')
      .setLabel(getLocalized('utility.embed.field_color', lang))
      .setPlaceholder('#5865f2')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(7)
      .setRequired(false);

    const footerInput = new TextInputBuilder()
      .setCustomId('embed_footer')
      .setLabel(getLocalized('utility.embed.field_footer', lang))
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2048)
      .setRequired(false);

    // Modals unterstützen max. 5 Rows à 1 TextInput
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(footerInput),
    );

    // Image-URL als Marker im customId anhängen (da kein State möglich)
    // Wir speichern sie temporär im pendingImages-Store
    if (image && !isSafeImageUrl(image)) {
      return interaction.reply({
        embeds: [error('Invalid URL', 'Only HTTPS image links (png, jpg, gif, webp) are allowed.')],
        ephemeral: true,
      });
    }
    if (image) {
      pendingImages.set(modalId, image);
      setTimeout(() => pendingImages.delete(modalId), 10 * 60 * 1000); // 10min TTL
    }

    await interaction.showModal(modal);
  },
};

// Kleiner In-Memory Store für Image-URLs zwischen Command und Modal-Submit
const pendingImages = new Map<string, string>();

export function popPendingImage(modalId: string): string | undefined {
  const url = pendingImages.get(modalId);
  pendingImages.delete(modalId);
  return url;
}
