/**
 * /multipanel — Combine up to 5 ticket panels into a single message (Ticket Bot V2 style).
 *
 * The multi-panel shows one select menu where each option is a ticket panel.
 * Users pick a panel → see its categories → open a ticket.
 *
 * Subcommands:
 *   create    – Create a multi-panel (title + description for the overview embed)
 *   edit      – Edit title, description, or color
 *   addpanel  – Add an existing panel (max 5)
 *   removepanel – Remove a panel
 *   send      – Post the multi-panel in a channel
 *   list      – List all multi-panels
 *   delete    – Delete a multi-panel
 */

import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  ChannelType, TextChannel, MessageFlags, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuInteraction, ButtonInteraction,
} from 'discord.js';
import { success, error, info } from '../../utils/embeds';
import { promptText } from '../../utils/modalText';
import * as Repo from '../../modules/tickets/repository';
import { buildMultiPanelEmbed, buildMultiPanelComponents } from '../../modules/tickets/builder';
import { refreshMultiPanelMessage } from '../../modules/tickets/service';

const MAX_PANELS = 25;

export default {
  data: new SlashCommandBuilder()
    .setName('multipanel')
    .setDescription('Combine up to 5 ticket panels into one message')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    // /multipanel wizard
    .addSubcommand(s =>
      s.setName('wizard').setDescription('🧙 Guided setup — create a complete multi-panel step by step'),
    )

    // /multipanel create
    .addSubcommand(s =>
      s.setName('create').setDescription('Create a new multi-panel')
        .addStringOption(o => o.setName('name').setDescription('Internal name (staff only)').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('Embed title shown to users').setRequired(true))
        .addStringOption(o =>
          o.setName('description')
            .setDescription('Embed description — supports markdown & line breaks, shown above the panel selector'),
        )
        .addStringOption(o => o.setName('color').setDescription('Embed color (hex, e.g. #5865f2)'))
        .addStringOption(o => o.setName('image').setDescription('Large embed image URL'))
        .addStringOption(o => o.setName('thumbnail').setDescription('Small corner thumbnail URL'))
        .addStringOption(o => o.setName('footer').setDescription('Embed footer text'))
        .addStringOption(o => o.setName('content').setDescription('Plain text above the embed (supports @mentions)')),
    )

    // /multipanel edit
    .addSubcommand(s =>
      s.setName('edit').setDescription('Edit a multi-panel field')
        .addIntegerOption(o => o.setName('multi_id').setDescription('Multi-panel ID').setRequired(true))
        .addStringOption(o =>
          o.setName('field').setDescription('Field to edit').setRequired(true)
            .addChoices(
              { name: 'Title',       value: 'title'       },
              { name: 'Description', value: 'description' },
              { name: 'Color',       value: 'color'       },
              { name: 'Image',       value: 'image'       },
              { name: 'Thumbnail',   value: 'thumbnail'   },
              { name: 'Footer',      value: 'footer'      },
              { name: 'Content',     value: 'content'     },
              { name: 'Name (internal)', value: 'name'    },
            ),
        )
        .addStringOption(o => o.setName('value').setDescription('New value').setRequired(true)),
    )

    // /multipanel addpanel
    .addSubcommand(s =>
      s.setName('addpanel').setDescription(`Add one or more panels to a multi-panel (max ${MAX_PANELS} total)`)
        .addIntegerOption(o => o.setName('multi_id').setDescription('Multi-panel ID').setRequired(true))
        .addStringOption(o =>
          o.setName('panel_ids')
            .setDescription('Panel ID(s) to add — separate multiple with commas (e.g. 1,2,3)')
            .setRequired(true),
        ),
    )

    // /multipanel removepanel
    .addSubcommand(s =>
      s.setName('removepanel').setDescription('Remove a panel from a multi-panel')
        .addIntegerOption(o => o.setName('multi_id').setDescription('Multi-panel ID').setRequired(true))
        .addIntegerOption(o => o.setName('panel_id').setDescription('Panel ID to remove').setRequired(true)),
    )

    // /multipanel send
    .addSubcommand(s =>
      s.setName('send').setDescription('Post the multi-panel in a channel')
        .addIntegerOption(o => o.setName('multi_id').setDescription('Multi-panel ID').setRequired(true))
        .addChannelOption(o =>
          o.setName('channel').setDescription('Target channel')
            .addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )

    // /multipanel list
    .addSubcommand(s =>
      s.setName('list').setDescription('List all multi-panels'),
    )

    // /multipanel delete
    .addSubcommand(s =>
      s.setName('delete').setDescription('Delete a multi-panel permanently')
        .addIntegerOption(o => o.setName('multi_id').setDescription('Multi-panel ID').setRequired(true)),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const sub = ix.options.getSubcommand();
    const gid = ix.guildId!;

    // ── WIZARD ──────────────────────────────────────────────────────────────
    if (sub === 'wizard') {
      // Schritt 1: Name + Titel via Modal
      const step1 = await promptText(ix, {
        title:    'Multi-Panel Setup (1/3)',
        label:    'Name & Titel — getrennt durch | (z.B. Support | Support Tickets)',
        placeholder: 'Support | 🎫 Support — Select a category',
        maxLength: 200,
        required:  true,
      });
      if (step1 === null) return;

      const parts = step1.text.split('|').map(s => s.trim());
      const name  = parts[0] ?? 'Multi-Panel';
      const title = parts[1] ?? parts[0];

      // Schritt 2: Panels auswählen via SelectMenu
      const allPanels = Repo.listPanels(gid);
      if (allPanels.length === 0) {
        return step1.modal.reply({
          embeds: [error('No panels found', 'Create panels first with `/panel create` and add categories with `/category add`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      // Panels ohne Kategorien herausfiltern
      const panelsWithCats = allPanels.filter(p => Repo.listCategories(p.id).length > 0);
      if (panelsWithCats.length === 0) {
        return step1.modal.reply({
          embeds: [error('No usable panels', 'All existing panels have no categories. Add categories with `/category add` hinzu.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const panelSelect = new StringSelectMenuBuilder()
        .setCustomId('wizard:panels')
        .setPlaceholder('Select panels (1–' + Math.min(panelsWithCats.length, MAX_PANELS) + ')')
        .setMinValues(1)
        .setMaxValues(Math.min(panelsWithCats.length, MAX_PANELS))
        .addOptions(panelsWithCats.slice(0, 25).map(p => {
          const cats = Repo.listCategories(p.id);
          return {
            label:       p.title.slice(0, 100),
            value:       String(p.id),
            description: `ID: ${p.id} • ${cats.length} Kategorie(n)`.slice(0, 100),
          };
        }));

      const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('wizard:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      const step2Msg = await step1.modal.reply({
        embeds: [new EmbedBuilder()
          .setColor('#5865f2')
          .setTitle('🧙 Multi-Panel Wizard — Schritt 2/3')
          .setDescription(
            `**Name:** \`${name}\`\n**Titel:** ${title}\n\n` +
            `Select the panels to include in this multi-panel.\n` +
            `${panelsWithCats.length} panel(s) available.`,
          )],
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(panelSelect),
          cancelRow,
        ],
        flags: MessageFlags.Ephemeral,
        withResponse: true,
      });

      let selectedPanelIds: number[] = [];

      const collector = step2Msg.resource!.message!.createMessageComponentCollector({
        filter: (i) => i.user.id === ix.user.id,
        time:   5 * 60 * 1000,
        max:    5,
      });

      await new Promise<void>((resolve) => {
        collector.on('collect', async (interaction) => {
          if (interaction.customId === 'wizard:cancel') {
            await interaction.update({
              embeds: [info('Abgebrochen', 'Der Wizard wurde abgebrochen.')],
              components: [],
            });
            collector.stop('cancelled');
            resolve();
            return;
          }

          if (interaction.customId === 'wizard:panels') {
            const sel = interaction as StringSelectMenuInteraction;
            selectedPanelIds = sel.values.map(Number);

            // Schritt 3: Kanal wählen + bestätigen
            const selectedPanels = selectedPanelIds.map(id => Repo.getPanel(id)).filter(Boolean) as Repo.Panel[];
            const panelList = selectedPanels.map(p => `• **${p.title}** (\`${p.id}\`)`).join('\n');

            await interaction.update({
              embeds: [new EmbedBuilder()
                .setColor('#57f287')
                .setTitle('🧙 Multi-Panel Wizard — Schritt 3/3')
                .setDescription(
                  `**Selected (${selectedPanels.length}/${MAX_PANELS}):**\n${panelList}\n\n` +
                  `Klicke **Erstellen** um das Multi-Panel zu speichern.\n` +
                  `Danach kannst du es mit \`/multipanel send\` in einen Kanal posten.`,
                )],
              components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                  new ButtonBuilder().setCustomId('wizard:confirm').setLabel(`✅ Erstellen (${selectedPanels.length} Panels)`).setStyle(ButtonStyle.Success),
                  new ButtonBuilder().setCustomId('wizard:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
                ),
              ],
            });
            return;
          }

          if (interaction.customId === 'wizard:confirm') {
            if (selectedPanelIds.length === 0) {
              await interaction.update({
                embeds: [error('Error', 'No panels selected.')],
                components: [],
              });
              collector.stop('error');
              resolve();
              return;
            }

            // Multi-Panel erstellen
            const multi = Repo.createMultiPanel({
              guild_id:    gid,
              name,
              title,
              description: null,
              color:       '#5865f2',
            });
            Repo.updateMultiPanelPanels(multi.id, selectedPanelIds);

            const selectedPanels = selectedPanelIds.map(id => Repo.getPanel(id)).filter(Boolean) as Repo.Panel[];
            const panelList      = selectedPanels.map(p => `✅ **${p.title}** (\`${p.id}\`)`).join('\n');

            await (interaction as ButtonInteraction).update({
              embeds: [new EmbedBuilder()
                .setColor('#57f287')
                .setTitle('✅ Multi-Panel erstellt!')
                .setDescription(
                  `**ID:** \`${multi.id}\`  •  **Name:** ${multi.name}\n\n` +
                  `**Enthaltene Panels:**\n${panelList}\n\n` +
                  `**Next steps:**\n` +
                  `• \`/multipanel send multi_id:${multi.id} channel:#kanal\` — Panel posten\n` +
                  `• \`/multipanel edit multi_id:${multi.id} field:description\` — Beschreibung setzen\n` +
                  `• \`/multipanel addpanel multi_id:${multi.id}\` — Add more panels\n` +
                  `• \`/multipanel edit multi_id:${multi.id} field:color\` — Change color`,
                )],
              components: [],
            });
            collector.stop('done');
            resolve();
          }
        });

        collector.on('end', (_, reason) => {
          if (reason === 'time') {
            ix.editReply({ embeds: [info('Timeout', 'Der Wizard ist abgelaufen.')], components: [] }).catch(() => {});
          }
          resolve();
        });
      });

      return;
    }

    // ── CREATE ──────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const name  = ix.options.getString('name', true);
      const title = ix.options.getString('title', true);
      const desc  = ix.options.getString('description') ?? null;
      const color = ix.options.getString('color') ?? '#5865f2';

      const m = Repo.createMultiPanel({
        guild_id: gid, name, title, description: desc, color,
        image:     ix.options.getString('image'),
        thumbnail: ix.options.getString('thumbnail'),
        footer:    ix.options.getString('footer'),
        content:   ix.options.getString('content') ?? null,
      });

      return ix.reply({
        embeds: [success(
          '✅ Multi-Panel Created',
          `**ID:** \`${m.id}\`  •  **Name:** ${m.name}\n\n` +
          `Next: add up to ${MAX_PANELS} panels with \`/multipanel addpanel\`, then post with \`/multipanel send\`.`,
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── EDIT ────────────────────────────────────────────────────────────────
    if (sub === 'edit') {
      const multi = Repo.getMultiPanel(ix.options.getInteger('multi_id', true));
      if (!multi || multi.guild_id !== gid) {
        return ix.reply({ embeds: [error('Multi-panel not found.')], flags: MessageFlags.Ephemeral });
      }

      const field = ix.options.getString('field', true) as
        'title' | 'description' | 'color' | 'image' | 'thumbnail' | 'footer' | 'content' | 'name';
      const value = ix.options.getString('value', true);

      // Validate color if editing color field
      if (field === 'color' && !/^#[0-9a-fA-F]{6}$/.test(value)) {
        return ix.reply({ embeds: [error('Invalid hex color — e.g. `#5865f2`')], flags: MessageFlags.Ephemeral });
      }

      // description + content → Modal für echte Zeilenumbrüche
      if (field === 'description' || field === 'content') {
        const current = field === 'description' ? multi.description : multi.content;
        const result2 = await promptText(ix, {
          title:       `Edit: ${field}`,
          label:       field === 'description' ? 'Panel description' : 'Message above panel',
          placeholder: 'Supports **markdown** and line breaks.',
          current:     current ?? '',
          maxLength:   2000,
          required:    false,
        });
        if (result2 === null) return;
        const resolvedValue2 = result2.text.trim() || null;
        Repo.updateMultiPanel(multi.id, { [field]: resolvedValue2 });
        const updated2 = Repo.getMultiPanel(multi.id)!;
        await refreshMultiPanelMessage(ix.guild!, updated2);
        return result2.modal.reply({
          embeds: [success('✏️ Multi-Panel Updated', `**${field}** updated${updated2.message_id ? ' — live message refreshed.' : '.'}`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const resolvedValue = value;
      Repo.updateMultiPanel(multi.id, { [field]: resolvedValue });
      const updated = Repo.getMultiPanel(multi.id)!;
      await refreshMultiPanelMessage(ix.guild!, updated);

      return ix.reply({
        embeds: [success('✏️ Multi-Panel Updated', `**${field}** updated${updated.message_id ? ' — live message refreshed.' : '.'}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── ADD PANEL ───────────────────────────────────────────────────────────
    if (sub === 'addpanel') {
      const multi = Repo.getMultiPanel(ix.options.getInteger('multi_id', true));

      if (!multi || multi.guild_id !== gid) {
        return ix.reply({ embeds: [error('Multi-panel not found.')], flags: MessageFlags.Ephemeral });
      }

      // Parse comma-separated panel IDs (e.g. "1,2,3" or just "1")
      const rawInput = ix.options.getString('panel_ids', true);
      const inputIds = rawInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

      if (inputIds.length === 0) {
        return ix.reply({
          embeds: [error('No valid panel IDs found. Use numbers separated by commas, e.g. `1,2,3`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const existingIds: number[] = JSON.parse(multi.panel_ids);
      const added:   string[] = [];
      const skipped: string[] = [];

      for (const panelId of inputIds) {
        if (existingIds.length >= MAX_PANELS) {
          skipped.push(`\`${panelId}\` — multi-panel is full (${MAX_PANELS}/${MAX_PANELS})`);
          continue;
        }

        const panel = Repo.getPanel(panelId);
        if (!panel || panel.guild_id !== gid) {
          skipped.push(`\`${panelId}\` — panel not found`);
          continue;
        }
        if (existingIds.includes(panel.id)) {
          skipped.push(`\`${panelId}\` **${panel.title}** — already in multi-panel`);
          continue;
        }

        const cats = Repo.listCategories(panel.id);
        if (cats.length === 0) {
          skipped.push(`\`${panelId}\` **${panel.title}** — no categories (add with \`/category add\`)`);
          continue;
        }

        existingIds.push(panel.id);
        added.push(`\`${panelId}\` **${panel.title}**`);
      }

      if (added.length > 0) {
        Repo.updateMultiPanelPanels(multi.id, existingIds);
        await refreshMultiPanelMessage(ix.guild!, Repo.getMultiPanel(multi.id)!);
      }

      let description = '';
      if (added.length > 0) {
        description += `**Added (${added.length}):**\n${added.map(s => `✅ ${s}`).join('\n')}`;
      }
      if (skipped.length > 0) {
        if (description) description += '\n\n';
        description += `**Skipped (${skipped.length}):**\n${skipped.map(s => `⚠️ ${s}`).join('\n')}`;
      }
      description += `\n\n**Slots:** ${existingIds.length}/${MAX_PANELS} panels in **${multi.name}**`;

      const title   = added.length > 0 ? '✅ Panels Added' : '⚠️ No Panels Added';
      const embedFn = added.length > 0 ? success : error;

      return ix.reply({
        embeds: [embedFn(title, description)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── REMOVE PANEL ────────────────────────────────────────────────────────
    if (sub === 'removepanel') {
      const multi   = Repo.getMultiPanel(ix.options.getInteger('multi_id', true));
      const panelId = ix.options.getInteger('panel_id', true);

      if (!multi || multi.guild_id !== gid) {
        return ix.reply({ embeds: [error('Multi-panel not found.')], flags: MessageFlags.Ephemeral });
      }

      const ids    = (JSON.parse(multi.panel_ids) as number[]).filter(id => id !== panelId);
      const panel  = Repo.getPanel(panelId);

      Repo.updateMultiPanelPanels(multi.id, ids);
      await refreshMultiPanelMessage(ix.guild!, Repo.getMultiPanel(multi.id)!);

      return ix.reply({
        embeds: [success('🗑️ Panel Removed', `Panel ${panel ? `**${panel.title}**` : `\`${panelId}\``} removed. (${ids.length}/${MAX_PANELS} remaining)`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── SEND ────────────────────────────────────────────────────────────────
    if (sub === 'send') {
      const multi   = Repo.getMultiPanel(ix.options.getInteger('multi_id', true));
      const channel = ix.options.getChannel('channel', true) as TextChannel;

      if (!multi || multi.guild_id !== gid) {
        return ix.reply({ embeds: [error('Multi-panel not found.')], flags: MessageFlags.Ephemeral });
      }

      const ids    = JSON.parse(multi.panel_ids) as number[];
      const panels = ids.map(i => Repo.getPanel(i)).filter((p): p is Repo.Panel => p !== null);

      if (panels.length === 0) {
        return ix.reply({
          embeds: [error('No panels added yet. Use `/multipanel addpanel` to add up to 5.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const msg = await channel.send({
        content:    multi.content ?? undefined,
        embeds:     [buildMultiPanelEmbed(multi, panels)],
        components: buildMultiPanelComponents(multi, panels) as any,
      });

      Repo.updateMultiPanelMessage(multi.id, channel.id, msg.id);

      return ix.reply({
        embeds: [success('✅ Multi-Panel Sent', `**${multi.name}** posted in ${channel} with ${panels.length} panel(s).`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── LIST ────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const multis = Repo.listMultiPanels(gid);
      if (multis.length === 0) {
        return ix.reply({
          embeds: [info('🗂️ Multi-Panels', 'No multi-panels yet — create one with `/multipanel create`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder().setTitle('🗂️ Multi-Panels').setColor('#5865f2').setTimestamp();
      for (const m of multis) {
        const ids    = JSON.parse(m.panel_ids) as number[];
        const panels = ids.map(i => Repo.getPanel(i)).filter(Boolean);
        const sent   = m.message_id ? `✅ <#${m.channel_id}>` : '⏳ Not sent yet';

        embed.addFields({
          name: `\`[${m.id}]\` ${m.name} • ${ids.length}/${MAX_PANELS} panels • ${sent}`,
          value: panels.length > 0
            ? panels.map(p => `  └ ${p!.title}`).join('\n')
            : '  *No panels added*',
        });
      }

      return ix.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── DELETE ──────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const multi = Repo.getMultiPanel(ix.options.getInteger('multi_id', true));
      if (!multi || multi.guild_id !== gid) {
        return ix.reply({ embeds: [error('Multi-panel not found.')], flags: MessageFlags.Ephemeral });
      }
      Repo.deleteMultiPanel(multi.id);
      return ix.reply({
        embeds: [success('🗑️ Multi-Panel Deleted', `**${multi.name}** has been permanently deleted.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
