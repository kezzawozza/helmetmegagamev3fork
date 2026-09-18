// The Dropbox's two lines of player-facing text, on the Discord modal, the
// Chat modal and the Depot's own Selling tab. Bascinet's words, verbatim —
// kept in one place so the three faces cannot drift apart.
//
// Zero requires, on purpose, like db/lib/dmKinds.js: two client components
// (web/app/(app)/chat/PlacePanel.js, web/app/components/DepotSellingTab.js)
// import these, and they used to live in placeAffordances.js, which requires
// the intercom, which requires the archive, which requires Prisma — so the
// browser bundle tried to load node:fs and /chat crashed on open.
const DROPBOX_HELP =
  "The next time the train leaves, anything you put in the dropbox will be " +
  "automatically sold and credited to your chosen account.";

// What the Dropbox says when you are carrying nothing it takes.
const DROPBOX_EMPTY = "You don't have anything you can sell.";

module.exports = { DROPBOX_HELP, DROPBOX_EMPTY };
