import "server-only";
import { prisma } from "@lifeweb/db";
import { travelOptions } from "@lifeweb/db/lib/locationGraph";
import { INCAPACITATING_SLUGS, FINISHABLE_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { kissBlock } from "@lifeweb/db/lib/kiss";
import { examineBlock } from "@lifeweb/db/lib/examineVision";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { peopleHere } from "@/lib/peopleHere";
import { whosHere } from "@lifeweb/db/lib/whosHere";
import { rosterName } from "@lifeweb/db/lib/presentedIdentity";
import { isTradeable } from "@/lib/tagRequests";
import { chipSelect, chipContextFor, composeChipTag } from "@/lib/referenceData";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { craftMoveCost } from "@/lib/craftBudget";
import { MEDICAL_SIMPLE_PER_TURN } from "@/lib/requests";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { SURGICAL_EQUIPMENT_SLUG, PORTABLE_SURGICAL_PACK_SLUG } from "@lifeweb/db/lib/constants";
import {
  HEALABLE_CATEGORY,
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  healCost,
  isHealable,
  isInflictable,
  isGambitHeal,
  needsSurgicalSite,
  countsAgainstHealCap,
  healCapFor,
  satisfiedSkillIds,
  HEAL_SKILL_SELECT,
} from "@/lib/healRequests";

// Everything the PEOPLE dialogs need — Look at, Heal, Transfer's recipient
// list, Loot, Bind, Free, Harm, Move Player — built once for whichever
// surface is asking.
//
// It lived inside web/app/(app)/character/page.js until phase 3, which was
// fine while the sheet was the only place you could act on somebody standing
// near you. Chat's people column is the second, and a second copy of
// "who is helpless" would have been a second answer.
//
// The metagaming rule the sheet's grid follows applies to what a CALLER does
// with these, not to the lists themselves: every roster here is already
// narrowed to who is standing at this Location and hasn't hidden their face
// (web/lib/peopleHere.js), and every server action re-checks the same
// predicate on the id it is posted.
export async function loadPeoplePools(character, { discordUserId, openTurn } = {}) {
  // The people a sheet can act on: standing at this Location, alive and
  // unconcealed. One roster for every picker, so the menus can't disagree —
  // and the server re-checks the same predicate. `here` carries what Heal and
  // Learn need; `zoneRoster` is the roster for the actions that also work on
  // a corpse.
  const [here, zoneRoster, tierRows, roomNow] = await Promise.all([
    peopleHere(character, {
      select: {
        id: true,
        name: true,
        // No `resources` — a balance is nobody else's business.
        tags: {
          select: {
            tagId: true,
            // `equipped` and the four concealment fields are KISS's, and they
            // ride along here rather than in a second query: kissBlock() only
            // counts a hood somebody is actually WEARING, and a row loaded
            // without them reports every mask as a bare face — wrong in the
            // one direction it must not be.
            equipped: true,
            tag: {
              select: {
                id: true,
                name: true,
                slug: true,
                healable: true,
                requirementTurns: true,
                requirementPerTurn: true,
                requirementResources: true,
                requirementGambit: true,
                // HEAL_SKILL_SELECT: the id qualifies the medic, and the slug is
                // what needsSurgicalSite() matches medical-expert on — without it
                // a patient standing here never warns that their wound needs a site.
                requirementSkills: { select: HEAL_SKILL_SELECT },
                // What to CALL them: a forced name (Apex Form -> "Beast") is
                // not concealment — a Beast is openly a Beast — but every
                // picker below used to print the real name underneath it.
                // rosterName() is the one answer now.
                forcedName: true,
                concealsIdentity: true,
                concealSprite: true,
                forcesConceal: true,
                equipLayer: true,
              },
            },
          },
        },
      },
    }),
    // ONE roster for every action on somebody standing here (Loot, Move,
    // Bind, Free, Harm), including the unburied dead.
    peopleHere(character, {
      includeDead: true,
      select: {
        id: true,
        name: true,
        status: true,
        resources: true,
        tags: {
          select: {
            tagId: true,
            quantity: true,
            tag: {
              select: {
                name: true,
                slug: true,
                category: true,
                stackable: true,
                tradeable: true,
                // Weight, and DELIBERATELY nothing more. A room's stash rows
                // carry a whole chip; pockets do not. The loot filter below is
                // `tradeable`, not catalogVisibility, so a secret tag somebody
                // is carrying is already named here — adding its description,
                // its recipe and its cost to that would hand a looter the
                // catalog entry as well (REQUESTS.md §5b). What it weighs is
                // not a secret from the person about to pick it up.
                weightLbs: true,
                // rosterName()'s half — see the note in the roster above.
                forcedName: true,
              },
            },
          },
        },
      },
    }),
    prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } }),
    // TRANSFER'S recipient list, BOTH halves of it. A hood hides WHO somebody
    // is, not THAT they are standing there, and handing a coin to a stranger
    // is a thing you can plainly do to a person whose name you do not know —
    // so Transfer is the one picker that reaches one, and `concealed` carries
    // an HMAC handle rather than the character id behind the mask.
    //
    // The NAMED half comes from here too, and that is the point of the call:
    // peopleHere() splits on the `concealed` COLUMN while this splits on what
    // is actually over the face, and mixing the two left people in neither
    // list or in both. Somebody wearing a sack with the column off (a forced
    // hood is not a choice) was offered twice, once by their real name; and
    // with sightings on, somebody who spoke bare-faced and then masked up
    // would have fallen out of both. One question, one answer.
    //
    // `withSightings` so the dropdown and the HERE column six inches above it
    // call the same person the same thing — the name you HOLD, frozen at the
    // last line you heard them say.
    whosHere(prisma, character, { includeSelf: false, withSightings: true }),
  ]);

  const selfEntry = { id: character.id, name: rosterName(character) };
  const peopleParties = [selfEntry, ...here.map((c) => ({ id: c.id, name: rosterName(c) }))];
  // TRANSFER'S list, and only Transfer's. `peopleParties` above is the Heal
  // payer list and Craft's, and transferRequestImpl is the one action that
  // knows how to resolve a hood token — offering one anywhere else would be a
  // row you can pick and cannot use.
  //
  // `kind: "hood"` makes PartySelect write "hood:<token>" instead of
  // "character:<id>". A token is null when AUTH_SECRET is unset, and an
  // untokened hood is not offerable.
  const transferParties = [
    selfEntry,
    ...roomNow.named.map((c) => ({ id: c.characterId, name: c.name })),
    ...roomNow.concealed.filter((c) => c.token).map((c) => ({ id: c.token, name: c.alias, kind: "hood" })),
  ];

  // SEARCH'S list (docs/systemdocs/SEARCH.md). Shaped like transferParties and
  // for the same reason: Search is the second verb in the game that reaches a
  // person in a hood, so it cannot use `here` — hereWhere drops concealed rows
  // and a hood is exactly who you want to search. No self entry: you do not
  // search yourself.
  //
  // Menu hygiene only. searchRequestImpl re-runs searchAuthority on whatever is
  // posted, and acceptSearch runs it a third time on the answer.
  const searchParties = [
    ...roomNow.named.map((c) => ({ id: c.characterId, name: c.name })),
    ...roomNow.concealed.filter((c) => c.token).map((c) => ({ id: c.token, name: c.alias, kind: "hood" })),
  ];

  // Whether their eyes are good enough to look anybody over — Nearsighted
  // without spectacles on, Sun Sensitivity in daylight. Resolved server-side
  // so the sentence a button shows and the one examineActions.js refuses with
  // are the same sentence.
  const examineBlocked = examineBlock(character.tags, {
    phase: openTurn?.phase ?? null,
    indoors: character.location?.indoors ?? true,
  });

  // Why this character cannot kiss anybody, or null — their own broken jaw,
  // their own Rage, their own hood. Resolved server-side for the same reason
  // examineBlocked is: the sentence the greyed button shows and the one
  // kissRequestImpl refuses with have to be the same sentence.
  //
  // Their own sheet ONLY. Never who is standing near them — the rule at the
  // top of actionRegistry.js, which a kiss could break more loudly than most.
  const kissBlocked = kissBlock(character, { self: true });

  // Healing. The medical gate is resolved here, server-side, so no tier-chain
  // math reaches the client bundle.
  const ancestry = buildSkillAncestry(tierRows);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = tierRows.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  const canHeal = Boolean(healSkillId && satisfied.has(healSkillId));

  // Surgery needs a site (M3, TAGS.md §5c; reworked M6b): resolved once,
  // server-side, so a tier-6/7 row can quote it the same way CraftDialog
  // quotes hasWorkshop — a hint, never the gate; healCharacterRequestImpl
  // re-checks it under lock. A Portable Surgical Pack also counts as a site
  // now, but a worse one: `surgicalSitePenalty` tells the dialog when the
  // pack is doing that job alone, which is the only case that costs the
  // Gambit a −1.
  const fixedSurgicalSiteReach = canHeal
    ? await hasEquipmentInReach(prisma, character, SURGICAL_EQUIPMENT_SLUG)
    : false;
  const portableSurgicalPackReach =
    canHeal && !fixedSurgicalSiteReach
      ? await hasEquipmentInReach(prisma, character, PORTABLE_SURGICAL_PACK_SLUG)
      : false;
  const hasSurgicalSite = fixedSurgicalSiteReach || portableSurgicalPackReach;
  const surgicalSitePenalty = !fixedSurgicalSiteReach && portableSurgicalPackReach;

  // Routine cures left in the medic's shared free pool (M2,
  // web/lib/requests.js MEDICAL_SIMPLE_PER_TURN). The predicate MUST match
  // routineHealsThisTurn in requestActions.js exactly — a Gambit never draws
  // on it, and a number that disagreed with the one the action enforces
  // would grey out (or wrongly free) a treatment the server would price
  // differently. Resolved server-side, and ahead of healTargets below so
  // each affliction row can quote what it would actually cost THIS medic
  // right now; the action re-checks under a row lock either way.
  const heldSlugSet = new Set(character.tags.map((ct) => ct.tag.slug));
  // canHeal short-circuits the audit query (review fix, M2 — it ran for
  // every /character and /play load regardless of whether the loader could
  // even heal, until this hoist dropped the guard the pre-M2 nested ternary
  // had for free).
  const simpleCuresThisTurn =
    canHeal && openTurn && discordUserId
      ? (
          await prisma.auditLog.findMany({
            where: {
              // The MEDIC's axis, matching routineHealsThisTurn exactly.
              // targetCharacterId here is the patient.
              actorDiscordUserId: discordUserId,
              actionType: "request_heal_character",
              turnId: openTurn.id,
            },
            select: { details: true },
          })
        ).filter((r) => !r.details?.gambit && (r.details?.requirement?.turns ?? 0) === 0).length
      : 0;
  const healsLeft = canHeal
    ? Math.max(0, healCapFor(heldSlugSet, MEDICAL_SIMPLE_PER_TURN) - simpleCuresThisTurn)
    : 0;

  // Patients: yourself and everyone here, filtered to treatable tags HERE,
  // not the client, so nobody else's full sheet crosses the wire. Skipped for
  // the majority who aren't medics.
  const selfAsPatient = {
    id: character.id,
    name: rosterName(character),
    tags: character.tags.map((ct) => ({ tagId: ct.tagId, tag: ct.tag })),
  };
  const healTargets = (canHeal ? [selfAsPatient, ...here] : [])
    .map((t) => ({
      id: t.id,
      name: rosterName(t),
      healable: t.tags
        .map((ct) => ct.tag)
        .filter(isHealable)
        .map((tag) => {
          // Above your tier, or the ladder's top rung, and it's a roll rather
          // than a refusal — so the picker offers it, labelled, instead of
          // greying it out (docs/systemdocs/TAGS.md §5c). Computed once —
          // countsAgainstHealCap's own gambit exclusion reads this same
          // answer rather than a second call (review fix, M2).
          const gambit = isGambitHeal(tag, satisfied);
          return {
            tagId: tag.id,
            tagName: tag.name,
            // Lets the Heal dialog match this row against the medic's own held
            // items' `cures` lists (medical pass, TAGS.md §5c) for the "or use:
            // …" affordance — Tag.cures names slugs, not ids.
            slug: tag.slug,
            cost: healCost(tag),
            requirementLabel: formatTagRequirement(tag),
            gambit,
            // Tier 6/7 only (M3) — the dialog greys out nothing on this, since
            // a Gambit is always offered rather than refused; it just warns.
            needsSite: needsSurgicalSite(tag),
            // What this heal would cost the medical Move RIGHT NOW, family
            // hardcoded "medical" like the server bills (never derived —
            // craftFamily would drop a skill-less cure like choking into the
            // generic `craft` family): `free` inside today's pool, `spill` at
            // 1/MEDICAL_SIMPLE_PER_TURN past it, `share` for a fraction/whole
            // turns-costing cure. Gambits never price here — they're a Move of
            // their own, not this ledger.
            //
            // The `kind` label for "past the pool" does NOT match the
            // server's own for that same case — this reads the real tag
            // (requirementTurns 0) with an allowance, landing on "spill";
            // priceHeal (requestActions.js) prices a SYNTHETIC 1/4-turn tag
            // there instead, landing on "share". Cosmetic only: both compute
            // the identical num/den fraction, and nothing branches on `kind`
            // except this dialog's own "past today's free first aid" wording,
            // which reads its own client-side answer.
            moveCost: gambit
              ? null
              : countsAgainstHealCap(tag, gambit)
                ? craftMoveCost(tag, {
                    quantity: 1,
                    allowance: MEDICAL_SIMPLE_PER_TURN,
                    freeLeft: healsLeft,
                    family: "medical",
                  })
                : craftMoveCost(tag, { quantity: 1, family: "medical" }),
          };
        }),
    }))
    .filter((t) => t.healable.length > 0);

  // The catalog name of whichever incapacitating tag they hold.
  function conditionOf(c) {
    return c.tags.find((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))?.tag.name ?? null;
  }
  const helpless = zoneRoster.filter((c) => c.status === "DEAD" || conditionOf(c));

  // A body, or anyone who can't stop you. Only `tradeable` tags come off.
  const lootTargets = helpless.map((c) => ({
    id: c.id,
    name: rosterName(c),
    status: c.status,
    condition: conditionOf(c),
    resources: c.resources,
    tags: c.tags
      .filter((ct) => isTradeable(ct.tag))
      .map((ct) => ({
        tagId: ct.tagId,
        tagName: ct.tag.name,
        stackable: ct.tag.stackable,
        quantity: ct.quantity ?? 1,
        // Assets weigh nothing on your back (CARRY.md §1), the same rule the
        // room rows and the sheet's own source apply.
        weightLbs: ct.tag.category === "Assets" ? 0 : (ct.tag.weightLbs ?? 0),
      })),
  }));

  // The two pools that fed the Move Player dialog are gone with it. Taking
  // somebody along is the party rack on /chat now, and it reads its own
  // candidates off db/lib/escort.js#escortCandidates — a Location roster
  // rather than a zone one, with a verdict per row (docs/systemdocs/MAP.md
  // §3a).

  // Consume's optional administer target (medical pass, TAGS.md §5c): who a
  // cure or an administerable item may be given to. Its own pool rather than
  // a share of a neighbour's — it used to ride on the Move Player dialog's
  // roster, which went away with that dialog, and the two questions were
  // never the same one.
  const consumeTargets = zoneRoster
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({ id: c.id, name: rosterName(c) }));

  // Bind and Free split this one list on `bound`; Crucify on `crucified`;
  // Shackle on `bound && !shackled`. `bound` counts shackles too — Free,
  // Torture and Mutilate treat a shackled person as tied up.
  const bindTargets = zoneRoster
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({
      id: c.id,
      name: rosterName(c),
      bound: c.tags.some((ct) => ct.tag.slug === "bound" || ct.tag.slug === "shackled"),
      shackled: c.tags.some((ct) => ct.tag.slug === "shackled"),
      crucified: c.tags.some((ct) => ct.tag.slug === "crucified"),
    }));

  // `finishable` is the narrower Dying-or-Bound gate on the lethal half.
  const harmTargets = helpless
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({
      id: c.id,
      name: rosterName(c),
      condition: conditionOf(c),
      finishable: c.tags.some((ct) => FINISHABLE_SLUGS.has(ct.tag.slug)),
    }));

  // Poison's own dose-a-helpless-person roster (M4) — the same helpless
  // class Harm and Loot use, minus the dead (a poison lands on a body's
  // living owner or not at all — there's nobody home to dose).
  const doseTargets = helpless
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({ id: c.id, name: rosterName(c), condition: conditionOf(c) }));

  // Not the whole Health category (TAGS.md §5c) — isInflictable narrows it to
  // wounds and maiming. Filtered in JS so this and the server action's
  // re-check share the same predicate.
  const harmTags = (
    await prisma.tag.findMany({
      where: { category: HEALABLE_CATEGORY, custom: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        category: true,
        custom: true,
        pointCost: true,
        stackable: true,
        // ChipLabel's mastery star.
        mastery: true,
        group: { select: { slug: true, name: true } },
      },
    })
  ).filter(isInflictable);

  // Who this character could kiss (docs/systemdocs/KISS.md). `here` is already
  // narrowed to the living, unconcealed people standing at this Location, so
  // what is left to ask is kissBlock's question — a mouth injury, a state with
  // nobody home, a Ghoul, a covered face.
  //
  // Menu hygiene only. kissRequestImpl re-runs the whole gate through
  // kissAuthority on whatever id is posted, and so does the Accept click a day
  // later, so a stale page can never push a kiss past this list.
  const kissTargets = here
    .filter((p) => !kissBlock(p, { self: false }))
    .map((p) => ({ id: p.id, name: rosterName(p) }));

  return {
    here,
    kissTargets,
    kissBlocked,
    zoneRoster,
    peopleParties,
    transferParties,
    searchParties,
    examineBlocked,
    satisfied,
    canHeal,
    healTargets,
    healsLeft,
    hasSurgicalSite,
    surgicalSitePenalty,
    lootTargets,
    consumeTargets,
    bindTargets,
    harmTargets,
    harmTags,
    doseTargets,
  };
}

