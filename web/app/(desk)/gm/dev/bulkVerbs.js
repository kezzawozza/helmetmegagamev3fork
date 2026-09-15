"use client";

// What the Dev Panel's bulk section can do, as a list rather than as six
// branches spread through a component.
//
// All six verbs ask the same question first — WHO, or WHERE — and differ only
// in what happens next. They used to be four separate sections with four
// pickers, four previews and four send buttons between them (Bulk actions,
// Send a letter, Say something, and the Quests panel's Broadcast tab), which
// meant learning the same screen four times and finding that three of the four
// could only reach one target at a time.
//
// `audience` picks which of the two pickers a verb draws: "people" over living
// characters, "place" over zones/locations/rooms. `preview` picks which half of
// the right-hand column it fills — see PREVIEW below.
export const AUDIENCE = { PEOPLE: "people", PLACE: "place" };

// A verb previews the thing that is hard to predict. For a structured payload
// that is WHO AND WHAT, so it draws the sentence Apply will carry out; for a
// text payload it is HOW IT WILL LOOK, so it draws the text the way the reader
// will actually meet it.
export const PREVIEW = { SENTENCE: "sentence", RENDERING: "rendering" };

export const VERBS = [
  { key: "move", label: "Move", audience: AUDIENCE.PEOPLE, preview: PREVIEW.SENTENCE },
  { key: "resources", label: "Resources", audience: AUDIENCE.PEOPLE, preview: PREVIEW.SENTENCE },
  { key: "tag", label: "Tag", audience: AUDIENCE.PEOPLE, preview: PREVIEW.SENTENCE },
  { key: "message", label: "Message", audience: AUDIENCE.PEOPLE, preview: PREVIEW.RENDERING },
  { key: "letter", label: "Letter", audience: AUDIENCE.PEOPLE, preview: PREVIEW.RENDERING },
  { key: "say", label: "Say", audience: AUDIENCE.PLACE, preview: PREVIEW.RENDERING },
];

export const VERB_KEYS = new Set(VERBS.map((v) => v.key));

export function verbByKey(key) {
  return VERBS.find((v) => v.key === key) ?? VERBS[0];
}

// The three place kinds the Say verb can reach. Each is a different Discord
// object, which is why the target list swaps rather than mixing them: a zone's
// #summary, a Location's channel, a Room's thread.
export const PLACE_KINDS = [
  { key: "zone", label: "Zone summary" },
  { key: "location", label: "Location" },
  { key: "room", label: "Room" },
];

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// Mirrors db/lib/ambientLine.js exactly. Kept client-side rather than
// round-tripped on every keystroke: it is one prefix per LINE, so a two-line
// scene typed by hand comes out half subtext and half shouting, and a preview
// that lags the typing is worse than no preview.
export function subtext(text) {
  return text
    .split("\n")
    .map((l) => `-# ${l}`)
    .join("\n");
}
