"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { UserError, guarded } from "@/lib/actionResult";
import { requireDev } from "@/lib/devAccess";
import { validateNewSlug, validateUniqueName } from "@lifeweb/db/lib/placeValidation";
import { retirePlace, unretirePlace, hardDeleteBlockers, hardDeletePlace } from "@lifeweb/db/lib/placeDeletable";
import { enqueueMirror } from "@lifeweb/db/lib/discordMirror/queue";

// /gm/dev/zones — the GM place editor. Every writer here re-validates
// everything server-side (a disabled button is a hint, not a lock), writes
// one AuditLog row, enqueues the touched place for the mirror, and revalidates
// the pages that show it. See db/lib/placeValidation.js and
// db/lib/placeDeletable.js for the rules this only calls.

async function requireGmSession() {
  // A plain GM may edit; only a superadmin may retire/hard-delete/seed
  // (checked at each call site with requireDev("super")).
  return requireDev("gm");
}

async function audit(session, actionType, details) {
  await prisma.auditLog.create({
    data: { actorDiscordUserId: session.discordUserId, actionType, details },
  });
}

function revalidateZonesTree() {
  revalidatePath("/gm/dev/zones");
}

function trimmed(v) {
  return (v ?? "").toString().trim();
}

function optionalInt(raw, label) {
  if (raw === "" || raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) throw new UserError(`${label} must be a whole number.`);
  return n;
}

function parseMapPolygon(raw) {
  const text = trimmed(raw);
  if (!text) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UserError("Map polygon must be valid JSON — a list of [x, y] pairs.");
  }
  if (!Array.isArray(value) || !value.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && n >= 0 && n <= 100))) {
    throw new UserError("Map polygon must be a list of [x, y] pairs, each 0-100.");
  }
  return value;
}

// Every save posts `updatedAt` back; a stale write (someone else changed the
// row since this form loaded) is refused rather than clobbering their edit.
async function claimRow(model, id, updatedAtRaw, data) {
  const updatedAt = updatedAtRaw ? new Date(updatedAtRaw) : null;
  const where = updatedAt ? { id, updatedAt } : { id };
  const { count } = await model.updateMany({ where, data });
  if (count === 0) throw new UserError("Someone else changed this; reload and try again.");
  return model.findUnique({ where: { id } });
}

// ---------------------------------------------------------------- Zone ----

export async function createZone(input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const slug = trimmed(input.slug).toLowerCase();
    const slugError = await validateNewSlug(prisma, slug);
    if (slugError) throw new UserError(slugError);
    const nameError = await validateUniqueName(prisma, "zone", input.name);
    if (nameError) throw new UserError(nameError);
    const kind = input.kind === "CAVE_GROUP" || input.kind === "CAVE_LEVEL" ? input.kind : "SURFACE";

    const zone = await prisma.zone.create({
      data: {
        slug,
        name: trimmed(input.name),
        kind,
        sortOrder: optionalInt(input.sortOrder, "Sort order"),
        description: trimmed(input.description),
      },
    });
    await audit(session, "gm_zone_created", { zoneId: zone.id, slug, name: zone.name });
    await enqueueMirror(prisma, "zone", zone.id, "created from /gm/dev/zones");
    revalidateZonesTree();
    return { zoneId: zone.id };
  });
}

export async function updateZone(zoneId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const name = trimmed(input.name);
    const nameError = await validateUniqueName(prisma, "zone", name, { excludeId: zoneId });
    if (nameError) throw new UserError(nameError);
    const kind = input.kind === "CAVE_GROUP" || input.kind === "CAVE_LEVEL" ? input.kind : "SURFACE";
    const mapPolygon = parseMapPolygon(input.mapPolygon);
    const mapLabelX = input.mapLabelX === "" || input.mapLabelX == null ? null : Number.parseFloat(input.mapLabelX);
    const mapLabelY = input.mapLabelY === "" || input.mapLabelY == null ? null : Number.parseFloat(input.mapLabelY);

    const before = await prisma.zone.findUnique({ where: { id: zoneId } });
    if (!before) throw new UserError("That zone no longer exists.");
    const renamed = before.name !== name;

    await claimRow(prisma.zone, zoneId, updatedAt, {
      name,
      kind,
      sortOrder: optionalInt(input.sortOrder, "Sort order"),
      description: trimmed(input.description),
      mapPolygon: mapPolygon ?? undefined,
      mapLabelX,
      mapLabelY,
    });
    await audit(session, "gm_zone_updated", { zoneId, name, renamed, from: before.name });
    await enqueueMirror(prisma, "zone", zoneId, renamed ? "renamed from /gm/dev/zones" : "edited from /gm/dev/zones");
    revalidateZonesTree();
  });
}

