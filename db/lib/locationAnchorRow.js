// Location components both faces share, as raw component JSON (db/ has no
// discord.js). The location id rides in custom_id; routed by prefix in
// bot/src/events/interactionCreate.js — change one here, change it there too.

// LABELS and predicates live in db/lib/placeAffordances.js, so the anchor and Chat's place panel can't drift.
const {
  GO,
  DANGER: DANGER_TONE,
  TRAVEL_CUSTOM_ID,
  WHOS_HERE_PREFIX,
  NOTICEBOARD_PREFIX,
  SECRET_ROOMS_PREFIX,
  EXAMINE_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
  locationAffordances,
  gateLabel,
} = require("./placeAffordances");

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;
const SUCCESS = 3;
const DANGER = 4;


const ROW_BUTTON_LIMIT = 5;
const LABEL_MAX = 80;

// Takes the LOCATION — the Noticeboard button is conditional (docs/zones.yaml).
// TRAVEL IS FIRST, no emoji — same `loc:open` as #turns, but one emoji would shout among plain-text buttons here.
const TONE_STYLE = { [GO]: SUCCESS, [DANGER_TONE]: DANGER };

function locationAnchorButtons(location) {
  return locationAffordances(location).map((entry) => ({
    type: BUTTON,
    style: TONE_STYLE[entry.tone] ?? SECONDARY,
    custom_id: entry.customId,
    label: entry.label.slice(0, LABEL_MAX),
  }));
}

function locationAnchorRows(location) {
  const buttons = locationAnchorButtons(location);
  const rows = [];
  for (let i = 0; i < buttons.length; i += ROW_BUTTON_LIMIT) {
    rows.push({ type: ACTION_ROW, components: buttons.slice(i, i + ROW_BUTTON_LIMIT) });
  }
  return rows;
}

// Null when there are none — an empty action row is rejected by Discord.
// Verb is what the click DOES — open offers "Close".
function locationGateRow(gates) {
  const shown = (gates ?? []).slice(0, ROW_BUTTON_LIMIT);
  if (shown.length === 0) return null;
  return {
    type: ACTION_ROW,
    components: shown.map((gate) => ({
      type: BUTTON,
      style: gate.isOpen ? DANGER : SUCCESS,
      custom_id: `${GATE_PREFIX}${gate.linkId}`,
      label: gateLabel(gate).slice(0, LABEL_MAX),
    })),
  };
}

// Not an anchor row (rides on a DM), but every "loc:" custom id belongs in
// one file. "Leave it open" is SUCCESS — holding a door is the generous act; letting it shut is the quiet default, no colour.
function keyedPromptRow(linkId) {
  return [
    {
      type: ACTION_ROW,
      components: [
        {
          type: BUTTON,
          style: SUCCESS,
          custom_id: `${KEYED_PREFIX}${linkId}:yes`,
          label: "Leave it open",
        },
        {
          type: BUTTON,
          style: SECONDARY,
          custom_id: `${KEYED_PREFIX}${linkId}:no`,
          label: "Let it shut",
        },
      ],
    },
  ];
}

module.exports = {
  EXAMINE_PREFIX,
  WHOS_HERE_PREFIX,
  NOTICEBOARD_PREFIX,
  SECRET_ROOMS_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  KEYED_PREFIX,
  locationAnchorRows,
  TRAVEL_CUSTOM_ID,
  locationGateRow,
  keyedPromptRow,
};
