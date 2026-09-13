// The words and the ids a Quest is made of, and NOTHING that touches a
// database. See docs/systemdocs/QUESTS.md.
//
// This file has ZERO REQUIRES, ever, for the same reason db/lib/dmKinds.js and
// db/lib/dmPolicy.js do: the web's Interact dialog is a client component, and
// one require of @lifeweb/db from here would drag PrismaClient into the
// browser bundle. db/lib/quests.js does the work and re-exports all of this,
// so a server caller still has one place to import from.
//
// The two sentences are fixed. A player who presses Interact on Discord and a
// player who presses it on the web must read the same words, so neither face
// gets to type its own copy.
const INTERACT_PROMPT = "Interacting will be a Gambit. Declare your intentions.";
const ALREADY_MOVED = "You've already used your move this turn.";

// The quest id rides in all of these, so no handler needs a thread-to-Room
// lookup. The interact prefix lives HERE rather than beside the other button
// prefixes in db/lib/placeAffordances.js, because the web's dialog has to read
// the id back out of a custom_id and that file is not client-safe. There is
// still exactly one spelling of it: placeAffordances.js requires this file.
const QUEST_INTERACT_PREFIX = "quest:interact:";
const QUEST_MODAL_PREFIX = "quest:modal:";
const QUEST_INTENTION_FIELD = "quest:intention";

const TITLE_MAX = 90;
const DESCRIPTION_MAX = 1800;
const INTENTION_MAX = 1000;

module.exports = {
  INTERACT_PROMPT,
  QUEST_INTERACT_PREFIX,
  ALREADY_MOVED,
  QUEST_MODAL_PREFIX,
  QUEST_INTENTION_FIELD,
  TITLE_MAX,
  DESCRIPTION_MAX,
  INTENTION_MAX,
};