export async function reorderZone(zoneId, direction) {
  return guarded(async () => {
    const session = await requireGmSession();
    const zones = await prisma.zone.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const idx = zones.findIndex((z) => z.id === zoneId);
    if (idx === -1) throw new UserError("That zone no longer exists.");
    const otherIdx = direction === "up" ? idx - 1 : idx + 1;
    if (otherIdx < 0 || otherIdx >= zones.length) return;
    const a = zones[idx];
    const b = zones[otherIdx];
    await prisma.$transaction([
      prisma.zone.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
      prisma.zone.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
    ]);
    await audit(session, "gm_zone_reordered", { zoneId: a.id, swappedWith: b.id });
    revalidateZonesTree();
  });
}

export async function retireZone(zoneId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await retirePlace(prisma, "zone", zoneId);
    if (!result.ok) throw new UserError(result.error);
    await audit(session, "gm_zone_retired", { zoneId });
    revalidateZonesTree();
  });
}

export async function unretireZone(zoneId) {
  return guarded(async () => {
    const session = await requireDev("super");
    await unretirePlace(prisma, "zone", zoneId);
    await audit(session, "gm_zone_unretired", { zoneId });
    revalidateZonesTree();
  });
}

export async function zoneDeleteBlockers(zoneId) {
  return hardDeleteBlockers(prisma, "zone", zoneId);
}

export async function hardDeleteZone(zoneId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await hardDeletePlace(prisma, "zone", zoneId);
    if (!result.ok) throw new UserError(`Can't delete: ${result.blockers.join("; ")}.`);
    await audit(session, "gm_zone_deleted", { zoneId });
    revalidateZonesTree();
  });
}

// ------------------------------------------------------------ Location ----

export async function createLocation(zoneId, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const slug = trimmed(input.slug).toLowerCase();
    const slugError = await validateNewSlug(prisma, slug);
    if (slugError) throw new UserError(slugError);
    const nameError = await validateUniqueName(prisma, "location", input.name);
    if (nameError) throw new UserError(nameError);

    const location = await prisma.location.create({
      data: {
        slug,
        name: trimmed(input.name),
        zoneId,
        indoors: Boolean(input.indoors),
        sortOrder: optionalInt(input.sortOrder, "Sort order"),
        description: trimmed(input.description),
      },
    });
    await audit(session, "gm_location_created", { locationId: location.id, zoneId, slug, name: location.name });
    await enqueueMirror(prisma, "location", location.id, "created from /gm/dev/zones");
    revalidatePath(`/gm/dev/zones/${zoneId}`);
    return { locationId: location.id };
  });
}

export async function updateLocation(locationId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const name = trimmed(input.name);
    const nameError = await validateUniqueName(prisma, "location", name, { excludeId: locationId });
    if (nameError) throw new UserError(nameError);

    const before = await prisma.location.findUnique({ where: { id: locationId } });
    if (!before) throw new UserError("That location no longer exists.");
    const renamed = before.name !== name;

    await claimRow(prisma.location, locationId, updatedAt, {
      name,
      indoors: Boolean(input.indoors),
      sortOrder: optionalInt(input.sortOrder, "Sort order"),
      description: trimmed(input.description),
    });
    await audit(session, "gm_location_updated", { locationId, name, renamed, from: before.name });
    await enqueueMirror(prisma, "location", locationId, renamed ? "renamed from /gm/dev/zones" : "edited from /gm/dev/zones");
    revalidatePath(`/gm/dev/zones/locations/${locationId}`);
    revalidatePath(`/gm/dev/zones/${before.zoneId}`);
  });
}

export async function updateLocationYield(locationId, kind, base) {
  return guarded(async () => {
    const session = await requireGmSession();
    const value = Number.parseFloat(base);
    if (!Number.isFinite(value) || value < 0) throw new UserError("Yield base must be a number of at least 0.");
    const existing = await prisma.locationYield.findUnique({ where: { locationId_kind: { locationId, kind } } });
    if (existing) {
      await prisma.locationYield.update({ where: { id: existing.id }, data: { base: value } });
    } else {
      await prisma.locationYield.create({ data: { locationId, kind, base: value, current: value } });
    }
    await audit(session, "gm_location_yield_updated", { locationId, kind, base: value });
    revalidatePath(`/gm/dev/zones/locations/${locationId}`);
  });
}

