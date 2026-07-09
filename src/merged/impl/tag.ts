/**
 * /tag — Ticket tag management and usage.
 *
 * Tags are saved response snippets that can be quickly sent in ticket channels.
 * They can also be aliased to custom /tag use <name> calls for staff efficiency.
 *
 * Subcommands:
 *   create  – Create a new tag
 *   edit    – Edit an existing tag's content
 *   delete  – Delete a tag
 *   list    – List all tags in this guild
 *   info    – View a specific tag's content
 *   use     – Send a tag's content in the current channel
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  AutocompleteInteraction,
} from 'discord.js';
import { success, error, info } from '../../utils/embeds';
import { promptText } from '../../utils/modalText';
import * as Repo from '../../modules/tickets/repository';

const MAX_TAG_NAME    = 32;
const MAX_TAG_CONTENT = 2000;

export default {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Manage and use ticket tags (saved responses)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)

    // /tag create
    .addSubcommand(s =>
      s.setName('create')
        .setDescription('Create a new tag (saved response)')
        .addStringOption(o =>
          o.setName('name')
            .setDescription(`Tag name / command alias (max ${MAX_TAG_NAME} chars, no spaces)`)
            .setRequired(true)
            .setMaxLength(MAX_TAG_NAME),
        )
    )

    // /tag edit
    .addSubcommand(s =>
      s.setName('edit')
        .setDescription('Edit an existing tag\'s content')
        .addStringOption(o =>
          o.setName('name')
            .setDescription('Tag name to edit')
            .setRequired(true)
            .setAutocomplete(true),
        )
    )

    // /tag delete
    .addSubcommand(s =>
      s.setName('delete')
        .setDescription('Delete a tag permanently')
        .addStringOption(o =>
          o.setName('name')
            .setDescription('Tag name to delete')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )

    // /tag list
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List all tags in this guild'),
    )

    // /tag info
    .addSubcommand(s =>
      s.setName('info')
        .setDescription('View a specific tag\'s full content')
        .addStringOption(o =>
          o.setName('name')
            .setDescription('Tag name')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )

    // /tag use
    .addSubcommand(s =>
      s.setName('use')
        .setDescription('Send a tag\'s content in the current channel')
        .addStringOption(o =>
          o.setName('name')
            .setDescription('Tag name to send')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addUserOption(o =>
          o.setName('mention')
            .setDescription('Optionally mention a user alongside the tag (e.g. the ticket opener)'),
        ),
    ),

  async autocomplete(ix: AutocompleteInteraction) {
    const focused = ix.options.getFocused();
    const tags    = Repo.searchTags(ix.guildId!, focused);
    await ix.respond(tags.map(t => ({ name: t.name, value: t.name })));
  },

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const rawName = ix.options.getString('name', true).trim().toLowerCase().replace(/\s+/g, '-');

      if (!/^[a-z0-9_-]+$/.test(rawName)) {
        return ix.reply({
          embeds: [error('Invalid tag name', 'Tag names may only contain letters, numbers, hyphens, and underscores.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Modal: Paragraph-Input behält echte Zeilenumbrüche
      const result = await promptText(ix, {
        title:       `Create Tag: ${rawName}`,
        label:       'Tag content (markdown + line breaks supported)',
        placeholder: 'Write the tag content here...\n\nLine breaks work!',
        maxLength:   MAX_TAG_CONTENT,
        required:    true,
      });
      if (result === null) return;

      const content = result.text;
      const tag = Repo.createTag({ guild_id: gid, name: rawName, content, created_by: ix.user.id });
      if (!tag) {
        return result.modal.reply({
          embeds: [error('Tag already exists', `A tag named \`${rawName}\` already exists. Use \`/tag edit\` to update it.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      return result.modal.reply({
        embeds: [success(
          `Tag \`${rawName}\` Created`,
          `Staff can now use \`/tag use ${rawName}\` to send this response in any ticket channel.\n\n**Preview:**\n${content.slice(0, 500)}${content.length > 500 ? '…' : ''}`,
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── EDIT ─────────────────────────────────────────────────────────────────
    if (sub === 'edit') {
      const name = ix.options.getString('name', true).toLowerCase();
      const existing = Repo.getTag(gid, name);
      if (!existing) {
        return ix.reply({
          embeds: [error(`Tag \`${name}\` not found.`, 'Use `/tag list` to see available tags.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const result = await promptText(ix, {
        title:       `Edit Tag: ${name}`,
        label:       'New content (markdown + line breaks)',
        placeholder: 'Updated tag content...',
        current:     existing.content,
        maxLength:   MAX_TAG_CONTENT,
        required:    true,
      });
      if (result === null) return;

      const content = result.text;
      Repo.updateTag(gid, name, content);
      return result.modal.reply({
        embeds: [success(`Tag \`${name}\` Updated`, `New content:\n${content.slice(0, 500)}${content.length > 500 ? '…' : ''}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    // ── DELETE ───────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const name    = ix.options.getString('name', true).toLowerCase();
      const deleted = Repo.deleteTag(gid, name);

      if (!deleted) {
        return ix.reply({
          embeds: [error(`Tag \`${name}\` not found.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      return ix.reply({
        embeds: [success(`Tag \`${name}\` deleted.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── LIST ─────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const tags = Repo.listTags(gid);

      if (tags.length === 0) {
        return ix.reply({
          embeds: [info('🏷️ Tags', 'No tags yet — create one with `/tag create`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Paginate if many tags
      const chunks: string[] = [];
      let current = '';
      for (const t of tags) {
        const line = `\`${t.name}\` — ${t.content.slice(0, 60)}${t.content.length > 60 ? '…' : ''}\n`;
        if (current.length + line.length > 4000) {
          chunks.push(current);
          current = '';
        }
        current += line;
      }
      if (current) chunks.push(current);

      const embed = new EmbedBuilder()
        .setTitle(`🏷️ Tags (${tags.length})`)
        .setDescription(chunks[0] ?? 'No tags.')
        .setColor('#5865f2')
        .setFooter({ text: `Use /tag use <name> to send in a ticket channel` })
        .setTimestamp();

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── INFO ─────────────────────────────────────────────────────────────────
    if (sub === 'info') {
      const name = ix.options.getString('name', true).toLowerCase();
      const tag  = Repo.getTag(gid, name);

      if (!tag) {
        return ix.reply({
          embeds: [error(`Tag \`${name}\` not found.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🏷️ Tag: \`${tag.name}\``)
        .setDescription(tag.content)
        .setColor('#5865f2')
        .addFields(
          { name: 'Created by', value: `<@${tag.created_by}>`, inline: true },
          { name: 'Created',    value: `<t:${tag.created_at}:R>`,            inline: true },
          { name: 'Length',     value: `${tag.content.length} chars`,        inline: true },
        )
        .setTimestamp();

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── USE ──────────────────────────────────────────────────────────────────
    if (sub === 'use') {
      const name    = ix.options.getString('name', true).toLowerCase();
      const mention = ix.options.getUser('mention');
      const tag     = Repo.getTag(gid, name);

      if (!tag) {
        return ix.reply({
          embeds: [error(`Tag \`${name}\` not found.`, 'Use `/tag list` to see available tags.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Send tag content to the channel (visible to everyone)
      const messageContent = mention
        ? `${mention} — ${tag.content}`
        : tag.content;

      await ix.channel?.send({ content: messageContent.slice(0, 2000) });

      // Confirm ephemeral
      return ix.reply({
        embeds: [success(`Tag \`${name}\` sent.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
