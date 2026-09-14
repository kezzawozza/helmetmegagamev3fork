// The pure core of "a GM changed something about this character", kept out of the Dev Panel's "use server"
// actions.js. Nothing here talks to Discord — the caller runs that REST half after the transaction commits (ARCHITECTURE.md §5).
import { isDynastyMember } from "@lifeweb/db";
import {
  NAME_LIMITS,
  AGE_MIN,
  AGE_MAX,
  formatCharacterName,
  formatBareName,
  normalizeHonorific,
  GENDERS,
} from "@/lib/characterName";
import {
  TagOpError,
  validateTagOps as validateTagOpsDb,
  applyTagOpsInTx as applyTagOpsInTxDb,
} from "@lifeweb/db/lib/tagOps";
import { clampMood } from "@lifeweb/db/lib/mood";
import { UserError } from "@/lib/actionResult";
import { dynastyLastName } from "@/lib/dynasty";

// Every field the panel may stage; this allowlist is the only way a posted `{ discordUserId: "..." }` can't reassign a character to a different account.
export const EDITABLE_FIELDS = [
  "honorific",
  "firstName",
  "title",
  "lastName",
  "gender",
  "age",
  "appearance",
  "roleId",
  "roleTitle",
  "factionId",
  "locationId",
  "isLeader",
  "isTreasurer",
  "resources",
  "tagPoints",
  "mood",
  "turnPingOptIn",
];

// `status` is deliberately NOT editable here — Kill and Revive are their own microactions.

function trimmedOrNull(value, limit) {
  if (value == null) return null;
  const text = value.toString().trim();
  if (!text) return null;
  return limit ? text.slice(0, limit) : text;
}

function intOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function bool(value) {
  return value === true || value === "true" || value === "on";
}

// Turns the raw posted `core` object into exactly the columns to write; async for two lookups (role dynasty-lock, living Baron's name).
export async function normalizeCoreEdits({ prisma, existing, core }) {
  const picked = {};
  for (const key of EDITABLE_FIELDS) {
    if (Object.hasOwn(core ?? {}, key)) picked[key] = core[key];
  }

  const data = {};

  // Length-capped like the player forms — the caps keep the composed name inside Discord's 80-character webhook username limit.
  if ("honorific" in picked) data.honorific = normalizeHonorific(picked.honorific);
  if ("firstName" in picked) {
    const first = trimmedOrNull(picked.firstName, NAME_LIMITS.firstName);
    if (!first) throw new UserError("A character needs a first name.");
    data.firstName = first;
  }
  if ("title" in picked) data.title = trimmedOrNull(picked.title, NAME_LIMITS.title);
  if ("lastName" in picked) data.lastName = trimmedOrNull(picked.lastName, NAME_LIMITS.lastName);

  // A GM may correct a gender freely; refused rather than defaulted since no picker upstream guarantees a valid value.
  if ("gender" in picked) {
    const value = (picked.gender ?? "").toString().trim();
    if (!GENDERS.includes(value)) throw new UserError("That isn't a gender.");
    data.gender = value;
  }

  // Deliberately NO roleCapacity() check — a GM hand-assigning a role overrides the seat cap.
  const roleId = "roleId" in picked ? trimmedOrNull(picked.roleId) : existing.roleId;
  const role = roleId ? await prisma.role.findUnique({ where: { id: roleId } }) : null;
  if (roleId && !role) throw new UserError("That role no longer exists.");
  if ("roleId" in picked) data.roleId = roleId;

  // Picking a Role restamps the display title from the catalog; roleTitle stays hand-editable for off-catalog cases.
  if ("roleId" in picked || "roleTitle" in picked) {
    data.roleTitle = role
      ? role.name
      : trimmedOrNull("roleTitle" in picked ? picked.roleTitle : existing.roleTitle);
  }

  if (isDynastyMember(role?.slug)) data.lastName = await dynastyLastName();

  // Character.name has a fixed set of writers, all through the formatter (schema.prisma); this is the GM one.
  const merged = {
    honorific: "honorific" in data ? data.honorific : existing.honorific,
    firstName: "firstName" in data ? data.firstName : existing.firstName,
    title: "title" in data ? data.title : existing.title,
    lastName: "lastName" in data ? data.lastName : existing.lastName,
  };
  data.name = formatCharacterName(merged);

  if ("age" in picked) {
    const age = intOrNull(picked.age);
    if (age != null && (age < AGE_MIN || age > AGE_MAX)) {
      throw new UserError(`Age must be between ${AGE_MIN} and ${AGE_MAX}.`);
    }
    // A GM may set or correct an age freely — the once-only lock is player-side, not a database one.
    data.age = age;
  }
  if ("appearance" in picked) data.appearance = trimmedOrNull(picked.appearance);

  if ("factionId" in picked) {
    const factionId = trimmedOrNull(picked.factionId);
    if (factionId) {
      const faction = await prisma.faction.findUnique({ where: { id: factionId } });
      if (!faction) throw new UserError("That faction no longer exists.");
    }
    data.factionId = factionId;
  }

  // zoneId is denormalized from locationId, so every writer writes both; the lookup below is the lock, not the GM picker.
  if ("locationId" in picked) {
    const locationId = trimmedOrNull(picked.locationId);
    if (locationId) {
      const location = await prisma.location.findUnique({ where: { id: locationId } });
      if (!location) throw new UserError("That location no longer exists.");
      data.locationId = locationId;
      data.zoneId = location.zoneId;
    } else {
      data.locationId = null;
      data.zoneId = null;
    }
  }

  if ("resources" in picked) data.resources = intOrNull(picked.resources) ?? 0;
  // The mood dial's own clamp (MOOD.md), so the rounding rule lives in one place.
  if ("mood" in picked) data.mood = clampMood(Number(picked.mood));
  // tagPoints is allowed to go negative on purpose (CHARACTERS.md) — clamping at 0 would let a broke player take a drawback's points for free.
  if ("tagPoints" in picked) data.tagPoints = intOrNull(picked.tagPoints) ?? 0;
  if ("isTreasurer" in picked) data.isTreasurer = bool(picked.isTreasurer);
  if ("turnPingOptIn" in picked) data.turnPingOptIn = bool(picked.turnPingOptIn);

  // isLeader is handled separately by setLeaderInTx — writing the boolean bare is how a faction ends up with two leaders.
  const leader = "isLeader" in picked ? bool(picked.isLeader) : null;

  return { data, role, leader };
}