// The rooms a Transfer can hand things to or take things from: every room at
// this Location the character can actually get into, with its stash.
//
// The same shape web/app/(app)/character/page.js builds for the sheet's own
// Transfer dialog, including the Assets-weigh-nothing rule (CARRY.md §1) the
// projection under the dialog reads. It lives here rather than being a second
// query in Chat's page: two answers to "which doors are open to you" is
// exactly what web/lib/peoplePools.js exists to stop.
//
// `scope: "zone"` is Taxman's read: every room in the character's whole zone
// they can get into, resources only — no tag stacks, since the tax dialog has
// no use for them and they're the expensive half of this query. The access
// check (`accessibleRooms`/`roomAccessKeys`) is identical either way; widening
// the `where` in place is the point — a second, competing query here is
// exactly what this function's own header warns against.
export async function loadStashRooms(character, { scope = "location", chipCtx = null } = {}) {
  if (scope === "zone") {
    if (!character?.zoneId) return [];
    const [rows, keys] = await Promise.all([
      prisma.room.findMany({
        where: { location: { zoneId: character.zoneId } },
        orderBy: [{ location: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          accessTagSlugs: true,
          resources: true,
          location: { select: { id: true, name: true } },
        },
      }),
      roomAccessKeys(prisma, character.id),
    ]);
    return accessibleRooms(rows, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).map((room) => ({
      id: room.id,
      name: room.name,
      resources: room.resources,
      locationId: room.location.id,
      locationName: room.location.name,
    }));
  }

  if (!character?.locationId) return [];
  // The reader a stash chip's paper is resolved against. /chat already built
  // one for the Things drawer and hands it in, so the same letter reads the
  // same way in a pocket and on the floor; everybody else gets one built here.
  // chipContextFor(null-ish) fails CLOSED — an unreadable line, never the text.
  const ctx = chipCtx ?? (await chipContextFor(character));
  const [rows, keys] = await Promise.all([
    prisma.room.findMany({
      where: { locationId: character.locationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        accessTagSlugs: true,
        resources: true,
        tags: {
          where: { quantity: { gt: 0 } },
          select: {
            tagId: true,
            quantity: true,
            // The whole chip shape, not the four columns this used to take.
            // Pulling something out of a stash is the one moment a player has
            // to decide whether they want it, and until 2026-09-10 the row was
            // a bare name — so the only way to learn where a helmet went was to
            // carry it home and try it on. Spread it, don't retype it: that is
            // the drift chipSelect() exists to stop.
            tag: { select: chipSelect({ stackable: true, equippable: true }) },
          },
        },
      },
    }),
    roomAccessKeys(prisma, character.id),
  ]);

  return accessibleRooms(rows, keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).map((room) => ({
    id: room.id,
    name: room.name,
    resources: room.resources,
    tags: room.tags.map((rt) => ({
      tagId: rt.tagId,
      name: rt.tag.name,
      quantity: rt.quantity,
      stackable: rt.tag.stackable,
      weightLbs: rt.tag.category === "Assets" ? 0 : (rt.tag.weightLbs ?? 0),
      // The chip's own copy. composeChipTag runs exactly the filters this
      // used to spell out by hand — a dish names its taste and not its
      // ingredients, a weightless tag ships neither weight column — AND
      // resolves a paper against THIS reader. Never a GM context here: a
      // sealed letter lying in a stash must stay sealed to whoever walks past.
      tag: composeChipTag(rt.tag, ctx),
    })),
  }));
}
