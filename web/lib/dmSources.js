// Outbound DirectMessage sources that are bot/system-generated (not a GM typing). Kept out of
// dmThread.js so DmThread.js (a client component) doesn't drag @lifeweb/db's Prisma into the bundle.
// staged_push is excluded: it's GM-authored turn-result prose (CHAT.md §2b). Lives here, not
// DmPane.js, because the SERVER component building /chat's first paint needs the string too.
export const DM_PLACE_KEY = "gm";

// Mention relay ("You were mentioned in X"; bot/src/lib/mentions.js, feedOutbox.js#relayWebMentions).
// Own source, not system_notice: GM desk hides it, player's Chat pane shows it. meta carries { placeKey, where }.
export const MENTION_SOURCE = "mention";
