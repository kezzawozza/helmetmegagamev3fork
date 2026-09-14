// DirectMessage insert notify channel, sent only by a Postgres trigger (db/prisma/migrations/20260913060000_dm_notify), never by code.
// Payload `{ id, discordUserId }`; listener re-reads and filters (web/lib/feedHub.js, docs/systemdocs/CHAT.md §2b).
const DM_CHANNEL = "bascinet_dm";

module.exports = { DM_CHANNEL };
