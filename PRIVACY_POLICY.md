# Privacy Policy — MultiBotV2

*Last updated: 2025 | Applies to all servers running MultiBotV2*

---

## 1. Who is responsible?

The server owner (Discord guild owner) who invited MultiBotV2 to their server is the data controller within the meaning of Art. 4(7) GDPR. The bot operator (developer) acts as a data processor.

---

## 2. What data is collected and why?

| Category | Data stored | Purpose | Legal basis |
|---|---|---|---|
| **XP / Level** | User ID, Guild ID, XP, level, message count, last XP timestamp | Level system & ranking | Legitimate interest (Art. 6(1)(f)) |
| **Economy** | User ID, Guild ID, coin balance, win/loss stats, games played | In-server economy & games | Legitimate interest |
| **Warnings** | User ID, Guild ID, moderator ID, reason, timestamp | Moderation history | Legitimate interest |
| **Tickets** | User ID, Guild ID, ticket content, status, timestamps | Support workflow | Legitimate interest |
| **Ticket Messages** | Author ID, ticket ID, message content, timestamp | Support transcript | Legitimate interest |
| **Application Answers** | User ID, Guild ID, answers to form questions | Staff recruitment | Legitimate interest |
| **Verification Log** | User ID, Guild ID, CAPTCHA result, timestamp | Spam/bot protection | Legitimate interest |
| **Security Incidents** | User ID, Guild ID, attack type, action taken, timestamp | Security audit trail | Legitimate interest |
| **Moderator Notes** | User ID, Guild ID, author ID, note text, timestamp | Internal moderation context | Legitimate interest |
| **Quotes** | Author ID, Guild ID, quoted content, channel | Quote board feature | Legitimate interest |
| **Reminders** | User ID, channel ID, reminder text, scheduled time | Reminder service | Contract (Art. 6(1)(b)) |
| **Giveaway Entries** | User ID within participants array | Giveaway management | Legitimate interest |

### Data **not** collected

- Message content outside of ticket transcripts
- Voice activity, screen shares, DM content
- Email addresses, real names, payment information
- IP addresses

---

## 3. How long is data retained?

| Category | Retention |
|---|---|
| XP / Level | Until user deletes their data or the bot is removed from the server |
| Economy | Until user deletes their data or the bot is removed |
| Warnings | Until explicitly cleared by a moderator or user deletion |
| Tickets | Until deleted by moderator or user deletion |
| Security Incidents | Until user deletion request |
| Reminders | Automatically removed after execution (`done = 1`) or user deletion |
| Giveaway Entries | Removed when giveaway ends or on user deletion |

---

## 4. Where is data stored?

- **Primary storage:** SQLite database file on the hosting provider (Render.com)
- **Optional backups:** If the server owner has configured GitHub backup (`GITHUB_TOKEN`, `GITHUB_REPO`), the entire database file is pushed automatically to the configured private GitHub repository every 15 minutes and on every graceful shutdown, in addition to the manual `/backup` and `/backup auto-enable` commands. Only the server owner controls this configuration and has access to that repository.
- Data is **not** shared with third parties, sold, or used for advertising.

---

## 5. Your rights (GDPR Art. 15–22)

You have the right to:

- **Access** (Art. 15): Run `/data info` to see all records stored about you on a server.
- **Erasure** (Art. 17): Run `/data delete` and confirm to permanently remove all your data from that server. This covers all categories listed in Section 2.
- **Restriction** (Art. 18): Contact the server owner to restrict processing.
- **Portability** (Art. 20): Your data is viewable via `/data info`. Export is not currently automated.
- **Objection** (Art. 21): Contact the server owner or remove yourself from the server.

### How to delete your data

1. Join the server where you want your data deleted.
2. Run `/data delete`.
3. Confirm by clicking the **"Yes, delete everything"** button within 60 seconds.
4. All records listed in Section 2 are permanently removed in a single atomic transaction.

> **Note:** Data related to active, open tickets or ongoing moderation actions may be retained by the server owner for legitimate operational reasons even after deletion. The bot itself removes the records; the server owner is responsible for any retained transcripts or screenshots.

---

## 6. Children's data

MultiBotV2 is not directed at users under the age of 13 (or the applicable minimum age in the user's jurisdiction). The bot operator does not knowingly collect data from minors. If you believe a minor's data has been collected, contact the server owner.

---

## 7. Changes to this policy

This policy may be updated to reflect new features or legal requirements. The latest version is always available in the bot's GitHub repository.

---

## 8. Contact

Questions about this policy or data processing should be directed to the **server owner** (Discord guild owner) who deployed this bot, as they are the data controller. For bot-level inquiries, open an issue in the GitHub repository.
