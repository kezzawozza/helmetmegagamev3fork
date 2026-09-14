"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  prisma,
  roleCapacity,
  isDynastyHead,
  isDynastyMember,
  normalizeAntagonistSlugs,
  parseStartingTag,
  isMerchantRole,
  setMerchantFace,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { dynastyLastName, propagateDynastyLastName } from "@/lib/dynasty";
import { isSuperadmin } from "@/lib/superadmin";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { readGameState, effectivePlayerCount } from "@lifeweb/db/lib/gameState";
import { setMerchantSeal } from "@lifeweb/db/lib/merchantSeal";
import { applyLocationMoveSideEffects } from "@lifeweb/db/lib/locationMove";
import { seedMemories } from "@lifeweb/db/lib/locationVisits";
import { startingMemorySlugs } from "@lifeweb/db/lib/startingMemories";
import {
  isWanted,
  postWantedPosters,
  isDebtor,
  postDebtorNotices,
  DEBTOR_STARTING_OBOLS,
} from "@lifeweb/db/lib/wantedPoster";
import { addToStack } from "@lifeweb/db/lib/tagWrites";
import { OBOL_SLUG } from "@lifeweb/db/lib/depotState";
import {
  syncCharacterNickname,
  ensureCharacterRole,
  syncCharacterNarrowcastAccess,
  getGuildMember,
  isLeaderWhitelisted,
  isGm,
  onRoster,
  removeGhostRole,
} from "@/lib/discordGuild";
import { isPlayerCursed } from "@lifeweb/db/lib/curse";
import {
  computeBudget,
  isSpawnOnly,
  isRoleSelectable,
  tagsById as buildTagsById,
  effectiveTotalCost,
  negativeTagCount,
  negativeTagPoints,
  DEFAULT_MAX_DRAWBACK_TAGS,
  DEFAULT_MAX_DRAWBACK_POINTS,
  chainSiblingsToRemove,
  heldHigherTiers,
  requirementSatisfied,
  exclusiveConflict,
  conflictingTag,
  roleExcluded,
  CURSED_ROLE_SLUGS,
  COMMONER_KIT_SLUGS,
  DEFAULT_COMMONER_KIT_SLUG,
  LABORING_SPECIALISATION_SLUGS,
} from "@/lib/characterCreation";

import { reserveRole, releaseRole } from "@lifeweb/db/lib/roleReservation";
import { heldSeats } from "@lifeweb/db/lib/seatCount";
import { settleLobbyEntry } from "@lifeweb/db/lib/lobby";
import { recordArchiveEvent } from "@/lib/archive";
import {
  AGE_MIN,
  AGE_MAX,
  NAME_LIMITS,
  formatCharacterName,
  formatBareName,
  normalizeEarnedHonorific,
  GENDERS,
} from "@/lib/characterName";

// When somebody may make a character at all (LOBBY.md §1): while the game
// runs or has ended, or — for a GM — in any phase (the lobby's Skip button).
// A playtester does NOT skip ahead here — their bypass is the roster check below.
function creationOpen(phase, member) {
  if (phase === "RUNNING" || phase === "ENDED") return true;
  return isGm(member);
}

