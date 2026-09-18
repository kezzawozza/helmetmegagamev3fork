"use server";

import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { guarded } from "@/lib/actionResult";
import { moveKindLabel } from "@/lib/moves";
import { placesFor } from "@lifeweb/db/lib/feedAccess";
import { whosHere } from "@lifeweb/db/lib/whosHere";

// Everything ⌘K can jump to, in one payload. Fetched on first open and held
// client-side for a minute rather than shipped with every page — a hundred
// characters plus a turn's queue is small, but it is not free, and most page
// views never open the palette.
//
// A non-GM gets pages only. The GM branches below are all re-gated in the
// pages they lead to; this is presentation, and those are enforcement.

const GENERIC_PAGES = [
  { label: "Character", href: "/character" },
  { label: "Notes", href: "/notes" },
  { label: "Documents", href: "/documents" },
  { label: "Archive", href: "/archive" },
];

// The GM screens with no rail item at all. Today these are reachable only by
// knowing the URL or by hunting through a hand-rolled sub-nav on some other
// page, which is most of the reason the palette exists.
// What a place row says it is. Short on purpose: the label is the name, and
// this is only what tells a room from the conversation named after it.
const PLACE_HINTS = {
  loc: "the street",
  room: "room",
  conv: "conversation",
  zone: "summary",
  net: "radio",
};

const GM_PAGES = [
  { label: "Oracle", href: "/gm/oracle" },
  { label: "Players", href: "/gm/players" },
  { label: "Adjudicate", href: "/gm/turns" },
  { label: "Structures", href: "/gm/structures" },
  { label: "Dev panel", href: "/gm/dev" },
  { label: "Dev · Characters", href: "/gm/dev?s=characters" },
  { label: "Dev · Tags", href: "/gm/dev?s=tags" },
  { label: "Dev · Zones", href: "/gm/dev?s=zones" },
  { label: "Dev · Bulk actions", href: "/gm/dev?s=bulk" },
  { label: "Dev · Say something", href: "/gm/dev?s=bulk&verb=say" },
  { label: "Gamemasters", href: "/gm/dev?s=gamemasters" },
  { label: "Audit log", href: "/gm/audit" },
  { label: "Lifeweb", href: "/lifeweb" },
];


async function getPaletteIndexImpl() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) return { entries: [] };

  // /gm/audit used to be filtered out here for everyone but the superadmin.
  // Every GM reads the log now, so the whole GM page list goes through.
  const pages = gm ? [...GM_PAGES, ...GENERIC_PAGES] : GENERIC_PAGES;

  const entries = pages.map((p) => ({
    kind: "page",
    id: p.href,
    label: p.label,
    hint: p.href,
    href: p.href,
  }));

  // A PLAYER's half: everywhere they can hear, and everyone standing beside
  // them. Both come from the same functions Chat itself uses
  // (db/lib/feedAccess.js#placesFor, db/lib/whosHere.js), so the palette can
  // never offer a place they may not read or name somebody the room has not
  // shown them — a hood is deliberately absent, exactly as it is from the
  // composer's @ list.
  //
  // A GM has no character, so this is skipped for them entirely; their own
  // branch below is untouched.
  const [character, config] = await Promise.all([
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      select: { id: true, name: true, locationId: true },
    }),
    // Every entry below links into /chat, so none is offered while Chat
    // is switched off (GameConfig.playPanelEnabled).
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { playPanelEnabled: true } }),
  ]);
  const playEnabled = config?.playPanelEnabled ?? true;

  if (playEnabled && character?.locationId) {
    const places = await placesFor(prisma, character, { gm: false, discordUserId: session.discordUserId });
    for (const place of places) {
      entries.push({
        kind: "place",
        id: place.placeKey,
        label: place.name,
        hint: PLACE_HINTS[place.kind] ?? "here",
        // Chat reads the open place off the URL hash (CHAT.md §5), so a
        // link into one is the hash and nothing else — no new client
        // plumbing, and Back leaves the room the way it came.
        href: `/chat#${encodeURIComponent(place.placeKey)}`,
      });
    }

    // Everyone in the street. The href is the LOCATION, not a person: /chat
    // has no route for "open this person's menu", and taking somebody to
    // where that person is standing is the whole of what was being asked
    // for.
    const locationKey = `loc:${character.locationId}`;
    const here = await whosHere(prisma, character, { includeSelf: false });
    for (const person of here.named) {
      entries.push({
        kind: "person",
        id: person.characterId,
        label: person.name,
        hint: `${person.roleTitle ? `${person.roleTitle} · ` : ""}here`,
        href: `/chat#${encodeURIComponent(locationKey)}`,
      });
    }
  }

  if (!gm) return { entries };

  const openTurn = await getOpenTurn();
  const [characters, actions, zones, guildMembers] = await Promise.all([
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: {
        id: true,
        name: true,
        status: true,
        discordUserId: true,
        roleTitle: true,
        zone: { select: { name: true } },
      },
      take: 1000,
    }),
    openTurn
      ? prisma.action.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            description: true,
            moveKind: true,
            gmNotes: true,
            character: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.zone.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listGuildMembers(),
  ]);

  const memberById = new Map(guildMembers.map((m) => [m.id, m]));

  for (const c of characters) {
    const member = memberById.get(c.discordUserId);
    entries.push({
      kind: "player",
      id: c.id,
      label: c.name,
      hint: [c.roleTitle, c.zone?.name].filter(Boolean).join(" · "),
      dim: c.status !== "ALIVE",
      href: `/gm/players/${c.discordUserId}`,
      search: {
        role: c.roleTitle ?? "",
        zone: c.zone?.name ?? "",
        username: [member?.username, member?.globalName].filter(Boolean).join(" "),
      },
    });
    // "What has been done to this person" is a question the palette can answer
    // in one keystroke now that the audit log takes a target filter in its URL.
    if (gm) {
      entries.push({
        kind: "page",
        id: `audit:${c.id}`,
        label: `Audit: about ${c.name}`,
        hint: "audit log",
        dim: c.status !== "ALIVE",
        href: `/gm/audit?target=${c.id}`,
      });
    }
    // And the other direction, for a player who has one — a GM's own "by"
    // entry rides the GM roster instead, which the palette does not carry.
    if (gm && c.discordUserId) {
      entries.push({
        kind: "page",
        id: `auditby:${c.discordUserId}`,
        label: `Audit: by ${c.name}`,
        hint: "audit log",
        dim: c.status !== "ALIVE",
        href: `/gm/audit?actor=${c.discordUserId}`,
      });
    }
  }

  for (const a of actions) {
    entries.push({
      kind: "move",
      id: a.id,
      label: `${a.character?.name ?? "(deleted)"} — ${moveKindLabel(a.moveKind, a.gmNotes)}`,
      hint: a.description ?? "",
      href: `/gm/turns?sel=move/${a.id}`,
      search: { preview: a.description ?? "" },
    });
  }

  return { entries };
}

export async function getPaletteIndex() {
  return guarded(() => getPaletteIndexImpl());
}
