/**
 * docs/commandGuideText.ts
 *
 * Plain-English (CEFR A2-B1 level) explanation of every command in the bot.
 * Short sentences, simple words — written so most people can understand it,
 * even if English is not their first language.
 *
 * This is sent as a .txt file by /help. It is hand-written, not generated
 * automatically, so remember to update it when you add or change commands.
 */

export const COMMAND_GUIDE_TEXT = `
==========================================
 MULTIBOTV2 — COMMAND GUIDE
==========================================

Hello! This file explains all bot commands in simple English.

Some commands are for EVERYONE. Other commands are only for STAFF or ADMINS.
We write this next to each command, like this:
  [Everyone]     = any member can use it
  [Staff/Admin]  = you need a special permission (like "Manage Server")

A command can have "subcommands". A subcommand is a small extra word after
the command. Example: /ban has "add" and "remove". You type it like this:
  /ban add
  /ban remove

If a command has many subcommands, we group them under a "GROUP" name.
Example: /security has a group called "antinuke". You type it like this:
  /security antinuke setup

That is all you need to know! Let's go through every command.


------------------------------------------
 1. GAMES (fun commands, everyone can play)
------------------------------------------

/play — [Everyone] Play a simple game against the computer (AI).

/challenge — [Everyone] Ask another player to play a game with you.

/guide — [Everyone] Shows how to play any game. Use this if you are stuck.

/rps — [Everyone] Rock, Paper, Scissors. Subcommands: play (vs AI), pvp
(vs a player), guide (rules).

/tictactoe — [Everyone] Classic Tic-Tac-Toe (X and O).

/connectfour — [Everyone] Connect Four. Drop pieces and try to make a line
of 4. Subcommands: pvp, pve (vs AI).

/battleship — [Everyone] Place your ships and try to sink the other
player's ships. Subcommands: pve, pvp.

/chess — [Everyone] Full chess game. Subcommands: pve, pvp.

/uno — [Everyone] The card game UNO, for 2 to 4 players.

/yahtzee — [Everyone] Dice game. Roll, keep some dice, score points.
Subcommands: solo, pvp.

/mastermind — [Everyone] Guess the secret color code. Subcommands: solo
(vs AI), pvp.

/hangman — [Everyone] Guess the word, letter by letter, before you run
out of tries.

/minesweeper — [Everyone] Classic Minesweeper. Find all safe squares.

/wordle — [Everyone] Guess a 5-letter word. One new word every day.

/dice — [Everyone] Roll dice. Example: /dice 2d6 rolls two 6-sided dice.

/numguess — [Everyone] Guess a number between 1 and 100.

/quiz — [Everyone] Answer one trivia question.

/triviaduel — [Everyone] Challenge a friend to a trivia contest. First
player to 5 correct answers wins.

/higherorlower — [Everyone] Guess if the next card is higher or lower.

/guesssong — [Everyone] Guess the song from emoji clues or a small lyric.

/whoami — [Everyone] "Who Am I?" game. One player picks a character.
Other players ask Yes/No questions to guess it.

/truthordare — [Everyone] Classic Truth or Dare game.

/wouldyourather — [Everyone] "Would You Rather?" game. Vote and talk
about two funny choices.

/ghostsagainst — [Everyone] Card game like "Cards Against Humanity".
Best for 3-8 players.

/memelord — [Everyone] Write a funny meme caption. Other players vote
for the best one.


------------------------------------------
 2. ECONOMY (virtual coins and games)
------------------------------------------

/daily — [Everyone] Get free coins once a day. If you claim every day
in a row (a "streak"), you get more coins.

/eco-stats — [Everyone] Subcommand "balance" shows how many coins you
have. Subcommand "leaderboard" shows the top 10 richest players.

/pay — [Everyone] Send some of your coins to another player.

/shop — [Everyone] Subcommand "browse" shows items you can buy. "buy"
buys an item. "inventory" shows what you own. Admins can use "add" and
"remove" to manage items.

/blackjack — [Everyone] Play the card game Blackjack against the bot.

/slots — [Everyone] Play a slot machine. 3x3 grid, 5 ways to win.

/eco-challenge — [Everyone] Challenge another player to a coin duel
(a bet between two players).

/eco-config — [Everyone] Group "gambling" sets the wait time between
gambling commands and turns a warning message on/off. Group "lottery"
lets players buy lottery tickets ("buy"), see info ("info"), and lets
admins start a new lottery ("create").

/eco-admin — [Staff/Admin] Give or remove coins from a player (add, set),
see a player's full economy info, and set server-wide limits for max bet
and max /pay transfer.


------------------------------------------
 3. MODERATION (keeping the server safe)
------------------------------------------

/member — [Staff/Admin] Subcommand "kick" removes a user from the server.
"nickname" changes a user's nickname. Group "role" adds or removes a role
from one user.

/ban — [Staff/Admin] Subcommand "add" bans a user. "remove" un-bans a
user (you need their user ID).

/timeout — [Staff/Admin] "set" puts a member in timeout (they cannot
chat for a while). "remove" ends the timeout early.

/warnings — [Staff/Admin] "add" gives a member a warning. "list" shows
all warnings a member has. "clear" removes all warnings from a member.

/purge — [Staff/Admin] Deletes messages in a channel.

/mass-action — [Staff/Admin] Group "ban" bans many users at once
(useful during a raid). Group "role" adds or removes a role from
every member on the server.

/restrict — [Staff/Admin] Group "lockdown" locks channels so normal
members can't send messages. Group "stickymute" mutes a user, and the
mute stays even if they leave and rejoin. Group "userslow" sets a slow
mode just for one user in one channel.

/channel — [Staff/Admin] "lock" and "unlock" a channel. "slowmode" sets
how often people can send messages in a channel.

/records — [Staff/Admin] "infractions" shows a member's full history of
warnings and punishments. Group "notes" lets staff write private notes
about a member. Group "warnconfig" sets rules for when a warning should
lead to an automatic punishment.

/automod — [Staff/Admin] Turns on automatic filters: bad words, spam,
ALL CAPS, invite links, phishing links, and more. You can also set a
punishment (like a mute) for people who break the rules.

/reactionroles — [Staff/Admin] Creates a message where members click a
button to get a role by themselves ("self-assign").

/security — [Staff/Admin] Big group of protection tools:
  - antinuke: protects against a hacked staff account deleting channels
    or roles.
  - antiraid: protects against many fake accounts joining at once.
  - auto-defend: makes the bot act on its own when it sees an attack.
  - ultra-mode: instant, very strong protection — bans suspicious new
    joiners right away.
  - inactivity-kick: removes members who never became active.
  - config: opens a menu to set up everything easily.

/raid-tools — [Staff/Admin] Tools to TEST your security setup, and to
clean up / end a raid situation. Group "raidsim" and group "simulate"
create fake (safe) attacks so you can check your filters work.
"rollback" removes all test messages. "end" ends an active raid and
unlocks the server.

/attacksim — [Staff/Admin] Advanced attack simulator with REAL Discord
actions (it really creates and deletes test channels/roles, then
restores them). Only use this if you understand what it does.


------------------------------------------
 4. TICKETS (support system)
------------------------------------------

/ticket — [Everyone, staff-only actions marked] Actions inside an open
ticket: "close" (staff), "claim" (staff), "unclaim" (staff), "add" a
user (staff), "remove" a user (staff), "rename" (staff), and "review"
(only the person who opened the ticket can leave a star rating).

/panel — [Staff/Admin] Creates the button/menu that members click to
open a new ticket. "create", "list", "send", "delete", "edit".

/multipanel — [Staff/Admin] Combines up to 5 panels into one message,
so members choose from a menu. Has a step-by-step "wizard" too.

/ticket-types — [Staff/Admin] Group "category" manages the categories
shown in a panel (example: "Support", "Report a bug"). Group "type"
manages reusable templates you can use again for new panels.

/ticket-content — [Staff/Admin] Group "form" manages the questions a
member must answer before opening a ticket. Group "tag" manages saved
answers ("tags") that staff can send quickly in a ticket.

/settings — [Staff/Admin] All the general settings for the ticket
system: cooldown, max open tickets per user, log channel, archive
channel, auto-close, and more.

/ticketstats — [Staff/Admin] Shows numbers and charts: how many tickets
were opened/closed, which staff member closed the most, and survey
(rating) results.


------------------------------------------
 5. UTILITY (general tools)
------------------------------------------

/ping — [Everyone] Shows how fast the bot answers (its "latency").

/about — [Everyone] Shows info about the bot: features, stats, invite
link.

/botinfo — [Everyone] Shows technical stats about the bot.

/avatar — [Everyone] Shows a user's profile picture in full size.

/userinfo — [Everyone] Shows info about a user (join date, roles, etc).

/roleinfo — [Everyone] Shows info about a role.

/serverinfo — [Everyone] Shows info about this server.

/level — [Everyone, admin actions marked] "rank" shows your level card.
"leaderboard" shows the top 10 most active members. Admins can "set" or
"reset" someone's XP, turn the system on/off, and set level-up rewards.

/poll — [Everyone] Creates a poll. You can set an end time.

/remind — [Everyone] Sets a reminder. The bot will message you later.

/quoteboard — [Everyone, admin setup] Pin a funny or nice message as a
"quote". Admins set up the quote channel first.

/data — [Everyone] Shows what personal data the bot stores about you
("info"), or lets you delete all of it ("delete"). This follows privacy
law (GDPR).

/embed — [Staff/Admin] Creates a custom, styled message (an "embed")
with colors, titles, and images.

/announce — [Staff/Admin] Sends an announcement message.

/giveaway — [Staff/Admin] "start" begins a giveaway. "end" ends it
early. "reroll" picks new winners.

/webhook — [Staff/Admin] Advanced tool to save, send, and edit messages
through a Discord webhook. For advanced users.

/language — [Staff/Admin] Sets which language the bot uses on this
server (English, German, French, or Russian).

/setup — [Staff/Admin] A guided wizard that turns on security and
moderation features for you. "quick" turns on everything recommended
at once.

/v-setup — [Staff/Admin] Sets up the verification system (new members
must verify before they can chat).

/stats — [Staff/Admin] Creates voice channels that show live server
stats, like member count.

/backup — [Staff/Admin] Saves a snapshot of all your server settings.
You can restore an old snapshot later if something goes wrong.

/bot-customize — [Staff/Admin] Changes how the bot looks on YOUR
server only (not on other servers): its nickname, avatar picture, and
banner image.

/team-activity — [Staff/Admin] Tracks how active your staff team is.
"sponsor" registers a giveaway sponsor. "leaderboard" shows the most
active staff. The "config-..." subcommands turn features on/off: ticket
counting, sponsor counting, the leaderboard, and weekly ticket goals
with a friendly reminder.

/deploy — [Bot Owner/Admin] Re-installs all slash commands. You only
need this after the bot code changes.

/application — [Staff/Admin] Manages application forms, for example
"apply to be staff". Up to 25 questions per form.

/help — [Everyone] Sends you this guide again, any time you need it.


------------------------------------------
 6. WELCOME (new members)
------------------------------------------

/welcome — [Staff/Admin] Sets up the welcome message for new members:
channel, text, welcome card image, a private welcome DM, a leave
message, and auto-roles for new members.

/simwelcome — [Staff/Admin] Sends a TEST welcome or leave message, so
you can check it looks right before real members join.


------------------------------------------
 THAT'S ALL!
------------------------------------------

If you are not sure which command to use, just ask a staff member, or
type "/" in Discord and look at the list — Discord shows a short
description for every command too.

Thank you for using MultiBotV2! 🎫
`;
