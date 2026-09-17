// What makes a spoken message look like it was meant out of character, and what
// the player is told when it is. ZERO REQUIRES, ever — same rule as
// db/lib/sayLimits.js and db/lib/dmPolicy.js: this is reachable from a "use
// client" component, and one require of @lifeweb/db would drag PrismaClient
// into the browser bundle.
//
// Speech is in character. A parenthesis, a bracket or the bare word "ooc" is
// how people have always marked the other thing, so those three are the tell.
// `/ooc` is where it goes instead (db/lib/ooc.js).

// The bare word only: \b puts no boundary inside a letter run, so "poockie",
// "cooct" and "loocy" all go through untouched — it is "ooc" standing on its
// own, however it is punctuated, that is caught.
const OOC_MARKERS = /[([]|\booc\b/i;

function containsOoc(text) {
  return OOC_MARKERS.test(String(text ?? ""));
}

// Handed back with the text, so nobody loses what they typed. The leading `»`
// is written here rather than left to the transport: web/lib/discordGuild.js
// applies it and bot/src/lib/dm.js does not, and this body has to read the same
// on both faces. applyDmPrefix is idempotent, so the web's pass is a no-op.
function oocRejectionDm(text) {
  return [
    "» Your message was rejected because it contained OOC. Use /ooc instead.",
    "",
    "Here's the message:",
    `» ${String(text ?? "")}`,
  ].join("\n");
}

// The one-line refusal the composer itself shows, where there is a composer.
const OOC_REFUSAL = "Your message was rejected because it contained OOC. Use /ooc instead.";

module.exports = { OOC_MARKERS, OOC_REFUSAL, containsOoc, oocRejectionDm };
