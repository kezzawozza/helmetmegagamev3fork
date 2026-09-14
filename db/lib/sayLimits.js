// What a spoken message is allowed to be. ZERO REQUIRES, ever — web/app/(app)/chat/Feed.js is a "use client" component needing these numbers; one require of @lifeweb/db here would drag PrismaClient into the browser bundle. Same rule as db/lib/dmKinds.js, db/lib/dmPolicy.js and db/lib/questText.js.
const MESSAGE_LIMIT = 2000;
const MAX_SAY_PIECES = 3;
const COUNT_FROM = 1500;

function tooManyPieces(pieces) {
  return `That would go out as ${pieces} messages. Trim it to ${MAX_SAY_PIECES} or fewer.`;
}

module.exports = { MESSAGE_LIMIT, MAX_SAY_PIECES, COUNT_FROM, tooManyPieces };