// Creates a character from the wizard's Confirm step. Everything posted is
// re-derived and re-checked. The seat-cap recheck closes a real race (Prisma
// READ COMMITTED); the `FOR UPDATE` row lock on Role actually serializes it.
export async function createCharacter(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const discordUserId = session.discordUserId;

  const part = (key, limit) => formData.get(key)?.toString().trim().slice(0, limit) || null;
  // `title` is GM-granted only — not read here.
  const rawHonorific = formData.get("honorific");
  const postedGender = formData.get("gender")?.toString();
  const gender = GENDERS.includes(postedGender) ? postedGender : "NEUTRAL"; // closed enum, junk lands as NEUTRAL
  const firstName = part("firstName", NAME_LIMITS.firstName);
  let lastName = part("lastName", NAME_LIMITS.lastName); // not const: a locked-seat role overwrites this below
  const rawAge = Number.parseInt(formData.get("age")?.toString() ?? "", 10);
  const age =
    Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;
  const postedWebOnly = formData.get("webOnly") === "on"; // gated against GameConfig.playPanelEnabled once config is loaded
  const postedRoleId = formData.get("roleId")?.toString();
  const tagIds = formData.getAll("tagIds").map((t) => t.toString()).filter(Boolean);
  // Consent for secretly-assigned antagonist seats; normalizeAntagonistSlugs
  // keeps junk slugs out. Whitelisted boxes are dropped below.
  const postedOptIns = formData.getAll("antagonistOptIns");

  if (!firstName) return { error: "Your character needs a first name." };
  // One word each — the wizard gates this too, but the form can be hand-posted.
  if (/\s/.test(firstName) || /\s/.test(lastName ?? "")) {
    return { error: "First and last names are one word each." };
  }

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    redirect("/character");
  }

  // A seat from the roll, inside its window, is the role regardless of what
  // was posted (LOBBY.md §4). Whitelist and Cursed gates are skipped for
  // it. An entry whose role has since left the catalog is no assignment at
  // all — treating it as one would lift the gates below for the form's role.
  const assignedEntry = await prisma.lobbyEntry
    .findFirst({
      where: { discordUserId, status: "ASSIGNED", expiresAt: { gt: new Date() }, assignedRoleId: { not: null } },
      select: { id: true, assignedRoleId: true },
    });
  const roleId = assignedEntry?.assignedRoleId ?? postedRoleId;
  if (!roleId) return { error: "Pick a role before confirming." };

  const [role, config, state, member, openTurn, cursed] = await Promise.all([
    prisma.role.findUnique({
      where: { id: roleId },
      include: {
        faction: { include: { zone: true } },
        startingZone: true,
        startingLocation: { include: { zone: true } },
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma),
    getGuildMember(discordUserId, 0), // always fresh: a gate must not refuse on a stale roles list
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
    // A database question now, not a Discord role (db/lib/curse.js). Read
    // here rather than inside the transaction below, which would always answer no once the ALIVE row exists.
    isPlayerCursed(prisma, discordUserId),
  ]);
  if (!role) return { error: "That role no longer exists." };

  // Launch gate: the game running (or ended) AND this member approved — the
  // real enforcement boundary, not the wizard's UI. Superadmin bypasses both.
  const bypass = isSuperadmin(discordUserId);
  if (!bypass && !creationOpen(state?.phase, member)) {
    return { error: "Ravenheart isn't open yet. Character creation opens when the game begins." };
  }
  if (!bypass && !onRoster(member, { playtestMode: config?.playtestModeEnabled === true })) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }

  // Never pickable — the picker not listing these is a hint, not a lock.
  if (isSpawnOnly(role)) {
    return assignedEntry
      ? { error: "Your assigned seat can only be spawned by a GM." }
      : { error: "That role isn't open to anyone." };
  }

  // Split so each rejection gets its own message.
  const leaderWhitelisted = bypass || isLeaderWhitelisted(member);
  if (!assignedEntry && role.requiresWhitelist && !leaderWhitelisted) {
    return { error: "That role isn't available to you." };
  }

  if (!assignedEntry && !isRoleSelectable({ role, cursed, leaderWhitelisted })) {
    return { error: `While cursed you may only return as ${CURSED_ROLE_SLUGS.join(" or ")}.` };
  }

  const antagonistOptIns = normalizeAntagonistSlugs(postedOptIns, { whitelisted: leaderWhitelisted });

  // Dynasty seats wear the Baron's last name, never what was typed. Null until a Baron exists.
  if (isDynastyMember(role.slug)) lastName = await dynastyLastName();
  const effectiveGender = role.lockedGender ?? gender; // dynasty seats fix gender too

  // Selected tags must actually be buyable — a hand-posted request could
  // otherwise name a 0-cost non-purchasable tag or a mastery tag the wizard
  // never offered. Both fall out of the count check below.
  const selected = tagIds.length
    ? await prisma.tag.findMany({
        where: { id: { in: tagIds }, purchasable: true, mastery: false },
        include: { group: { select: { requiredTagId: true } } }, // the hidden-category gate requirementSatisfied() checks below
      })
    : [];
  if (selected.length !== tagIds.length) {
    return { error: "One of those tags isn't available for purchase." };
  }

  // Role tags come from the catalog by SLUG (Role.startingTagSlugs, resolved
  // by db:sync-roles). An entry may carry a count — "obol x5" — parsed out
  // for lookup and kept beside it, since a `slug: { in: [...] }` set lookup
  // would collapse a repeated slug. See db/lib/startingTags.js.
  const startingWanted = new Map();
  for (const entry of role.startingTagSlugs) {
    const { slug, quantity } = parseStartingTag(entry);
    startingWanted.set(slug, (startingWanted.get(slug) ?? 0) + quantity);
  }
  const startingTags = startingWanted.size
    ? await prisma.tag.findMany({ where: { slug: { in: [...startingWanted.keys()] } } })
    : [];

  // A word this character has no claim to lands as null, not a failed create.
  const honorific = normalizeEarnedHonorific(rawHonorific, {
    tagSlugs: [...selected, ...startingTags].map((t) => t.slug),
    roleSlug: role.slug,
    gender: effectiveGender,
  });
  const name = formatCharacterName({ honorific, firstName, title: null, lastName });

  // The full catalog, not just what's selected/granted, so a chain walk
  // (parentTagId) never dead-ends on an ancestor the client didn't send.
  const allTags = await prisma.tag.findMany({
    select: {
      id: true,
      name: true,
      pointCost: true,
      parentTagId: true,
      requiredTagId: true,
      exclusive: true,
      groupId: true,
      conflictsWith: { select: { id: true } },
    },
  });
  const byId = buildTagsById(
    allTags.map((t) => ({ ...t, conflictsWithIds: t.conflictsWith.map((c) => c.id) })),
  );
  const grantedIds = startingTags.map((t) => t.id);

  // Guards against submitting two chain tiers at once, or a tier below one the role already grants.
  for (const tag of selected) {
    if (chainSiblingsToRemove(tag, byId, tagIds).length > 0) {
      return { error: "You can only hold one tier of the same skill chain." };
    }
    if (heldHigherTiers(tag, byId, grantedIds).length > 0) {
      return { error: "Your role already grants a higher tier of that skill chain." };
    }
  }

  // Seats that may never hold a tag at all (Tag.excludedRoleSlugs) — the menu drops these rows entirely.
  for (const tag of selected) {
    if (roleExcluded(tag, role.slug)) {
      return { error: `A ${role.name} can't take ${tag.name}.` };
    }
  }

  // Prerequisites: requiredTag plus the hidden-category group gate must be satisfied by something granted or selected.
  const heldOrSelectedIds = [...grantedIds, ...tagIds];
  for (const tag of selected) {
    if (!requirementSatisfied(tag, byId, heldOrSelectedIds)) {
      return { error: "One of those tags is missing a prerequisite." };
    }
  }

  // One exclusive Belief per character — checked against role-granted starting tags too.
  for (const tag of selected) {
    const conflict = exclusiveConflict(tag, heldOrSelectedIds, byId);
    if (conflict) {
      return { error: `${tag.name} and ${conflict.name} can't be held at the same time.` };
    }
  }

  // Named conflict pairs (Sober vs Addiction). Reads byId, not the bare `tag` — `selected` omits conflictsWith.
  for (const tag of selected) {
    const catalogTag = byId.get(tag.id) ?? tag;
    const conflict = conflictingTag(catalogTag, heldOrSelectedIds, byId);
    if (conflict) {
      return { error: `${tag.name} conflicts with ${conflict.name}.` };
    }
  }

  // Both drawback ceilings (TAGS.md §4a), checked separately so a refusal
  // names which one stopped the build. Each counts only bought tags.
  const maxDrawbacks = config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS;
  const drawbackCount = negativeTagCount(selected);
  if (drawbackCount > maxDrawbacks) {
    return {
      error: `You picked ${drawbackCount} drawbacks and can take at most ${maxDrawbacks}.`,
    };
  }

  const maxDrawbackPoints = config?.maxDrawbackPoints ?? DEFAULT_MAX_DRAWBACK_POINTS;
  const drawbackPoints = negativeTagPoints(selected);
  if (drawbackPoints > maxDrawbackPoints) {
    return {
      error: `Your drawbacks claim back ${drawbackPoints} points and you can claim at most ${maxDrawbackPoints}.`,
    };
  }

  const budget = computeBudget({ startingTagPoints: config?.startingTagPoints ?? 0, role, cursed });
  const spent = effectiveTotalCost(selected, byId, grantedIds);
  if (spent > budget) {
    return { error: `That costs ${spent} points and you have ${budget}.` };
  }

  // A Commoner who reached the end without picking a trade starts a farmer —
  // left alone they'd hold Laboring (Skilled) at no location's coefficient,
  // the one build that can't feed itself. Lands in startingTags, not
  // selected: the GM_GRANT loop below stamps expiry and carries the slug
  // into heldSlugs. 0 points, budget untouched, crate arrives unopened.
  if (role.slug === "commoner") {
    const tradeHeld = [...selected, ...startingTags].some(
      (t) =>
        COMMONER_KIT_SLUGS.includes(t.slug) || LABORING_SPECIALISATION_SLUGS.includes(t.slug),
    );
    if (!tradeHeld) {
      const kit = await prisma.tag.findUnique({ where: { slug: DEFAULT_COMMONER_KIT_SLUG } });
      if (kit) startingTags.push(kit);
    }
  }

  // Union bought + granted tags, refunding nothing (already budget-checked).
  // A tag with a catalog duration must arrive already stamped.
  const tagIdsToGrant = new Map();
  for (const tag of startingTags) {
    const expiresTurn = await expiryForGrant(prisma, tag, openTurn, { where: "createCharacter" });
    const quantity = tag.stackable ? (startingWanted.get(tag.slug) ?? 1) : 1; // count only means anything on a stackable tag
    tagIdsToGrant.set(tag.id, { source: "GM_GRANT", expiresTurn, quantity });
  }
  for (const tag of selected) {
    if (!tagIdsToGrant.has(tag.id)) {
      const expiresTurn = await expiryForGrant(prisma, tag, openTurn, { where: "createCharacter" });
      tagIdsToGrant.set(tag.id, { source: "POINT_BUY", expiresTurn, quantity: 1 });
    }
    // A purchased higher tier replaces a role-granted lower tier of the same chain.
    for (const lowerId of chainSiblingsToRemove(tag, byId, grantedIds)) {
      tagIdsToGrant.delete(lowerId);
    }
  }

  // Hoisted above the transaction so the obol grant and the poster/notice fan-out both read one variable.
  const heldSlugs = [...selected, ...startingTags]
    .filter((t) => tagIdsToGrant.has(t.id))
    .map((t) => t.slug);
  // The shape travelOptions wants (db/lib/locationGraph.js). Nothing is
  // equipped at creation, so `equipped: false` is the whole truth.
  const heldTagRows = heldSlugs.map((slug) => ({ equipped: false, tag: { slug } }));

  // `!== false`, not truthy: matches actions.js#updateCharacterProfile.
  // Written as a plain column, not via db/lib/webOnly.js#setWebOnly (the FLIP
  // path) — its Discord half would revoke access never granted. webOnlyChangedAt
  // stays null so a mis-tick can be undone right away, no two-hour cooldown.
  const webOnly = config?.playPanelEnabled !== false && postedWebOnly;

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // The lock that actually closes the race — see the header comment.
      // heldSeats counts seated characters plus others' holds/assignments; the caller's own are left out.
      await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${role.id} FOR UPDATE`;
      const held = await heldSeats(tx, role, { excludeDiscordUserId: discordUserId });
      if (held >= roleCapacity(role, effectivePlayerCount(config, state))) {
        throw new Error("ROLE_FULL");
      }
      // Release the caller's own hold in the same transaction.
      await releaseRole(tx, discordUserId);

      const character = await tx.character.create({
        data: {
          discordUserId,
          honorific,
          firstName,
          title: null,
          lastName,
          name,
          gender: effectiveGender,
          age,
          webOnly, // set before placement runs, so applyLocationMoveSideEffects sees it already on and grants nothing (CHAT.md §6a)
          roleId: role.id,
          roleTitle: role.name,
          factionId: role.factionId,
          // Denormalization contract: every writer of locationId writes
          // location.zoneId in the same statement.
          locationId: role.startingLocationId ?? null,
          zoneId: role.startingLocation?.zoneId ?? null,
          resources: role.startingResources,
          tagPoints: budget - spent,
          isLeader: role.grantsLeader,
          isTreasurer: role.grantsTreasurer,
          antagonistOptIns,
        },
      });

      await tx.characterTag.createMany({
        data: [...tagIdsToGrant].map(([tagId, { source, expiresTurn, quantity }]) => ({
          characterId: character.id,
          tagId,
          source,
          expiresTurn,
          quantity: quantity ?? 1,
        })),
      });

      // Any assigned seat this player held is spent by this character (db/lib/lobby.js#settleLobbyEntry).
      await settleLobbyEntry(tx, discordUserId, character.id);

      // Keeps the same answer, so a later game opens with it ticked already (LOBBY.md §2).
      await tx.playerPreference.upsert({
        where: { discordUserId },
        create: { discordUserId, antagonistOptIns },
        update: { antagonistOptIns },
      });

      // The Merchant advanced him half; the paper says the rest (db/lib/wantedPoster.js#DEBTOR_STARTING_OBOLS).
      if (isDebtor(heldSlugs)) {
        const obolTag = await tx.tag.findUnique({
          where: { slug: OBOL_SLUG },
          select: { id: true, stackable: true },
        });
        if (obolTag) {
          await addToStack(tx, character.id, obolTag.id, DEBTOR_STARTING_OBOLS, {
            source: "EVENT",
            stackable: obolTag.stackable,
          });
        }
      }

      return character;
    });
  } catch (err) {
    if (err.message === "ROLE_FULL") {
      return { error: `${role.name} was taken while you were deciding. Pick another role.` };
    }
    throw err;
  }

  // Discord side effects, best-effort. Placement is one call — the shared
  // location fan-out swaps the zone/location roles, reconciles narrowcast
  // access and private-room membership. Personal role is separate — a mentionable name token, grants nothing.
  await ensureCharacterRole(created).catch(() => {});
  if (created.locationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId: created.id,
      fromLocationId: null,
      toLocationId: created.locationId,
    }).catch(() => {});
  }
  // The map this seat wakes up with (db/lib/startingMemories.js). After the
  // transaction, so travelOptions reads the tags just granted, and after placement.
  await seedMemories(
    prisma,
    { ...created, tags: heldTagRows },
    startingMemorySlugs(role.slug, heldSlugs),
  ).catch(() => {});
  await syncCharacterNickname(discordUserId, formatBareName({ firstName, lastName })).catch(() => {});

  // Somebody who arrives already Wanted has three posters go up in the same breath (db/lib/wantedPoster.js). Best-effort.
  if (isWanted(heldSlugs)) {
    await postWantedPosters(
      prisma,
      { ...created, zoneName: role.startingLocation?.zone?.name ?? null },
      openTurn,
    ).catch((err) => console.error("postWantedPosters failed:", err));
  }
  // Same shape for Debtor, three sheets in the Merchant's rooms instead.
  if (isDebtor(heldSlugs)) {
    await postDebtorNotices(prisma, { ...created, zoneName: role.startingLocation?.zone?.name ?? null }, openTurn)
      .catch((err) => console.error("postDebtorNotices failed:", err));
  }
  if (!created.locationId) await syncCharacterNarrowcastAccess(created.id).catch(() => {});
  if (cursed) await removeGhostRole(discordUserId).catch(() => {}); // curse itself needs no write: the new ALIVE row is already the answer

  // The Depot's turret spares exactly one face — he knows his own name here.
  // Set once and never resynced: concealing himself later still gets him
  // shot, which is the design (DEPOT.md §0f).
  if (isMerchantRole(role.slug)) {
    await setMerchantFace(prisma, created.name).catch(() => {});
    await setMerchantSeal(prisma, created.name).catch(() => {}); // his wax stamp bears his own initials too — see db/lib/merchantSeal.js
  }

  // A new Baron renames every living family member. Best-effort — must not cost this create.
  if (isDynastyHead(role.slug)) {
    await propagateDynastyLastName(created.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: discordUserId,
      actionType: "character_created",
      targetCharacterId: created.id,
      details: {
        role: role.name,
        faction: role.faction?.name ?? null,
        zone: role.startingLocation?.zone?.name ?? null,
        location: role.startingLocation?.name ?? null,
        budget,
        spent,
        purchased: selected.map((t) => t.name),
        antagonistOptIns,
      },
    },
  });

  await recordArchiveEvent({
    kind: "CHARACTER_CREATED",
    character: created,
    zoneId: created.zoneId ?? null,
    zoneName: role.startingLocation?.zone?.name ?? null,
    turn: openTurn,
    content: `${created.name} arrived in Ravenheart as ${role.name}.`,
  });

  revalidatePath("/", "layout");
  redirect("/character");
}

// Slides the reservation hold's expiry on each wizard Next. Re-checks the same gates createCharacter does.
export async function reserveRoleAction(roleId) {
  const session = await auth();
  if (!session?.discordUserId) return { error: "Sign in to hold a role." };
  const discordUserId = session.discordUserId;
  if (!roleId) return { error: "Pick a role before continuing." };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    return { error: "You already have a character." };
  }

  const [role, config, state, member] = await Promise.all([
    prisma.role.findUnique({ where: { id: roleId }, include: { faction: { include: { zone: true } } } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma),
    getGuildMember(discordUserId, 0), // always fresh
  ]);
  if (!role) return { error: "That role no longer exists." };

  const bypass = isSuperadmin(discordUserId);
  if (!bypass && !creationOpen(state?.phase, member)) {
    return { error: "Ravenheart isn't open yet. Character creation opens when the game begins." };
  }
  if (!bypass && !onRoster(member, { playtestMode: config?.playtestModeEnabled === true })) {
    return { error: "You aren't on the roster for this game. Ask a GM if you think that's wrong." };
  }
  if (isSpawnOnly(role)) {
    return { error: "That role isn't open to anyone." };
  }
  const leaderWhitelisted = bypass || isLeaderWhitelisted(member);
  if (role.requiresWhitelist && !leaderWhitelisted) {
    return { error: "That role isn't available to you." };
  }
  const cursed = await isPlayerCursed(prisma, discordUserId);
  if (!isRoleSelectable({ role, cursed, leaderWhitelisted })) {
    return { error: `While cursed you may only return as ${CURSED_ROLE_SLUGS.join(" or ")}.` };
  }

  const result = await reserveRole(prisma, discordUserId, roleId, effectivePlayerCount(config, state));
  if (!result.ok) {
    return { error: `${role.name} was taken while you were deciding. Pick another role.` };
  }
  return { ok: true, expiresAt: result.expiresAt };
}