// Key-by-key {from, to} over only the keys actually written. Drives the audit row and the Discord effect plan.
export function diffCore(existing, data) {
  const diff = {};
  for (const [key, to] of Object.entries(data)) {
    const from = existing[key] ?? null;
    const next = to ?? null;
    if (from instanceof Date ? from.getTime() !== next?.getTime?.() : from !== next) {
      diff[key] = { from, to: next };
    }
  }
  return diff;
}

// The clear-then-set pair out of faction/actions.js#setFactionLeader, shared so both surfaces agree on
// "exactly one leader". Keyed on the POST-EDIT faction, so a faction change demotes the right one.
export async function setLeaderInTx(tx, { characterId, factionId, isLeader }) {
  if (!isLeader) {
    await tx.character.update({ where: { id: characterId }, data: { isLeader: false } });
    return;
  }
  if (!factionId) throw new UserError("Only a member of a faction can lead it.");
  await tx.character.updateMany({
    where: { factionId, isLeader: true, id: { not: characterId } },
    data: { isLeader: false },
  });
  await tx.character.update({ where: { id: characterId }, data: { isLeader: true } });
}

// The engine lives in @lifeweb/db/lib/tagOps (db/ can't import web/); these wrappers translate its
// plain TagOpError into the UserError guarded() renders.

function rethrowForUser(err) {
  if (err instanceof TagOpError) throw new UserError(err.message);
  throw err;
}

export function validateTagOps(ops, tagsById, held) {
  try {
    validateTagOpsDb(ops, tagsById, held);
  } catch (err) {
    rethrowForUser(err);
  }
}

export async function applyTagOpsInTx(tx, args) {
  try {
    return await applyTagOpsInTxDb(tx, args);
  } catch (err) {
    rethrowForUser(err);
  }
}

// One plan object, built from the diff, executed in order after the transaction commits — written as a
// plan rather than independent `if` blocks so a dead character can't fall into a branch that re-grants channel access.
export function planDiscordEffects({ existing, diff, finalStatus, role, tagsTouched }) {
  if (finalStatus !== "ALIVE") return [];

  const steps = [];
  const nameChanged = Boolean(diff.name);
  const bareChanged =
    formatBareName(existing) !== formatBareName({ ...existing, ...unwrap(diff) });

  if (nameChanged || bareChanged || !existing.discordRoleId) steps.push("role");
  if (nameChanged) steps.push("nickname");
  if (diff.lastName && role) steps.push("dynasty");
  if (diff.locationId) steps.push("location");
  // A location change already reconciles narrowcast access in the shared fan-out; only a bare tag change needs this step.
  if (!diff.locationId && tagsTouched) steps.push("narrowcast");
  if (tagsTouched) steps.push("rooms");

  return steps;
}

function unwrap(diff) {
  return Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to]));
}
