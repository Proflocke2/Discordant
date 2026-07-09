import {
  SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
} from 'discord.js';
import { getGuild } from '../../database/db';
import { getLocalized, Language } from '../../utils/localization';
import db from '../../database/db';
import { success, error, info } from '../../utils/embeds';
import { ApplicationRow } from '../../utils/types';

export default {
  data: new SlashCommandBuilder()
    .setName('application')
    .setDescription('Manage application forms (up to 25 questions)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('create').setDescription('Create a new application form'))
    .addSubcommand(s => s.setName('list').setDescription('List all application forms'))
    .addSubcommand(s => s.setName('delete').setDescription('Delete an application')
      .addIntegerOption(o => o.setName('id').setDescription('Application ID').setRequired(true)))
    .addSubcommand(s => s.setName('send').setDescription('Post apply button to channel')
      .addIntegerOption(o => o.setName('id').setDescription('Application ID').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)
        .addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('config').setDescription('Configure review channel & accept role')
      .addIntegerOption(o => o.setName('id').setDescription('Application ID').setRequired(true))
      .addChannelOption(o => o.setName('review_channel').setDescription('Where mods see applications')
        .addChannelTypes(ChannelType.GuildText))
      .addRoleOption(o => o.setName('accept_role').setDescription('Role on accept'))
      .addStringOption(o => o.setName('dm_message').setDescription('Custom DM message on submit'))),

  async execute(interaction: ChatInputCommandInteraction) {
    const guild = getGuild(interaction.guildId!);
    const lang = (guild.language || 'en') as Language;
    if (!interaction.guildId) {
      await interaction.reply({ content: '❌ Server only.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const modal = new ModalBuilder()
        .setCustomId('app_create_modal')
        .setTitle('Create Application Form');

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('app_name')
            .setLabel('Form Name')
            .setPlaceholder('e.g. Staff Application')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('app_description')
            .setLabel('Description (shown in panel)')
            .setPlaceholder('Apply for our team!')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('app_questions')
            .setLabel('Questions (one per line, max 25)')
            .setPlaceholder('What is your name?\nHow old are you?\nWhy do you want to join?\n...')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(2000)
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('app_button_label')
            .setLabel('Button Label')
            .setPlaceholder('Apply Now')
            .setValue('Apply Now')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setRequired(false)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    if (sub === 'list') {
      const apps = db.prepare('SELECT * FROM applications WHERE guild_id = ? AND active = 1')
        .all(interaction.guildId) as ApplicationRow[];

      if (!apps.length) {
        await interaction.reply({
          embeds: [info('No applications', 'Create one with `/application create`')],
          ephemeral: true,
        });
        return;
      }

      const e = new EmbedBuilder()
        .setTitle('📋 Applications')
        .setColor('#5865f2')
        .setDescription(apps.map(a => {
          const q = JSON.parse(a.questions).length;
          const reviewCh = a.review_channel ? `<#${a.review_channel}>` : '❌ Not set';
          const role = a.accept_role ? `<@&${a.accept_role}>` : '—';
          return `**#${a.id}** — ${a.name}\n   Questions: ${q} | Review: ${reviewCh} | Role: ${role}`;
        }).join('\n\n'));

      await interaction.reply({ embeds: [e], ephemeral: true });
      return;
    }

    if (sub === 'delete') {
      const id = interaction.options.getInteger('id', true);
      const app = db.prepare('SELECT * FROM applications WHERE id = ? AND guild_id = ?')
        .get(id, interaction.guildId) as ApplicationRow | undefined;

      if (!app) {
        await interaction.reply({ embeds: [error('Not found')], ephemeral: true });
        return;
      }

      db.prepare('UPDATE applications SET active = 0 WHERE id = ?').run(id);
      await interaction.reply({ embeds: [success('Deleted', `**${app.name}**`)], ephemeral: true });
      return;
    }

    if (sub === 'send') {
      const id = interaction.options.getInteger('id', true);
      const channel = interaction.options.getChannel('channel', true) as TextChannel;
      const app = db.prepare('SELECT * FROM applications WHERE id = ? AND guild_id = ? AND active = 1')
        .get(id, interaction.guildId) as ApplicationRow | undefined;

      if (!app) {
        await interaction.reply({ embeds: [error('Application not found')], ephemeral: true });
        return;
      }

      const questions = JSON.parse(app.questions);

      const embed = new EmbedBuilder()
        .setTitle(`📝 ${app.name}`)
        .setColor('#5865f2')
        .setDescription(app.description ?? 'Click below to apply!')
        .addFields({
          name: '📋 Process',
          value: `You will be asked **${questions.length} questions** via DM.\nMake sure your DMs are open!`,
          inline: false,
        });

      const btn = new ButtonBuilder()
        .setCustomId(`apply_${app.id}`)
        .setLabel(app.button_label ?? 'Apply Now')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝');

      await channel.send({
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(btn)],
      });

      await interaction.reply({
        embeds: [success('Application posted', `Apply button posted in ${channel}`)],
        ephemeral: true,
      });
      return;
    }

    if (sub === 'config') {
      const id = interaction.options.getInteger('id', true);
      const app = db.prepare('SELECT * FROM applications WHERE id = ? AND guild_id = ? AND active = 1')
        .get(id, interaction.guildId) as ApplicationRow | undefined;

      if (!app) {
        await interaction.reply({ embeds: [error('Application not found')], ephemeral: true });
        return;
      }

      const reviewCh = interaction.options.getChannel('review_channel');
      const acceptRole = interaction.options.getRole('accept_role');
      const dmMsg = interaction.options.getString('dm_message');

      const updates: string[] = [];
      const values: any[] = [];

      if (reviewCh) { updates.push('review_channel = ?'); values.push(reviewCh.id); }
      if (acceptRole) { updates.push('accept_role = ?'); values.push(acceptRole.id); }
      if (dmMsg) { updates.push('dm_message = ?'); values.push(dmMsg); }

      if (!updates.length) {
        await interaction.reply({ embeds: [info('No changes provided')], ephemeral: true });
        return;
      }

      values.push(id);
      db.prepare(`UPDATE applications SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      await interaction.reply({
        embeds: [success('Updated', `**${app.name}** updated`)],
        ephemeral: true,
      });
    }
  },
};
