// What kind of thing a DirectMessage IS, vs `source` which says what produced it and drives how it's
// DRAWN — the two are orthogonal. **NOTICE is the default in all three sendDm functions**, so a
// forgotten `kind` stays quiet rather than loud. No requires in this file, ever — imported by a client
// component (web/app/components/DmThread.js); a require of @lifeweb/db here would drag PrismaClient
// into the browser bundle.
const DM_KIND = {
  // A human composed these words for this reader. Sorts the inbox, sets the preview, counts as unread.
  CONVERSATION: "CONVERSATION",

  // The game said it. Invisible to the rail; a quiet grey line in the thread itself.
  NOTICE: "NOTICE",

  // Pure plumbing. Logged, never rendered on either face.
  QUIET: "QUIET",
};

// The two `source` values a renderer still branches on, beside kind. Live here (not web/) so the
// browser bundle can read them too, letting DmThread.js drop its own hand-synced copies.
// A letter (db/lib/bird.js, which re-exports these) draws as paper, not chat; reply is CONVERSATION.
const GM_LETTER_SOURCE = "gm_letter";
const GM_LETTER_REPLY_SOURCE = "gm_letter_reply";

// A player-to-player letter via the Bird — draws as one row, not collapsed into "N automated messages".
const BIRD_SOURCE = "bird";

// A mention relay. The one NOTICE the two chairs disagree about: the GM desk hides it, the player's
// Chat pane shows it. Row's meta carries { placeKey, where } so the pane can open where it happened.
const MENTION_SOURCE = "mention";

module.exports = {
  DM_KIND,
  GM_LETTER_SOURCE,
  GM_LETTER_REPLY_SOURCE,
  BIRD_SOURCE,
  MENTION_SOURCE,
};
