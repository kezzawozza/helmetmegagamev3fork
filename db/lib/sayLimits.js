// What a spoken message is allowed to be, and the words for when it is not.
//
// ZERO REQUIRES, ever. web/app/(app)/chat/Feed.js is a "use client" component
// and it needs these numbers to draw the count under the box; one require of
// @lifeweb/db from here would drag PrismaClient into the browser bundle. Same
// rule as db/lib/dmKinds.js, db/lib/dmPolicy.js and db/lib/questText.js.
//
// db/lib/say.js requires this file and re-exports MESSAGE_LIMIT, so every
// caller that already imported it from there is untouched.

// Discord's own ceiling for ONE message. Kept on the web side too, because
// the outbox has to be able to repost whatever lands in a row.
const MESSAGE_LIMIT = 2000;

// ...and the most messages one send is allowed to become. Over the limit the
// web composer splits rather than refusing (docs/systemdocs/CHAT.md), but not
// without end: a pasted spreadsheet should not become thirty messages in a
// room. Three is roughly 6000 characters.
const MAX_SAY_PIECES = 3;

// Where the count starts showing. Silent below this, because a limit nobody
// is near is just noise under the box.
const COUNT_FROM = 1500;

// One sentence, both faces. The web refuses before sending and the server
// refuses again behind it, and a player must not meet two wordings for one
// rule.
function tooManyPieces(pieces) {
  return `That would go out as ${pieces} messages. Trim it to ${MAX_SAY_PIECES} or fewer.`;
}

module.exports = { MESSAGE_LIMIT, MAX_SAY_PIECES, COUNT_FROM, tooManyPieces };
