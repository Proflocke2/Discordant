/**
 * /webhook — Discohook-ähnliches System
 *
 * Subcommands:
 *   save   <name> <url>       – Webhook-URL speichern
 *   remove <name>             – gespeicherten Webhook löschen
 *   list                      – alle gespeicherten Webhooks
 *   send   <webhook>          – Nachrichten-Builder öffnen
 *   json   <webhook>          – rohen JSON-Payload senden
 *   edit   <webhook> <link>   – bestehende Nachricht bearbeiten
 *   delete <webhook> <link>   – bestehende Nachricht löschen
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { requirePermission } from '../../utils/guards';
import { getGuild } from '../../database/db';
import { getLocalized, Language } from '../../utils/localization';
import { success, error, info } from '../../utils/embeds';
import {
  saveWebhook, getWebhook, listWebhooks, removeWebhook,
} from '../../services/webhookDB';
import {
  isValidWebhookUrl,
  parseMessageLink,
  sendWebhook,
  editWebhookMessage,
  deleteWebhookMessage,
} from '../../services/webhookService';
import { setSession, clearSession } from '../../services/webhookSession';

export default {
  data: new SlashCommandBuilder()
    .setName('webhook')
    .setDescription('Send and manage Discord webhook messages (like Discohook)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks)

    // ── save ────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('save')
      .setDescription('Save a webhook URL with a name for quick access')
      .addStringOption(o => o.setName('name').setDescription('Short name (e.g. "announcements")').setRequired(true))
      .addStringOption(o => o.setName('url').setDescription('Discord webhook URL').setRequired(true))
    )

    // ── remove ──────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove a saved webhook')
      .addStringOption(o => o.setName('name').setDescription('Name of the saved webhook').setRequired(true))
    )

    // ── list ────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('list')
      .setDescription('List all saved webhooks for this server')
    )

    // ── send ────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('send')
      .setDescription('Open the interactive message/embed builder and send via webhook')
      .addStringOption(o => o.setName('webhook').setDescription('Saved webhook name OR full webhook URL').setRequired(true))
    )

    // ── json ────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('json')
      .setDescription('Send a raw JSON payload directly (for advanced users)')
      .addStringOption(o => o.setName('webhook').setDescription('Saved webhook name OR full webhook URL').setRequired(true))
    )

    // ── edit ────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('edit')
      .setDescription('Edit an existing webhook message')
      .addStringOption(o => o.setName('webhook').setDescription('Saved webhook name OR full webhook URL').setRequired(true))
      .addStringOption(o => o.setName('message_link').setDescription('Discord message link (right-click → Copy Message Link)').setRequired(true))
    )

    // ── delete ──────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('delete')
      .setDescription('Delete an existing webhook message')
      .addStringOption(o => o.setName('webhook').setDescription('Saved webhook name OR full webhook URL').setRequired(true))
      .addStringOption(o => o.setName('message_link').setDescription('Discord message link').setRequired(true))
    ),

  // ──────────────────────────────────────────────────────────────────
  async execute(interaction: ChatInputCommandInteraction) {
    if (!await requirePermission(interaction, PermissionFlagsBits.ManageWebhooks)) return;
    const sub     = interaction.options.getSubcommand();
    const guild   = getGuild(interaction.guildId!);
    const lang    = (guild.language || 'en') as Language;
    const guildId = interaction.guildId!;
    const userId  = interaction.user.id;

    // ── Helper: Webhook-URL auflösen ─────────────────────────────────
    const resolveUrl = (input: string): string | null => {
      if (isValidWebhookUrl(input)) return input;
      const saved = getWebhook(guildId, input);
      return saved?.url ?? null;
    };

    // ════════════════════════════════════════════════════════════════
    // SAVE
    // ════════════════════════════════════════════════════════════════
    if (sub === 'save') {
      const name = interaction.options.getString('name', true);
      const url  = interaction.options.getString('url', true);

      if (!isValidWebhookUrl(url)) {
        return interaction.reply({
          embeds: [error(
            getLocalized('webhook.invalid_url', lang),
            getLocalized('webhook.invalid_url_desc', lang),
          )],
          ephemeral: true,
        });
      }

      saveWebhook(guildId, name, url);
      return interaction.reply({
        embeds: [success(
          getLocalized('webhook.saved', lang),
          getLocalized('webhook.saved_desc', lang, { name }),
        )],
        ephemeral: true,
      });
    }

    // ════════════════════════════════════════════════════════════════
    // REMOVE
    // ════════════════════════════════════════════════════════════════
    if (sub === 'remove') {
      const name = interaction.options.getString('name', true);
      removeWebhook(guildId, name);
      return interaction.reply({
        embeds: [success(getLocalized('webhook.removed', lang), `**${name}**`)],
        ephemeral: true,
      });
    }

    // ════════════════════════════════════════════════════════════════
    // LIST
    // ════════════════════════════════════════════════════════════════
    if (sub === 'list') {
      const hooks = listWebhooks(guildId);
      if (hooks.length === 0) {
        return interaction.reply({
          embeds: [info(
            getLocalized('webhook.list_empty', lang),
            getLocalized('webhook.list_empty_desc', lang),
          )],
          ephemeral: true,
        });
      }
      const lines = hooks.map(h => `\`${h.name}\` — ||${h.url.slice(0, 40)}...||`).join('\n');
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor('#5865f2')
          .setTitle(getLocalized('webhook.list_title', lang))
          .setDescription(lines)],
        ephemeral: true,
      });
    }

    // ════════════════════════════════════════════════════════════════
    // DELETE MESSAGE
    // ════════════════════════════════════════════════════════════════
    if (sub === 'delete') {
      const webhookInput = interaction.options.getString('webhook', true);
      const link         = interaction.options.getString('message_link', true);
      const webhookUrl   = resolveUrl(webhookInput);

      if (!webhookUrl) return interaction.reply({ embeds: [error(getLocalized('webhook.not_found', lang))], ephemeral: true });

      const parsed = parseMessageLink(link);
      if (!parsed)  return interaction.reply({ embeds: [error(getLocalized('webhook.bad_link', lang))], ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      const result = await deleteWebhookMessage(webhookUrl, parsed.messageId);

      return interaction.editReply({
        embeds: result.ok
          ? [success(getLocalized('webhook.deleted', lang))]
          : [error(getLocalized('webhook.error', lang), result.error)],
      });
    }

    // ════════════════════════════════════════════════════════════════
    // JSON
    // ════════════════════════════════════════════════════════════════
    if (sub === 'json') {
      const webhookInput = interaction.options.getString('webhook', true);
      const webhookUrl   = resolveUrl(webhookInput);
      if (!webhookUrl) return interaction.reply({ embeds: [error(getLocalized('webhook.not_found', lang))], ephemeral: true });

      // Session mit leerer Payload anlegen, dann JSON-Modal öffnen
      setSession(userId, guildId, { webhookUrl, payload: {} });
      return showJsonModal(interaction, userId, guildId, lang, 'send');
    }

    // ════════════════════════════════════════════════════════════════
    // EDIT
    // ════════════════════════════════════════════════════════════════
    if (sub === 'edit') {
      const webhookInput = interaction.options.getString('webhook', true);
      const link         = interaction.options.getString('message_link', true);
      const webhookUrl   = resolveUrl(webhookInput);

      if (!webhookUrl) return interaction.reply({ embeds: [error(getLocalized('webhook.not_found', lang))], ephemeral: true });

      const parsed = parseMessageLink(link);
      if (!parsed)  return interaction.reply({ embeds: [error(getLocalized('webhook.bad_link', lang))], ephemeral: true });

      setSession(userId, guildId, { webhookUrl, payload: {}, editMsgId: parsed.messageId });
      return showBuilderMenu(interaction, userId, guildId, lang);
    }

    // ════════════════════════════════════════════════════════════════
    // SEND — Interaktiver Builder
    // ════════════════════════════════════════════════════════════════
    if (sub === 'send') {
      const webhookInput = interaction.options.getString('webhook', true);
      const webhookUrl   = resolveUrl(webhookInput);
      if (!webhookUrl) return interaction.reply({ embeds: [error(getLocalized('webhook.not_found', lang))], ephemeral: true });

      setSession(userId, guildId, { webhookUrl, payload: { embeds: [{}] } });
      return showBuilderMenu(interaction, userId, guildId, lang);
    }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// BUILDER MENU — Hauptmenü mit Buttons
// ────────────────────────────────────────────────────────────────────────────

export async function showBuilderMenu(
  interaction: ChatInputCommandInteraction | any,
  userId: string,
  guildId: string,
  lang: Language,
  isUpdate = false,
): Promise<void> {
  const p = `wh_${userId}_${guildId}`;

  const embed = new EmbedBuilder()
    .setColor('#5865f2')
    .setTitle(getLocalized('webhook.builder_title', lang))
    .setDescription(getLocalized('webhook.builder_desc', lang))
    .setFooter({ text: getLocalized('webhook.builder_footer', lang) });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${p}_basic`).setLabel(getLocalized('webhook.btn_basic', lang)).setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${p}_author`).setLabel(getLocalized('webhook.btn_author', lang)).setEmoji('👤').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${p}_images`).setLabel(getLocalized('webhook.btn_images', lang)).setEmoji('🖼️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${p}_footer`).setLabel(getLocalized('webhook.btn_footer', lang)).setEmoji('📄').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${p}_field`).setLabel(getLocalized('webhook.btn_field', lang)).setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${p}_sender`).setLabel(getLocalized('webhook.btn_sender', lang)).setEmoji('🤖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${p}_json_edit`).setLabel('JSON').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${p}_preview`).setLabel(getLocalized('webhook.btn_preview', lang)).setEmoji('👁️').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${p}_send_now`).setLabel(getLocalized('webhook.btn_send', lang)).setEmoji('🚀').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${p}_cancel`).setLabel(getLocalized('webhook.btn_cancel', lang)).setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [embed], components: [row1, row2, row3], ephemeral: true };

  if (isUpdate && interaction.update) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// JSON MODAL
// ────────────────────────────────────────────────────────────────────────────

export async function showJsonModal(
  interaction: any,
  userId: string,
  guildId: string,
  lang: Language,
  mode: 'send' | 'edit',
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`wh_json_${mode}_${userId}_${guildId}`)
    .setTitle(mode === 'edit' ? getLocalized('webhook.json_modal_edit', lang) : getLocalized('webhook.json_modal_send', lang));

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('json_payload')
        .setLabel(getLocalized('webhook.json_label', lang))
        .setPlaceholder('{ "content": "Hello!", "embeds": [{ "title": "..." }] }')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}
