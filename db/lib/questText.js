// The words and ids a Quest is made of, NOTHING that touches a database (docs/systemdocs/QUESTS.md). ZERO REQUIRES, ever — the web's Interact dialog is a client component, and one require of @lifeweb/db here would drag PrismaClient into the browser bundle. db/lib/quests.js does the work and re-exports all of this.
const INTERACT_PROMPT = "Interacting will be a Gambit. Declare your intentions.";
const ALREADY_MOVED = "You've already used your move this turn.";

// The interact prefix lives HERE rather than beside the other button prefixes in db/lib/placeAffordances.js, because the web's dialog reads the id back out of a custom_id and that file is not client-safe; placeAffordances.js requires this file for one spelling.
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
