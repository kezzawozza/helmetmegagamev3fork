// The Bird — one letter a day to a named person in a GUESSED zone (docs/systemdocs/BIRD.md). Pure and requires nothing, so all three callers (web send action, turn-pass failure report, bot reply handler) share identical copy — "The message wasn't delivered." must read the same whether the guess was wrong or the recipient was dead. Carries an object now: you write a letter (Paper, docs/systemdocs/PAPERWORK.md), not raw text, so an illiterate recipient can hand it to someone who can read. Client-safe: import by path as `@lifeweb/db/lib/bird`, never through the @lifeweb/db barrel.

const BIRD_SLUG = "bird";
const LITERATE_SLUG = "literate";
// Blind reads nothing regardless of the sheet. A blind character can still be SENT a letter and still carry one — the paper arrives either way — but cannot work the bird themselves.
const BLIND_SLUG = "blind";

// A bird won't fly underground and won't carry a letter out either — both directions on purpose, so nobody in the Depths can send freely while unreachable (a hiding place with a mail service).
const UNREACHABLE_ZONE_SLUGS = new Set(["caves", "depths"]);

// customId prefixes for the Reply button and its select, routed in bot/src/events/interactionCreate.js, handled in bot/src/lib/birdReply.js. A SELECT, not a modal: replying hands over a letter already written (via Write), so a reply can go out sealed.
const BIRD_REPLY_PREFIX = "bird:reply:";
const BIRD_REPLY_PICK_PREFIX = "bird:replypick:";

// Deliberately identical for a wrong guess and a dead recipient — telling them apart would make the bird a once-a-day test of whether somebody's alive. Two DirectMessage sources exist so DmThread.js can draw a letter as paper (LetterBody), not chat; `source` decides only that. Desk weight comes from `kind` (db/lib/dmKinds.js): gm_letter (outgoing) is NOTICE — the GM's own line, already known; gm_letter_reply (incoming, from bot/src/lib/birdReply.js) is CONVERSATION — a reply addressed to them that greying would hide. Both strings live in dmKinds.js, which requires nothing, so DmThread.js (a client component) imports them directly.
const { GM_LETTER_SOURCE, GM_LETTER_REPLY_SOURCE } = require("./dmKinds");

const NOT_DELIVERED_DM = "The message wasn't delivered.";

const TOO_LATE_REPLY = "It's too late. The bird flew away.";

// Which zones a letter may address: everywhere standable except the two deep cave levels. CAVE_GROUP is dropped because "Caves" isn't a place anyone stands, the same rule performTravel enforces (MAP.md §1).
function birdZones(zones) {
  return zones.filter((z) => z.kind !== "CAVE_GROUP" && !UNREACHABLE_ZONE_SLUGS.has(z.slug));
}

function isBirdReachableZone(zone) {
  return Boolean(zone) && zone.kind !== "CAVE_GROUP" && !UNREACHABLE_ZONE_SLUGS.has(zone.slug);
}

function hasSlug(tags, slug) {
  return Array.isArray(tags) && tags.some((ct) => (ct.tag ? ct.tag.slug : ct.slug) === slug);
}

// Stupid can't compose a sentence, so can't compose a letter — the Bird is the one place written text leaves a character without passing through the proxy, so without this a Squeeze-eater could still write. Checked in canSendBird below rather than garbling the body: a letter nobody could have written shouldn't arrive.
const STUPID_SLUG = "stupid";

// Whether written words reach this character: literate and not blind, asked as one question so no caller checks only half. The fuller gate is db/lib/reading.js#readBlock (blind drunk, no spectacles, sun-blind in daylight); this stays because it's what the Bird's own surfaces ask and is pure of turn/Location context — a tag chip uses readBlock, a bird asks this.
function canReadLetters(tags) {
  return hasSlug(tags, LITERATE_SLUG) && !hasSlug(tags, BLIND_SLUG) && !hasSlug(tags, STUPID_SLUG);
}

// Holding the bird isn't enough — working it is a literate act: you address it, and must know which paper in hand is the one to send.
function canSendBird(tags) {
  return hasSlug(tags, BIRD_SLUG) && canReadLetters(tags) && !hasSlug(tags, STUPID_SLUG);
}

// The letter as the recipient sees it. The DM no longer holds the words — the PAPER does, now in their hands — so an illiterate recipient can walk the object to someone who can read instead of being handed runes and a footnote. Deliberately does NOT say whether it's sealed or what's on it — both are facts about the object, on their sheet. The `»` prefix is added by sendDm itself; the sender's line is written bare here.
function deliveryDm({ senderName, letterName }) {
  return (
    `A bird finds you, and there is a letter tied to its leg. It is from **${senderName}**.\n\n` +
    `You take it: **${letterName}**. It is on your sheet.`
  );
}

// The reply, as the original sender sees it. Same shape as delivery: an object arrived, on their sheet.
function replyDm({ replierName, letterName }) {
  return (
    `Your bird's returned, and it is carrying an answer from **${replierName}**.\n\n` +
    `You take it: **${letterName}**. It is on your sheet.`
  );
}

// The sender's own record, sent whether or not the letter landed, worded to give away nothing about which happened. It cannot say whether it left their hands — true only if the guess was right — since saying so would turn the receipt into the instant answer the delayed failure notice exists to withhold; the player learns from their own sheet a turn later, same as everyone else.
function sentReceiptDm({ recipientName, zoneName, letterName }) {
  return `You let the bird go with **${letterName}**, for **${recipientName}**, in the **${zoneName}**.`;
}

// One button, on the letter itself. The id is the BirdMessage row's, which the handler checks the reply window against.
function replyButtonRow(birdMessageId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `${BIRD_REPLY_PREFIX}${birdMessageId}`, label: "Reply" },
      ],
    },
  ];
}

module.exports = {
  BLIND_SLUG,
  STUPID_SLUG,
  canReadLetters,
  LITERATE_SLUG,
  BIRD_REPLY_PREFIX,
  BIRD_REPLY_PICK_PREFIX,
  NOT_DELIVERED_DM,
  TOO_LATE_REPLY,
  GM_LETTER_SOURCE,
  GM_LETTER_REPLY_SOURCE,
  birdZones,
  isBirdReachableZone,
  canSendBird,
  deliveryDm,
  replyDm,
  sentReceiptDm,
  replyButtonRow,
};
