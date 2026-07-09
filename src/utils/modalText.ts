/**
 * modalText — Hilfsfunktion für Freitext-Eingaben via Discord-Modals.
 *
 * Slash-Command String-Options strippen echte Zeilenumbrüche komplett.
 * Discord-Modal TextInputs (TextInputStyle.Paragraph) behalten echte \n.
 *
 * Verwendung:
 *   const text = await promptText(ix, { title: 'Nachricht', label: 'Willkommens-Nachricht', placeholder: '{user} willkommen!', current: existingMsg });
 *   if (text === null) return; // abgebrochen / Timeout
 */

import {
  ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
} from 'discord.js';

export interface PromptTextOptions {
  /** Modal-Titel (max 45 Zeichen) */
  title: string;
  /** Input-Label (max 45 Zeichen) */
  label: string;
  /** Platzhalter-Text (max 100 Zeichen) */
  placeholder?: string;
  /** Vorausgefüllter Wert (aktueller Inhalt beim Bearbeiten) */
  current?: string | null;
  /** Minimum Zeichenanzahl (default: 0) */
  minLength?: number;
  /** Maximum Zeichenanzahl (default: 2000) */
  maxLength?: number;
  /** Pflichtfeld? (default: false) */
  required?: boolean;
  /** Timeout in ms (default: 5 Minuten) */
  timeout?: number;
}

/**
 * Öffnet ein Modal mit einem Paragraph-Textfeld und wartet auf Antwort.
 * Gibt den eingegebenen Text zurück, oder null bei Timeout.
 *
 * WICHTIG: ix darf noch nicht beantwortet sein (kein deferReply vorher).
 * Oder: verwende promptTextFromButton wenn die Interaction schon geantwortet hat.
 */
export async function promptText(
  ix: ChatInputCommandInteraction,
  opts: PromptTextOptions,
): Promise<{ text: string; modal: ModalSubmitInteraction } | null> {
  const customId = `modaltext:${ix.id}`;

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(opts.title.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel(opts.label.slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder((opts.placeholder ?? '').slice(0, 100))
          .setRequired(opts.required ?? false)
          .setMinLength(opts.minLength ?? 0)
          .setMaxLength(opts.maxLength ?? 2000)
          .setValue(opts.current?.slice(0, opts.maxLength ?? 2000) ?? ''),
      ),
    );

  await ix.showModal(modal);

  try {
    const submit = await ix.awaitModalSubmit({
      filter: (i) => i.customId === customId && i.user.id === ix.user.id,
      time:   opts.timeout ?? 5 * 60 * 1000,
    });
    const text = submit.fields.getTextInputValue('text');
    return { text, modal: submit };
  } catch {
    return null; // Timeout
  }
}
