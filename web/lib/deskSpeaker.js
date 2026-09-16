// What the GM's messages desk calls the person on the other side of a thread:
// the character's name, plus the Discord account behind it.
//
//   Aleksei Ivanov (@forgeybot)
//
// Only here. On /play a character is a character and the account behind them is
// nobody's business; on this desk it is the whole point, because a GM answering
// a question needs to know which player they are answering. The rail has shown
// the handle beside the name for a while (PlayerRail.js) — this is the same fact
// in the two places that were still missing it, the thread header and each
// inbound row.
//
// NO IMPORTS: both callers are client components.
//
// A missing handle is ORDINARY, not an error — listGuildMembers() does not know
// a player who has left the guild — so it falls back to the bare name rather
// than leaving empty parentheses behind.
export function deskSpeakerName(name, username) {
  const base = String(name ?? "").trim();
  const handle = String(username ?? "").trim();
  if (!base) return handle ? `@${handle}` : "";
  return handle ? `${base} (@${handle})` : base;
}
