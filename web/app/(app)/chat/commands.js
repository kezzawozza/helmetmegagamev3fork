"use client";

// The composer's slash commands: the web twins of bot/src/lib/commands.js. THE REGISTRY IS DATA, deliberately — a list, not a keydown branch, so ⌘K can offer it too.
// Entry shape: name, description, where (place kinds — "loc"|"room"|"conv"|"zone"), args ([{name, kind, placeholder, optional}], only ONE text arg, always last), run(values, ctx) → { ok, line, error } or null.
// This file is imported by a "use client" component, so it must never reach for @lifeweb/db. Everything it calls is a server action from ./actions.

import {
  submitMove,
  toggleConceal,
  shoutHere,
  rollHere,
  playHere,
  addMember,
  removeMember,
} from "./actions";

// Same cap as the Discord option — this posts into a couple of dozen channels.
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
    where: ["room", "conv"],
    args: [{ name: "message", kind: "text", placeholder: "What you yell…", maxLength: SHOUT_LIMIT }],
    run: ({ message }, ctx) => shoutHere(message, ctx.placeKey),
  },
  {
    name: "roll",
    description: "Roll a die here for everyone to see.",
    where: ["room", "conv"],
    args: [],
    run: (_values, ctx) => rollHere(ctx.placeKey),
  },
  {
    name: "play",
    description: "Play your instrument, or sing if you have none, for the room to hear.",
    where: ["room", "conv"],
    args: [],
    run: (_values, ctx) => playHere(ctx.placeKey),
  },
  {
    name: "look",
    description: "Look at somebody standing here.",
    where: EVERYWHERE,
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
    args: [{ name: "person", kind: "person", hoods: true }],
    run: ({ person }, ctx) => addMember(ctx.placeKey, person),
  },
  {
    name: "remove",
    description: "Show somebody out of this conversation or private room.",
    where: ["room", "conv"],
    args: [{ name: "person", kind: "person", from: "members" }],
    run: ({ person }, ctx) => removeMember(ctx.placeKey, person),
  },
];

// Which commands may run in the open place, in registry order.
export function commandsFor(placeKind) {
  if (!placeKind) return [];
  return COMMANDS.filter((entry) => entry.where.includes(placeKind));
}

// A live `/word` the caret sits at the end of, at the very START of an
// empty-ish composer. The slash must open the whole box, unlike `@`: a slash
// mid-sentence is a date, a fraction or a path, not a command.
export function slashQueryAt(text, caret) {
  if (!text.startsWith("/")) return null;
  const query = text.slice(1, Math.max(1, caret));
  // A space ends it.
  if (/\s/.test(query)) return null;
  return { query };
}

// Case-insensitive prefix. Short list, so no cap is needed.
export function matchCommands(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((entry) => entry.name.startsWith(q));
}

// Typing `/shout ` enters command mode without touching the menu, Discord-style.
export function exactCommand(list, text) {
  const match = /^\/([a-z]+)\s$/.exec(text);
  if (!match) return null;
  return list.find((entry) => entry.name === match[1]) ?? null;
}

// The one text argument, if the command has one — what the textarea holds.
export function textArgOf(command) {
  return command?.args?.find((arg) => arg.kind === "text") ?? null;
}

// The first chip-row argument with no value yet — the one being asked for.
export function pendingArg(command, values) {
  return (
    command?.args?.find((arg) => arg.kind !== "text" && !arg.optional && !values[arg.name]) ?? null
  );
}
