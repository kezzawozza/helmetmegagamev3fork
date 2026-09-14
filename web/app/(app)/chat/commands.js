"use client";

// The composer's slash commands: the web twins of the player commands in
// bot/src/lib/commands.js.
//
// A player who learned `/shout` in a Discord DM should not have to learn a
// button for it here, and half of these had no web surface at all — /conceal
// and /shout in particular were Discord-only, which meant a "web only"
// character simply could not do them.
//
// THE REGISTRY IS DATA, and deliberately so. A command that lived as a branch
// inside the composer's keydown handler could only ever be reachable from the
// composer; as a list it can also be what ⌘K offers, which is the next thing
// the plan asks for.
//
// Each entry:
//   name         what is typed after the slash, and what the chip says
//   description  one line in the menu
//   where        which place kinds it may run in — "loc" | "room" | "conv" |
//                "zone". The same restriction the Discord contexts express:
//                /shout and /roll want an audience, and the zone summary is
//                a broadcast rather than a place you are standing in.
//   args         [{ name, kind, placeholder, optional }]. `kind` is one of
//                  text        the textarea itself, with the placeholder
//                  person      a chip row of everyone here
//                  moveKind    the three Move chips
//                  destination the reachable places, from loadTravel
//                Only ONE text arg, and it is always last: the textarea is
//                the only free-form input the composer has.
//   run(values, ctx)  values keyed by arg name. `ctx` is what the composer can
//                do that a server action cannot — open a dialog, pick a travel
//                node, look somebody up. Returns the usual { ok, line, error },
//                or `null` for a command that only opened something.
//
// This file is imported by a "use client" component, so it must never reach
// for @lifeweb/db. Everything it calls is a server action from ./actions.

import {
  submitMove,
  toggleConceal,
  shoutHere,
  rollHere,
  playHere,
  addMember,
  removeMember,
} from "./actions";

// A shout is 300 characters at the most, the same cap the Discord option
// carries — this posts into a couple of dozen channels and half of them get it
// with most of the letters knocked out.
const SHOUT_LIMIT = 300;

const EVERYWHERE = ["loc", "room", "conv", "zone", "net"];

