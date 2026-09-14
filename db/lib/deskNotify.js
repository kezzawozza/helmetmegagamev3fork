// Desk notify channel, sent only by four Postgres triggers (db/prisma/migrations/20260921030000_desk_notify), never by code.
// Payload `{ t, id, op }` is fanned out raw (web/lib/feedHub.js); web/lib/deskRows.js#deskPatchFor decides what a GM may see (docs/systemdocs/ADJUDICATION.md §3).
const DESK_CHANNEL = "bascinet_desk";

module.exports = { DESK_CHANNEL };
