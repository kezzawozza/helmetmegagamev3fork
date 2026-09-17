"use client";

// The composer's slash commands: mostly the web twins of bot/src/lib/commands.js — /decree is the
// one deliberate exception, noted on its own entry below. THE REGISTRY IS DATA, deliberately — a
// list, not a keydown branch, so ⌘K can offer it too.
// Entry shape: name, description, where (place kinds — "loc"|"room"|"conv"|"zone"), args ([{name, kind, placeholder, optional}], only ONE text arg, always last), run(values, ctx) → { ok, line, error } or null.
// Plus optional `verb`: the word on the composer's send button while this command is being typed. It defaults to "Run", which is right for a command that DOES something — conceal, roll, look. A command that just puts words in the room is sending, not running, so /ooc and /shout say "Send" instead.
// Plus three optional gates, all read by commandsFor() below rather than
// Feed.js directly. `needsCharacter: true` marks a command as a BODY's verb,
// dropped from the GM seat. `gmOnly: true` is the opposite: kept off the list
// for anyone but a GM, and (unlike everything else) offered even when that GM
// plays nobody. Both are hints only, same as everything else here: the
// server action behind `run` re-checks on its own. `dialog: true` marks an
// entry that opens something with its own fields rather than taking composer
// input at all — no text argument, nothing to press Enter on.
// ./useComposerCommands.js#pickCommand runs it the instant it is picked
// instead of entering command mode; `args` stays empty and `run(values, ctx)`
// is called with `values: {}` to do the opening (see /decree below). Small
// and general on purpose, for whatever the next one like it turns out to be.
// This file is imported by a "use client" component, so it must never reach for @lifeweb/db — barring the zero-require modules written for exactly that (db/lib/sayLimits.js). Everything it calls is a server action from ./actions.

import {
  submitMove,
  toggleConceal,
  shoutHere,
  oocHere,
  rollHere,
  playHere,
  addMember,
  removeMember,
} from "./actions";
// The one exception to the rule above: db/lib/sayLimits.js has zero requires by
// design precisely so a client component may hold it (Feed.js does too).
import { MESSAGE_LIMIT } from "@lifeweb/db/lib/sayLimits";

// Same cap as the Discord option — this posts into a couple of dozen channels.
const SHOUT_LIMIT = 300;

// An OOC line reaches one place, so it takes ordinary speech's cap rather than
// the shout's.
const OOC_LIMIT = MESSAGE_LIMIT;

const EVERYWHERE = ["loc", "room", "conv", "zone", "net", "party"];

export const COMMANDS = [
  {
    name: "move",
    needsCharacter: true,
    description: "Lock in your Move for this turn.",
    where: EVERYWHERE,
    // No kind argument any more: a Move IS a Gambit (web/app/(app)/chat/MoveDialog.js).
    args: [{ name: "description", kind: "text", placeholder: "What you spend the day doing…" }],
    run: ({ description }) => submitMove({ moveKind: "GAMBIT", description }),
  },
  {
    name: "travel",
    needsCharacter: true,
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
    needsCharacter: true,
    description: "Conceal yourself.",
    where: EVERYWHERE,
    args: [],
    // The hood goes up and comes off here and nowhere else — the composer's
    // own button is gone. toggleConceal() revalidates nothing, so the refresh
    // is this call site's to make, or the box goes on calling itself by the
    // name it just stopped wearing.
    run: async (_values, ctx) => {
      const res = await toggleConceal();
      if (res?.ok) ctx.refresh?.();
      return res;
    },
  },
  {
    name: "shout",
    needsCharacter: true,
    description: "Yell. You'll be heard nearby.",
    verb: "Send",
    where: ["room", "conv"],
    // The @ menu opens inside this box. Only the two commands whose text argument is a line somebody SAYS
    // get it — a /move description or a /look target is not a place to mint a character chip. ./Feed.js
    // reads this flag; db/lib/shout.js folds the token it produces into the archive row.
    mentions: true,
    args: [{ name: "message", kind: "text", placeholder: "What you yell…", maxLength: SHOUT_LIMIT }],
    run: ({ message }, ctx) => shoutHere(message, ctx.placeKey),
  },
  {
    name: "ooc",
    description: "Say something out of character.",
    verb: "Send",
    // Wider than the three around it: a summary and a radio net take an OOC
    // line, because none of it is the character talking. See
    // db/lib/placeKey.js#isOocPlaceKey, which oocHere re-checks.
    where: ["room", "conv", "zone", "net", "party"],
    mentions: true, // see /shout above
    args: [{ name: "message", kind: "text", placeholder: "Out of character…", maxLength: OOC_LIMIT }],
    run: ({ message }, ctx) => oocHere(message, ctx.placeKey),
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
    name: "decree",
    description: "Proclaim something to a zone, as Ravenheart itself.",
    where: EVERYWHERE,
    gmOnly: true,
    // Opens the same dialog the desk's own Decree button used to
    // (web/app/(desk)/gm/turns/DecreeComposer.js) — title, words, and which
    // zones hear it, all collected there rather than in this box. Deliberately
    // web-only: a Discord modal cannot hold the zone picker alongside two text
    // fields, and Bascinet asked for this door specifically rather than the
    // Discord one, so there is no bot/src/lib/commands.js twin and none is
    // owed.
    dialog: true,
    args: [],
    run: (_values, ctx) => {
      ctx.openDecree?.();
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
//
// `gm` is the GM seat on /chat. Three things follow from it:
//
//   - An entry marked `gmOnly` — `/decree` — belongs to the GM seat alone and
//     needs no living character behind it at all (it addresses zones, not a
//     body — ADJUDICATION.md §3a), so it is the one thing still offered to a
//     GM who plays nobody, and hidden from anyone who isn't a GM regardless
//     of `hasCharacter`.
//   - The entries marked `needsCharacter` — a Move, a walk, the hood, a shout —
//     are things a BODY does somewhere, and doing them from a seat that is
//     watching every zone at once means nothing. They are dropped for a GM.
//   - Every other command still resolves a living character server-side
//     (actions.js#actor), so a gamemaster who plays nobody is offered NOTHING
//     beyond `gmOnly`. The alternative is a menu where each entry answers
//     "You have no living character", and a control that is offered and then
//     refused is a control that lied — the same reason the `where` gate
//     exists at all. A GM who also plays somebody gets the list, and acts as
//     them.
export function commandsFor(placeKind, { gm = false, hasCharacter = true } = {}) {
  if (!placeKind) return [];
  return COMMANDS.filter((entry) => {
    if (!entry.where.includes(placeKind)) return false;
    if (entry.gmOnly) return gm;
    if (!gm) return true;
    if (entry.needsCharacter) return false;
    return hasCharacter;
  });
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
