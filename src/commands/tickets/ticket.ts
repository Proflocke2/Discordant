/**
 * /ticket — In-ticket actions.
 *
 * Subcommands (run inside a ticket channel):
 *   close    – Close this ticket (shows close-reason modal) [STAFF ONLY]
 *   claim    – Claim this ticket as staff                   [STAFF ONLY]
 *   unclaim  – Release claim on this ticket                 [STAFF ONLY]
 *   add      – Add a user to this ticket                    [STAFF ONLY]
 *   remove   – Remove a user from this ticket               [STAFF ONLY]
 *   rename   – Rename this ticket channel                   [STAFF ONLY]
 *   review   – Leave a star rating (opener only; also sent automatically on close if survey enabled)
 *
 * ── PERMISSIONS ──────────────────────────────────────────────────────────────
 *
 * ⚠️  CONFIGURATION REQUIRED — fill in the two constants below:
 *
 *   FALLBACK_STAFF_ROLE_ID  →  Your default "Staff" or "Support" role ID.
 *                              Used when the ticket category has no specific support_role_id.
 *   ADMIN_ROLE_ID           →  Optional: a higher-tier admin role that always bypasses checks.
 *
 * The /ticket command itself has NO defaultMemberPermissions set so it shows to all users
 * (needed for /ticket review). Individual subcommands gate staff-only actions at runtime.
 *
 * If you want Discord-native permission hiding for staff commands, split them into a
 * separate /staff-ticket command and set .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  GuildMember,
} from 'discord.js';
import { success, error } from '../../utils/embeds';
import { tGuild } from '../../i18n';
import * as Repo from '../../modules/tickets/repository';
import { closeTicket, addUserToTicket, removeUserFromTicket, claimTicket, unclaimTicket } from '../../modules/tickets/service';
import { buildSurveyComponents } from '../../modules/tickets/builder';
import { ActivityEvent } from '../../modules/tickets/types';

// ── Staff role configuration ──────────────────────────────────────────────────
//
// ⚠️  SET YOUR ROLE IDs HERE:
const FALLBACK_STAFF_ROLE_ID = ''; // ← e.g. '123456789012345678'  (Staff / Support role)
const ADMIN_ROLE_ID          = ''; // ← e.g. '987654321098765432'  (Admin role — optional bypass)

/**
 * Returns true if the interaction member has staff access.
 * Priority: Server Administrator → Admin role → Category support_role → Fallback staff role.
 */
function isStaff(member: GuildMember, ticketId?: number): boolean {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID)) return true;

  if (ticketId !== undefined) {
    const ticket = Repo.getTicket(ticketId);
    if (ticket?.category_id) {
      const cat = Repo.getCategory(ticket.category_id);
      if (cat?.support_role_id && member.roles.cache.has(cat.support_role_id)) return true;
    }
  }

  if (FALLBACK_STAFF_ROLE_ID && member.roles.cache.has(FALLBACK_STAFF_ROLE_ID)) return true;
  return false;
}

