/**
 * WEBHOOK HANDLER
 * Verarbeitet alle wh_* Buttons und wh_* Modals.
 *
 * Button customId: wh_{userId}_{guildId}_{action}
 * Modal customId:  wh_{section}_{mode}_{userId}_{guildId}
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js';
import { getGuild } from '../database/db';
import { getLocalized, Language } from '../utils/localization';
import { success, error, info } from '../utils/embeds';
import {
  getSession, setSession, updateSession,
  patchEmbed, clearSession, WebhookSession,
} from '../services/webhookSession';
import {
  sendWebhook, editWebhookMessage, hexToDecimal, WebhookEmbed,
} from '../services/webhookService';
import { showBuilderMenu, showJsonModal } from '../commands/utility/webhook';
// ── URL safety helper ─────────────────────────────────────────────────────────
function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}



// ────────────────────────────────────────────────────────────────────────────
// ROUTING
// ────────────────────────────────────────────────────────────────────────────

export function isWebhookButton(id: string): boolean {
  return id.startsWith('wh_') && !id.startsWith('wh_json');
}

export function isWebhookModal(id: string): boolean {
  return id.startsWith('wh_');
}

export async function handleWebhookButton(btn: ButtonInteraction): Promise<void> {
  // customId: wh_{userId}_{guildId}_{action}
  const parts   = btn.customId.split('_');
  const userId  = parts[1];
  const guildId = parts[2];
  const action  = parts.slice(3).join('_');
  const guild   = getGuild(guildId);
  const lang    = (guild.language || 'en') as Language;

  if (btn.user.id !== userId) {
    return void btn.reply({ embeds: [error(getLocalized('common.no_permission', lang))], ephemeral: true });
  }

  const session = getSession(userId, guildId);

  switch (action) {
    case 'basic':     return showSectionModal(btn, userId, guildId, lang, 'basic');
    case 'author':    return showSectionModal(btn, userId, guildId, lang, 'author');
    case 'images':    return showSectionModal(btn, userId, guildId, lang, 'images');
    case 'footer':    return showSectionModal(btn, userId, guildId, lang, 'footer');
    case 'field':     return showSectionModal(btn, userId, guildId, lang, 'field');
    case 'sender':    return showSectionModal(btn, userId, guildId, lang, 'sender');
    case 'json_edit': return showJsonModal(btn, userId, guildId, lang, session?.editMsgId ? 'edit' : 'send');
    case 'preview':   return handlePreview(btn, userId, guildId, lang, session);
    case 'send_now':  return handleSendNow(btn, userId, guildId, lang, session);
    case 'cancel':    return handleCancel(btn, userId, guildId, lang);
  }
}

export async function handleWebhookModal(modal: ModalSubmitInteraction): Promise<void> {
  // Modal customId: wh_{section}_{mode}_{userId}_{guildId}
  // z.B.: wh_basic_edit_123_456, wh_json_send_123_456
  const parts   = modal.customId.split('_');
  // parts[0] = 'wh'
  const section = parts[1];            // basic | author | images | footer | field | sender | json
  const mode    = parts[2];            // open | edit | send
  const userId  = parts[3];
  const guildId = parts[4];
  const guild   = getGuild(guildId);
  const lang    = (guild.language || 'en') as Language;

  if (section === 'json') return handleJsonModal(modal, userId, guildId, lang, mode as 'send' | 'edit');
  return handleSectionModal(modal, section, userId, guildId, lang);
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION MODALS — öffnen
// ────────────────────────────────────────────────────────────────────────────

async function showSectionModal(
  btn: ButtonInteraction,
  userId: string,
  guildId: string,
  lang: Language,
  section: string,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`wh_${section}_open_${userId}_${guildId}`)
    .setTitle(getSectionTitle(section, lang));

  const rows = buildSectionInputs(section, lang);
  modal.addComponents(...rows);
  await btn.showModal(modal);
}

function getSectionTitle(section: string, lang: Language): string {
  const map: Record<string, string> = {
    basic:  'webhook.section_basic',
    author: 'webhook.section_author',
    images: 'webhook.section_images',
    footer: 'webhook.section_footer',
    field:  'webhook.section_field',
    sender: 'webhook.section_sender',
  };
  return getLocalized(map[section] ?? 'webhook.builder_title', lang);
}

function buildSectionInputs(section: string, lang: Language): ActionRowBuilder<TextInputBuilder>[] {
  const row = (id: string, label: string, style: TextInputStyle, ph?: string, req = false, max?: number) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setPlaceholder(ph ?? '')
        .setRequired(req)
        .setMaxLength(max ?? 1024),
    );

  switch (section) {
    case 'basic': return [
      row('title',       getLocalized('webhook.input_title', lang),       TextInputStyle.Short,     'My Announcement', false, 256),
      row('description', getLocalized('webhook.input_desc', lang),        TextInputStyle.Paragraph, 'Hello everyone!\nLine 2\nLine 3', false, 4000),
      row('color',       getLocalized('webhook.input_color', lang),       TextInputStyle.Short,     '#5865f2', false, 7),
      row('title_url',   getLocalized('webhook.input_title_url', lang),   TextInputStyle.Short,     'https://...', false, 512),
      row('timestamp',   getLocalized('webhook.input_timestamp', lang),   TextInputStyle.Short,     'now   OR   2025-12-31T20:00:00Z', false, 30),
    ];
    case 'author': return [
      row('author_name',     getLocalized('webhook.input_author_name', lang),     TextInputStyle.Short,     'Author Name', false, 256),
      row('author_url',      getLocalized('webhook.input_author_url', lang),      TextInputStyle.Short,     'https://...', false, 512),
      row('author_icon_url', getLocalized('webhook.input_author_icon', lang),     TextInputStyle.Short,     'https://...', false, 512),
    ];
    case 'images': return [
      row('thumbnail', getLocalized('webhook.input_thumbnail', lang), TextInputStyle.Short, 'https://...', false, 512),
      row('image',     getLocalized('webhook.input_image', lang),     TextInputStyle.Short, 'https://...', false, 512),
    ];
    case 'footer': return [
      row('footer_text',     getLocalized('webhook.input_footer_text', lang),     TextInputStyle.Short,     'Footer text', false, 2048),
      row('footer_icon_url', getLocalized('webhook.input_footer_icon', lang),     TextInputStyle.Short,     'https://...', false, 512),
    ];
    case 'field': return [
      row('field_name',   getLocalized('webhook.input_field_name', lang),   TextInputStyle.Short,     'Field Title', true, 256),
      row('field_value',  getLocalized('webhook.input_field_value', lang),  TextInputStyle.Paragraph, 'Field content...', true, 1024),
      row('field_inline', getLocalized('webhook.input_field_inline', lang), TextInputStyle.Short,     'yes / no', false, 3),
    ];
    case 'sender': return [
      row('sender_name',   getLocalized('webhook.input_sender_name', lang),   TextInputStyle.Short, 'Bot Name', false, 80),
      row('sender_avatar', getLocalized('webhook.input_sender_avatar', lang), TextInputStyle.Short, 'https://...', false, 512),
    ];
    default: return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION MODALS — verarbeiten
// ────────────────────────────────────────────────────────────────────────────

async function handleSectionModal(
  modal: ModalSubmitInteraction,
  section: string,
  userId: string,
  guildId: string,
  lang: Language,
): Promise<void> {
  const get = (id: string) => { try { return modal.fields.getTextInputValue(id).trim(); } catch { return ''; } };
  const session = getSession(userId, guildId);

  if (!session) {
    return void modal.reply({ embeds: [error(getLocalized('webhook.session_expired', lang))], ephemeral: true });
  }

  const embed: Partial<WebhookEmbed> = { ...(session.payload.embeds?.[0] ?? {}) };

  switch (section) {
    case 'basic': {
      const title       = get('title');
      const description = get('description').replace(/\\n/g, '\n');
      const color       = get('color');
      const titleUrl    = get('title_url');
      const timestamp   = get('timestamp');

      if (title)       embed.title       = title;
      if (description) embed.description = description;
      if (isSafeUrl(titleUrl))    embed.url         = titleUrl;
      if (color && /^#?[0-9a-fA-F]{6}$/.test(color))
        embed.color = hexToDecimal(color.replace('#', ''));
      if (timestamp)
        embed.timestamp = timestamp.toLowerCase() === 'now'
          ? new Date().toISOString()
          : timestamp;
      break;
    }
    case 'author': {
      const name = get('author_name');
      if (name) embed.author = {
        name,
        url:      isSafeUrl(get('author_url'))      ? get('author_url') : undefined,
        icon_url: get('author_icon_url') || undefined,
      };
      break;
    }
    case 'images': {
      const thumb = get('thumbnail');
      const img   = get('image');
      if (isSafeUrl(thumb)) embed.thumbnail = { url: thumb! };
      if (isSafeUrl(img))   embed.image     = { url: img! };
      break;
    }
    case 'footer': {
      const text = get('footer_text');
      if (text) embed.footer = {
        text,
        icon_url: isSafeUrl(get('footer_icon_url')) ? get('footer_icon_url') : undefined,
      };
      break;
    }
    case 'field': {
      const name    = get('field_name');
      const value   = get('field_value').replace(/\\n/g, '\n');
      const inlineS = get('field_inline').toLowerCase();
      const inline  = inlineS === 'yes' || inlineS === 'ja' || inlineS === 'oui' || inlineS === 'да';
      if (name && value) {
        embed.fields = [...(embed.fields ?? []), { name, value, inline }];
      }
      break;
    }
    case 'sender': {
      const name   = get('sender_name');
      const avatar = get('sender_avatar');
      updateSession(userId, guildId, {
        payload: {
          ...session.payload,
          embeds: [embed as WebhookEmbed],
          username:   name   || session.payload.username,
          avatar_url: avatar || session.payload.avatar_url,
        },
      });
      await modal.reply({ content: getLocalized('webhook.section_saved', lang), ephemeral: true });
      return;
    }
  }

  patchEmbed(userId, guildId, embed as Partial<WebhookEmbed>);
  await modal.reply({ content: getLocalized('webhook.section_saved', lang), ephemeral: true });
}

// ────────────────────────────────────────────────────────────────────────────
// JSON MODAL — verarbeiten
// ────────────────────────────────────────────────────────────────────────────

async function handleJsonModal(
  modal: ModalSubmitInteraction,
  userId: string,
  guildId: string,
  lang: Language,
  mode: 'send' | 'edit',
): Promise<void> {
  const raw = modal.fields.getTextInputValue('json_payload');
  const session = getSession(userId, guildId);

  if (!session) {
    return void modal.reply({ embeds: [error(getLocalized('webhook.session_expired', lang))], ephemeral: true });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void modal.reply({
      embeds: [error(getLocalized('webhook.json_invalid', lang), getLocalized('webhook.json_invalid_desc', lang))],
      ephemeral: true,
    });
  }

  await modal.deferReply({ ephemeral: true });

  let result;
  if (mode === 'edit' && session.editMsgId) {
    result = await editWebhookMessage(session.webhookUrl, session.editMsgId, parsed);
  } else {
    result = await sendWebhook(session.webhookUrl, parsed);
  }

  clearSession(userId, guildId);

  return void modal.editReply({
    embeds: result.ok
      ? [success(
          mode === 'edit' ? getLocalized('webhook.edited', lang) : getLocalized('webhook.sent', lang),
          result.messageId ? `Message ID: \`${result.messageId}\`` : undefined,
        )]
      : [error(getLocalized('webhook.error', lang), result.error)],
  });
}

// ────────────────────────────────────────────────────────────────────────────
// PREVIEW
// ────────────────────────────────────────────────────────────────────────────

async function handlePreview(
  btn: ButtonInteraction,
  userId: string,
  guildId: string,
  lang: Language,
  session: WebhookSession | null,
): Promise<void> {
  if (!session) {
    return void btn.reply({ embeds: [error(getLocalized('webhook.session_expired', lang))], ephemeral: true });
  }

  const raw = session.payload.embeds?.[0] ?? {};
  const preview = new EmbedBuilder();

  if (raw.title)       preview.setTitle(raw.title);
  if (raw.description) preview.setDescription(raw.description);
  if (raw.color)       preview.setColor(raw.color as any);
  if (raw.url)         preview.setURL(raw.url);
  if (raw.timestamp)   preview.setTimestamp(new Date(raw.timestamp));
  if (raw.thumbnail)   preview.setThumbnail(raw.thumbnail.url);
  if (raw.image)       preview.setImage(raw.image.url);
  if (raw.author)      preview.setAuthor({ name: raw.author.name, url: raw.author.url, iconURL: raw.author.icon_url });
  if (raw.footer)      preview.setFooter({ text: raw.footer.text, iconURL: raw.footer.icon_url });
  if (raw.fields)      preview.addFields(raw.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })));

  await btn.reply({
    content: `**${getLocalized('webhook.preview_label', lang)}**\n${getLocalized('webhook.preview_hint', lang)}`,
    embeds: [preview],
    ephemeral: true,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// SEND NOW
// ────────────────────────────────────────────────────────────────────────────

async function handleSendNow(
  btn: ButtonInteraction,
  userId: string,
  guildId: string,
  lang: Language,
  session: WebhookSession | null,
): Promise<void> {
  if (!session) {
    return void btn.reply({ embeds: [error(getLocalized('webhook.session_expired', lang))], ephemeral: true });
  }

  await btn.deferUpdate();

  let result;
  if (session.editMsgId) {
    result = await editWebhookMessage(session.webhookUrl, session.editMsgId, session.payload);
  } else {
    result = await sendWebhook(session.webhookUrl, session.payload);
  }

  clearSession(userId, guildId);

  const embed = new EmbedBuilder()
    .setColor(result.ok ? '#57f287' : '#ed4245')
    .setTitle(result.ok
      ? (session.editMsgId ? getLocalized('webhook.edited', lang) : getLocalized('webhook.sent', lang))
      : getLocalized('webhook.error', lang))
    .setDescription(result.ok
      ? (result.messageId ? `Message ID: \`${result.messageId}\`` : '✅')
      : result.error ?? 'Unknown error')
    .setTimestamp();

  await btn.editReply({ embeds: [embed], components: [] });
}

// ────────────────────────────────────────────────────────────────────────────
// CANCEL
// ────────────────────────────────────────────────────────────────────────────

async function handleCancel(
  btn: ButtonInteraction,
  userId: string,
  guildId: string,
  lang: Language,
): Promise<void> {
  clearSession(userId, guildId);
  await btn.update({
    embeds: [info(getLocalized('webhook.cancelled', lang), getLocalized('webhook.cancelled_desc', lang))],
    components: [],
  });
}
