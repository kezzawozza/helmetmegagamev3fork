import "server-only";
import { cookies } from "next/headers";

// Which of their two seats a gamemaster is reading /chat from. A GM who is
// also playing somebody used to get the player's page and nothing else
// (web/lib/feedAccess.js#loadFeedViewer: `gm = isGm && !character`), so rolling
// a character cost them the watcher's view of every zone they hold.
//
// A COOKIE, not a column. It is a view preference — per browser, carrying no
// game state, changing nobody's Discord roles and granting nothing a GM did
// not already have (the places a GM view lists are still GmZoneView's, read
// through db/lib/feedAccess.js#gmPlacesFor). A row in the database would have
// been a second thing to keep in step for a setting that means nothing to
// anybody but the person looking at the screen.
//
// Read in exactly ONE place — loadFeedViewer — so /chat's server render, the
// SSE stream, the history, places and search routes all follow one decision.

const CHAT_VIEW_COOKIE = "bascinet_chat_view";
// A year: a GM who picks a seat means it until they pick the other one.
const MAX_AGE = 60 * 60 * 24 * 365;

// "gm", or null for the player's own seat. Anything else reads as null — a
// hand-edited cookie must never be able to mean something this does not know.
export async function readChatViewAs() {
  const jar = await cookies();
  return jar.get(CHAT_VIEW_COOKIE)?.value === "gm" ? "gm" : null;
}

// Callable only from a server action or a route handler, which is where Next
// lets a cookie be written. The GM gate is the CALLER's — see
// web/app/(app)/chat/actions.js#setChatViewAs.
export async function writeChatViewAs(mode) {
  const jar = await cookies();
  if (mode === "gm") {
    jar.set(CHAT_VIEW_COOKIE, "gm", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
  } else {
    jar.delete(CHAT_VIEW_COOKIE);
  }
}