/** Sends a consistent "staff only" ephemeral error reply. */
async function denyNonStaff(ix: ChatInputCommandInteraction): Promise<void> {
  await ix.reply({
    embeds: [new EmbedBuilder()
      .setTitle('🚫 Access Denied')
      .setDescription('This command is reserved for **Staff members** only.')
      .setColor('#ed4245')],
    flags: MessageFlags.Ephemeral,
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket actions')
    .setDMPermission(false)
    // No defaultMemberPermissions — /ticket review must be visible to all users.
    // Staff-only subcommands are gated at runtime via isStaff().

    .addSubcommand(s => s.setName('close').setDescription('Close this ticket [Staff only]'))
    .addSubcommand(s => s.setName('claim').setDescription('Claim this ticket as your own [Staff only]'))
    .addSubcommand(s => s.setName('unclaim').setDescription('Release your claim on this ticket [Staff only]'))

    .addSubcommand(s =>
      s.setName('add').setDescription('Add a user to this ticket [Staff only]')
        .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)),
    )
    .addSubcommand(s =>
      s.setName('remove').setDescription('Remove a user from this ticket [Staff only]')
        .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)),
    )
    .addSubcommand(s =>
      s.setName('rename').setDescription('Rename this ticket channel [Staff only]')
        .addStringOption(o => o.setName('name').setDescription('New channel name').setRequired(true)),
    )

    .addSubcommand(s =>
      s.setName('review').setDescription('Leave a star rating for this ticket (opener only)')
        .addIntegerOption(o =>
          o.setName('rating')
            .setDescription('Rating (1 = poor, 5 = excellent)')
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(true),
        )
        .addStringOption(o =>
          o.setName('feedback').setDescription('Optional written feedback'),
        ),
    ),

  async execute(ix: ChatInputCommandInteraction) {
    const sub    = ix.options.getSubcommand();
    const gid    = ix.guildId!;
    const member = ix.member as GuildMember;

    const ticket = Repo.getTicketByChannel(ix.channelId);

    if (!ticket || ticket.status === 'closed') {
      return ix.reply({
        embeds: [error(tGuild(gid, 'tickets.actions.not_a_ticket'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── STAFF-ONLY GUARD ──────────────────────────────────────────────────────
    const staffOnlySubcmds = ['close', 'claim', 'unclaim', 'add', 'remove', 'rename'];
    if (staffOnlySubcmds.includes(sub) && !isStaff(member, ticket.id)) {
      return denyNonStaff(ix);
    }

    // ── CLOSE ─────────────────────────────────────────────────────────────────
    if (sub === 'close') {
      const modal = new ModalBuilder()
        .setCustomId(`tk:close-reason:${ticket.id}`)
        .setTitle('Close Ticket')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Reason for closing')
              .setPlaceholder('e.g. Issue resolved, No response…')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMinLength(3)
              .setMaxLength(500),
          ),
        );
      return ix.showModal(modal);
    }

    // ── CLAIM ─────────────────────────────────────────────────────────────────
    if (sub === 'claim') {
      const result = await claimTicket(ix.guild!, ticket, ix.user);
      if (!result.ok) {
        const msg = result.alreadyClaimed
          ? tGuild(gid, 'tickets.actions.already_claimed', { user: `<@${result.alreadyClaimed}>` })
          : tGuild(gid, 'tickets.actions.already_closed');
        return ix.reply({ embeds: [error(msg)], flags: MessageFlags.Ephemeral });
      }
      return ix.reply({
        embeds: [success(tGuild(gid, 'tickets.actions.claimed', { user: `<@${ix.user.id}>` }))],
      });
    }

    // ── UNCLAIM ───────────────────────────────────────────────────────────────
    if (sub === 'unclaim') {
      const result = await unclaimTicket(ix.guild!, ticket, ix.user);
      if (!result.ok) {
        return ix.reply({
          embeds: [error('This ticket is not currently claimed.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      return ix.reply({
        embeds: [success(`✋ Ticket unclaimed by <@${ix.user.id}>.`)],
      });
    }

    // ── ADD USER ──────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const u = ix.options.getUser('user', true);
      await addUserToTicket(ix.channel as TextChannel, u.id);
      Repo.logActivity({ guild_id: gid, ticket_id: ticket.id, user_id: ix.user.id, event: ActivityEvent.UserAdded });
      return ix.reply({
        embeds: [success(tGuild(gid, 'tickets.actions.user_added', { user: u.toString() }))],
      });
    }

    // ── REMOVE USER ───────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const u = ix.options.getUser('user', true);
      await removeUserFromTicket(ix.channel as TextChannel, u.id);
      return ix.reply({
        embeds: [success(tGuild(gid, 'tickets.actions.user_removed', { user: u.toString() }))],
      });
    }

    // ── RENAME ────────────────────────────────────────────────────────────────
    if (sub === 'rename') {
      const name = ix.options.getString('name', true).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 95);
      await (ix.channel as TextChannel).setName(name);
      Repo.logActivity({ guild_id: gid, ticket_id: ticket.id, user_id: ix.user.id, event: ActivityEvent.Renamed });
      return ix.reply({
        embeds: [success(tGuild(gid, 'tickets.actions.renamed', { name }))],
      });
    }

    // ── REVIEW (opener only — NOT staff-gated) ────────────────────────────────
    if (sub === 'review') {
      if (ix.user.id !== ticket.user_id) {
        return ix.reply({
          embeds: [error('Only the ticket opener can leave a review.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const rating   = ix.options.getInteger('rating', true) as 1 | 2 | 3 | 4 | 5;
      const feedback = ix.options.getString('feedback') ?? null;
      const stars    = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);

      Repo.insertSurvey({ ticket_id: ticket.id, guild_id: gid, user_id: ix.user.id, rating, feedback });

      const reviewEmbed = new EmbedBuilder()
        .setTitle('⭐ Ticket Review')
        .setColor(rating >= 4 ? '#57f287' : rating >= 3 ? '#fee75c' : '#ed4245')
        .addFields(
          { name: 'Rating',       value: `${stars} (${rating}/5)`,  inline: true },
          { name: 'Reviewed by',  value: `<@${ix.user.id}>`,        inline: true },
        )
        .setTimestamp();

      if (feedback) reviewEmbed.addFields({ name: 'Feedback', value: feedback });

      await (ix.channel as TextChannel).send({ embeds: [reviewEmbed] }).catch(() => {});

      return ix.reply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Review Submitted')
          .setDescription(`Thank you for your feedback! You rated this ticket **${stars}** (${rating}/5)`)
          .setColor('#57f287')],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
