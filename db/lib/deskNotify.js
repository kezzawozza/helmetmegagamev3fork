// The channel the adjudication desk's rows announce themselves on.
//
// Like bascinet_dm (dmNotify.js) and unlike bascinet_feed (feedNotify.js),
// nothing in code sends this one: four Postgres triggers do
// (db/prisma/migrations/20260921030000_desk_notify), so no writer — the web
// actions on /gm/turns, the turn-end push in stagedPush.js, the caving pass,
// moveEconomy.js, the Dev Panel, or the next one somebody adds — can forget
// to.
//
// The payload is `{ t, id, op }` and nothing else: which of the desk's four
// row types ("move" | "caving" | "effect" | "message"), which row, and
// whether it still exists ("row" | "gone"). The hub fans that bare tuple out
// without reading anything (web/lib/feedHub.js); the desk's SSE route
// coalesces a beat's worth of ids and re-reads them through
// web/lib/deskRows.js#deskPatchFor, which is the only place that decides what
// a GM is allowed to be sent (docs/systemdocs/ADJUDICATION.md §3).
const DESK_CHANNEL = "bascinet_desk";

module.exports = { DESK_CHANNEL };