export async function reorderLocation(zoneId, locationId, direction) {
  return guarded(async () => {
    const session = await requireGmSession();
    const locations = await prisma.location.findMany({ where: { zoneId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const idx = locations.findIndex((l) => l.id === locationId);
    if (idx === -1) throw new UserError("That location no longer exists.");
    const otherIdx = direction === "up" ? idx - 1 : idx + 1;
    if (otherIdx < 0 || otherIdx >= locations.length) return;
    const a = locations[idx];
    const b = locations[otherIdx];
    await prisma.$transaction([
      prisma.location.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
      prisma.location.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
    ]);
    await audit(session, "gm_location_reordered", { locationId: a.id, swappedWith: b.id });
    revalidatePath(`/gm/dev/zones/${zoneId}`);
  });
}

export async function retireLocation(locationId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await retirePlace(prisma, "location", locationId);
    if (!result.ok) throw new UserError(result.error);
    await audit(session, "gm_location_retired", { locationId });
    revalidateZonesTree();
  });
}

export async function unretireLocation(locationId) {
  return guarded(async () => {
    const session = await requireDev("super");
    await unretirePlace(prisma, "location", locationId);
    await audit(session, "gm_location_unretired", { locationId });
    revalidateZonesTree();
  });
}

export async function locationDeleteBlockers(locationId) {
  return hardDeleteBlockers(prisma, "location", locationId);
}

export async function hardDeleteLocation(locationId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await hardDeletePlace(prisma, "location", locationId);
    if (!result.ok) throw new UserError(`Can't delete: ${result.blockers.join("; ")}.`);
    await audit(session, "gm_location_deleted", { locationId });
    revalidateZonesTree();
  });
}

// ---------------------------------------------------------------- Room ----

export async function createRoom(locationId, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const slug = trimmed(input.slug).toLowerCase();
    const slugError = await validateNewSlug(prisma, slug);
    if (slugError) throw new UserError(slugError);
    const nameError = await validateUniqueName(prisma, "room", input.name, { locationId });
    if (nameError) throw new UserError(nameError);
    const kind = input.kind === "PRIVATE" ? "PRIVATE" : "PUBLIC";

    const room = await prisma.room.create({
      data: {
        slug,
        name: trimmed(input.name),
        locationId,
        kind,
        sortOrder: optionalInt(input.sortOrder, "Sort order"),
        description: trimmed(input.description),
        soundproof: Boolean(input.soundproof),
        destroysContents: Boolean(input.destroysContents),
      },
    });
    await audit(session, "gm_room_created", { roomId: room.id, locationId, slug, name: room.name });
    await enqueueMirror(prisma, "room", room.id, "created from /gm/dev/zones");
    revalidatePath(`/gm/dev/zones/locations/${locationId}`);
    return { roomId: room.id };
  });
}

export async function updateRoom(roomId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const before = await prisma.room.findUnique({ where: { id: roomId } });
    if (!before) throw new UserError("That room no longer exists.");
    const name = trimmed(input.name);
    const nameError = await validateUniqueName(prisma, "room", name, { locationId: before.locationId, excludeId: roomId });
    if (nameError) throw new UserError(nameError);
    const renamed = before.name !== name;
    const kind = input.kind === "PRIVATE" ? "PRIVATE" : "PUBLIC";

    await claimRow(prisma.room, roomId, updatedAt, {
      name,
      kind,
      sortOrder: optionalInt(input.sortOrder, "Sort order"),
      description: trimmed(input.description),
      soundproof: Boolean(input.soundproof),
      destroysContents: Boolean(input.destroysContents),
      accessTagSlugs: kind === "PRIVATE" ? String(input.accessTagSlugs ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [],
    });
    await audit(session, "gm_room_updated", { roomId, name, renamed, from: before.name });
    await enqueueMirror(prisma, "room", roomId, renamed ? "renamed from /gm/dev/zones" : "edited from /gm/dev/zones");
    revalidatePath(`/gm/dev/zones/rooms/${roomId}`);
  });
}

export async function retireRoom(roomId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await retirePlace(prisma, "room", roomId);
    if (!result.ok) throw new UserError(result.error);
    await audit(session, "gm_room_retired", { roomId });
    revalidateZonesTree();
  });
}

export async function unretireRoom(roomId) {
  return guarded(async () => {
    const session = await requireDev("super");
    await unretirePlace(prisma, "room", roomId);
    await audit(session, "gm_room_unretired", { roomId });
    revalidateZonesTree();
  });
}

export async function roomDeleteBlockers(roomId) {
  return hardDeleteBlockers(prisma, "room", roomId);
}

export async function hardDeleteRoom(roomId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const result = await hardDeletePlace(prisma, "room", roomId);
    if (!result.ok) throw new UserError(`Can't delete: ${result.blockers.join("; ")}.`);
    await audit(session, "gm_room_deleted", { roomId });
    revalidateZonesTree();
  });
}