export const COMMANDS = [
  {
    name: "move",
    description: "Lock in your Move for this turn.",
    where: EVERYWHERE,
    args: [
      { name: "kind", kind: "moveKind" },
      { name: "description", kind: "text", placeholder: "What you spend the day doing…" },
    ],
    run: ({ kind, description }) => submitMove({ moveKind: kind, description }),
  },
  {
    name: "travel",
    description: "Go somewhere connected to here.",
    where: EVERYWHERE,
    args: [{ name: "to", kind: "destination" }],
    // Not a server action: it picks the node in the Travel grid and opens its
    // confirm strip, so the drag-along chips and the cost are still shown
    // before anybody's feet move.
    run: ({ to }, ctx) => {
      ctx.travelTo?.(to);
      return { ok: true, line: "Picked. Confirm it in Travel." };
    },
  },
  {
    name: "conceal",
    description: "Conceal yourself.",
    where: EVERYWHERE,
    args: [],
    run: () => toggleConceal(),
  },
  {
    name: "shout",
    description: "Yell. You'll be heard nearby.",
    // Not the zone summary: a shout is a voice in a place, and the summary is
    // not a place anybody stands in. Not the street either: a Location takes
    // no voice at all, which is the whole reason it has no composer.
    where: ["room", "conv"],
    args: [{ name: "message", kind: "text", placeholder: "What you yell…", maxLength: SHOUT_LIMIT }],
    run: ({ message }, ctx) => shoutHere(message, ctx.placeKey),
  },
  {
    name: "roll",
    description: "Roll a die here for everyone to see.",
    // Not the zone summary, for the reason /shout gives above: a die is cast
    // in a place somebody is standing in, and the summary is a broadcast.
    where: ["room", "conv"],
    args: [],
    run: (_values, ctx) => rollHere(ctx.placeKey),
  },
  {
    name: "play",
    description: "Play your instrument, or sing if you have none, for the room to hear.",
    // Same gate as /shout and /roll: a performance happens in front of the
    // people you are standing with, not into the street or a zone summary.
    where: ["room", "conv"],
    args: [],
    run: (_values, ctx) => playHere(ctx.placeKey),
  },
  {
    name: "look",
    description: "Look at somebody standing here.",
    where: EVERYWHERE,
    // Hoods included: looking at somebody is the one thing you can do to a
    // person you cannot name, and the token is what carries them.
    args: [{ name: "person", kind: "person", hoods: true }],
    run: ({ person }, ctx) => {
      ctx.lookAt?.(person);
      return null;
    },
  },
  {
    name: "converse",
    description: "Take somebody aside for a private conversation.",
    where: EVERYWHERE,
    // No argument: the dialog asks which room and what to call it, and you
    // add people once you are in it. Converse opened from somebody's row in
    // HERE ticks that person; typed here it opens empty.
    args: [],
    run: (_values, ctx) => {
      ctx.converse?.();
      return null;
    },
  },
  {
    name: "add",
    description: "Bring somebody into this conversation or private room.",
    where: ["room", "conv"],
    // Hoods included, the same as /look: a mask hides who somebody is, not
    // that they are standing here, and a rider who had to take his helmet off
    // to be invited was not wearing one. The token is what carries them.
    args: [{ name: "person", kind: "person", hoods: true }],
    run: ({ person }, ctx) => addMember(ctx.placeKey, person),
  },
  {
    name: "remove",
    description: "Show somebody out of this conversation or private room.",
    where: ["room", "conv"],
    // The people to show out are the MEMBERS, not the street — ctx supplies
    // them, and the picker falls back to who is here when it has none.
    args: [{ name: "person", kind: "person", from: "members" }],
    run: ({ person }, ctx) => removeMember(ctx.placeKey, person),
  },
];

// Which commands may run in the open place, in registry order.
export function commandsFor(placeKind) {
  if (!placeKind) return [];
  return COMMANDS.filter((entry) => entry.where.includes(placeKind));
}

// What the composer is looking at: a live `/word` the caret sits at the end
// of, at the very START of an empty-ish composer.
//
// The slash has to open the whole box, unlike `@`, which may open a word
// anywhere in it. A slash mid-sentence is a date, a fraction or a path, and
// none of those is a command — and unlike a mention, a command REPLACES what
// the box is for, so opening one three words in would eat a sentence.
export function slashQueryAt(text, caret) {
  if (!text.startsWith("/")) return null;
  const query = text.slice(1, Math.max(1, caret));
  // A space ends it: past that the player is either writing a sentence that
  // began with a slash, or has typed a whole command name — and the exact
  // match below is what handles the second case.
  if (/\s/.test(query)) return null;
  return { query };
}

// Case-insensitive prefix. Short list, so no cap is needed — the whole
// registry is ten entries and the popover holds them.
export function matchCommands(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((entry) => entry.name.startsWith(q));
}

// The exact-name-plus-space case: typing `/shout ` enters command mode
// without ever touching the menu, the way Discord's composer does.
export function exactCommand(list, text) {
  const match = /^\/([a-z]+)\s$/.exec(text);
  if (!match) return null;
  return list.find((entry) => entry.name === match[1]) ?? null;
}

// The one text argument, if the command has one. Everything else is picked
// from chips, so this is what the textarea is holding.
export function textArgOf(command) {
  return command?.args?.find((arg) => arg.kind === "text") ?? null;
}

// The arguments that need a chip row under the box, in order. The first one
// with no value yet is the one being asked for.
export function pendingArg(command, values) {
  return (
    command?.args?.find((arg) => arg.kind !== "text" && !arg.optional && !values[arg.name]) ?? null
  );
}