// "Seed these items now" — writes RoomTag rows and appends to
// seededStashSlugs, the same guard seedRoomStash uses so a re-run (or the
// eventual db:import-zones) can never refill a slug players already emptied.
export async function seedRoomStash(roomId, text) {
  return guarded(async () => {
    const session = await requireDev("super");
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new UserError("That room no longer exists.");

    const lines = String(text ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const wanted = [];
    for (const line of lines) {
      const [slugPart, countPart] = line.split(":").map((p) => p?.trim());
      if (!slugPart) continue;
      const quantity = countPart ? Number.parseInt(countPart, 10) : 1;
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new UserError(`"${line}" — count must be a whole number of at least 1.`);
      }
      wanted.push([slugPart, quantity]);
    }
    if (wanted.length === 0) throw new UserError("Nothing to seed — write one \"slug: count\" per line.");

    const already = new Set(room.seededStashSlugs ?? []);
    const toSeed = wanted.filter(([slug]) => !already.has(slug));
    if (toSeed.length === 0) return { seeded: 0 };

    const tags = await prisma.tag.findMany({ where: { slug: { in: toSeed.map(([slug]) => slug) } } });
    const bySlug = new Map(tags.map((t) => [t.slug, t]));
    const missing = toSeed.filter(([slug]) => !bySlug.has(slug)).map(([slug]) => slug);
    if (missing.length) throw new UserError(`Unknown tag slug${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);

    await prisma.$transaction([
      ...toSeed.map(([slug, quantity]) =>
        prisma.roomTag.upsert({
          where: { roomId_tagId: { roomId, tagId: bySlug.get(slug).id } },
          update: { quantity: { increment: quantity } },
          create: { roomId, tagId: bySlug.get(slug).id, quantity },
        }),
      ),
      prisma.room.update({
        where: { id: roomId },
        data: { seededStashSlugs: [...already, ...toSeed.map(([slug]) => slug)] },
      }),
    ]);
    await audit(session, "gm_room_stash_seeded", { roomId, slugs: toSeed.map(([slug, q]) => `${slug}:${q}`) });
    revalidatePath(`/gm/dev/zones/rooms/${roomId}`);
    return { seeded: toSeed.length };
  });
}

// ------------------------------------------------------------- Links ----

export async function createLink(input) {
  return guarded(async () => {
    const session = await requireGmSession();
    const aId = trimmed(input.aId);
    const bId = trimmed(input.bId);
    if (!aId || !bId || aId === bId) throw new UserError("Pick two different locations.");
    const [a, b] = await Promise.all([
      prisma.location.findUnique({ where: { id: aId } }),
      prisma.location.findUnique({ where: { id: bId } }),
    ]);
    if (!a || !b) throw new UserError("One of those locations no longer exists.");
    // Held in slug order, same convention db:sync-zones used, so an edge can
    // never disagree between the two directions.
    const [loId, hiId] = a.slug < b.slug ? [aId, bId] : [bId, aId];

    const link = await prisma.locationLink.create({
      data: {
        aId: loId,
        bId: hiId,
        announce: ["NONE", "TRUE_NAME", "CONCEALED"].includes(input.announce) ? input.announce : "NONE",
        hidden: Boolean(input.hidden),
        modular: Boolean(input.modular),
        keyed: Boolean(input.keyed),
        onFoot: Boolean(input.onFoot),
        requiredTagSlug: trimmed(input.requiredTagSlug) || null,
        authoredOpen: input.modular ? Boolean(input.authoredOpen) : true,
        isOpen: input.modular ? Boolean(input.authoredOpen) : true,
      },
    });
    await audit(session, "gm_link_created", { linkId: link.id, aId: loId, bId: hiId });
    await enqueueMirror(prisma, "location", loId, "link created from /gm/dev/zones");
    await enqueueMirror(prisma, "location", hiId, "link created from /gm/dev/zones");
    revalidatePath("/gm/dev/zones/links");
  });
}

export async function updateLink(linkId, updatedAt, input) {
  return guarded(async () => {
    const session = await requireGmSession();
    await claimRow(prisma.locationLink, linkId, updatedAt, {
      announce: ["NONE", "TRUE_NAME", "CONCEALED"].includes(input.announce) ? input.announce : "NONE",
      hidden: Boolean(input.hidden),
      modular: Boolean(input.modular),
      keyed: Boolean(input.keyed),
      onFoot: Boolean(input.onFoot),
      requiredTagSlug: trimmed(input.requiredTagSlug) || null,
      authoredOpen: input.modular ? Boolean(input.authoredOpen) : true,
    });
    await audit(session, "gm_link_updated", { linkId });
    revalidatePath("/gm/dev/zones/links");
  });
}

export async function deleteLink(linkId) {
  return guarded(async () => {
    const session = await requireDev("super");
    const link = await prisma.locationLink.findUnique({ where: { id: linkId } });
    if (!link) return;
    await prisma.locationLink.delete({ where: { id: linkId } });
    await audit(session, "gm_link_deleted", { linkId, aId: link.aId, bId: link.bId });
    revalidatePath("/gm/dev/zones/links");
  });
}
