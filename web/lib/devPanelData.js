import { prisma, isDynastyMember } from "@lifeweb/db";
import { gambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import { evaluateDesireCatalog, slotStates, desireSlotsNeverLock } from "@lifeweb/db/lib/desireGates";
import { desireFamilies } from "@lifeweb/db/lib/desireFamilies";
import { getGuildMember } from "@/lib/discordGuild";
import { isPlayerCursed } from "@lifeweb/db/lib/curse";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { resourcesOf } from "@lifeweb/db/lib/resourceStack";
import { isSuperadmin } from "@/lib/superadmin";
import { isHealable } from "@/lib/healRequests";
import { chipSelect, composeChipTag, GM_CHIP_CTX } from "@/lib/referenceData";
import { projectDesireTemplateForGates, loadRoleBySlugForTemplates } from "@/lib/desireProjection";
import { concealmentFrom, forcedNameFrom, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";
import { paperDescriptionGm, paperViewGm } from "@lifeweb/db/lib/paper";
import { prettifyActionType } from "@/lib/auditNarrative";

// The whole data-assembly behind the Dev Character Panel, extracted so it can
// be shared by the standalone page (/gm/dev/characters/[characterId]) and the
// modal mount over /gm/turns (web/app/(desk)/gm/turns/devPanelActions.js).
// Everything the panel needs to OPEN is loaded here, in one Promise.all, and
// handed back as plain DTOs. The Record tab's four history lists are the
// exception — they live in loadDevPanelRecord below and are fetched only when
// a GM opens that tab. DevPanel is a client component (it holds the
// staged-edit state), so nothing Prisma-shaped may cross the boundary: dates
// become ISO strings and only the columns actually rendered come along.
//
// Returns null when the character doesn't exist, so callers can 404/UserError
// as fits their own surface.
export async function loadDevPanelProps(characterId, actingDiscordUserId) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { role: true, zone: true, location: true },
  });
  if (!character) return null;

  const [
    locations,
    roles,
    allTags,
    heldTags,
    config,
    openTurn,
    desires,
    openTurnAction,
    desireTemplates,
    member,
    pendingStaged,
    transferRoster,
    latestAudit,
    adminNotesCount,
  ] = await Promise.all([
    // The place picker's options. A character stands in a Location, never on
    // a zone row, so this is the whole Location table grouped by zone.
    // Authoring order both ways, so the list reads like docs/zones.yaml
    // rather than the alphabet.
    prisma.location.findMany({
      orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
    }),
    prisma.role.findMany({
      orderBy: [{ sortOrder: "asc" }],
      select: { id: true, name: true, slug: true, groupSlug: true },
    }),
    // The whole catalog, gates and all: a GM grant deliberately ignores
    // requiredTag and the TagGroup gate (TAGS.md), so unlike getVisibleTags (lib/referenceData.js) this
    // withholds nothing — including the hidden Demoness group.
    prisma.tag.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      // An explicit select, not an include: this is the whole catalog, and
      // every column fetched is a column serialised across to a client
      // component. These are exactly the fields the projection below maps,
      // plus the four the isHealable predicate reads (it only checks
      // requirementSkills for length, hence ids alone).
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        pointCost: true,
        stackable: true,
        equippable: true,
        consumable: true,
        removable: true,
        healable: true,
        teachable: true,
        custom: true,
        defaultDurationTurns: true,
        parentTagId: true,
        requiredTagId: true,
        // The treated-wound aftermath (TAGS.md §5c). The Dev Panel's Holds
        // row needs it to warn before an IMMEDIATE removal: removing a Broken
        // Bone leaves Splinted behind, and re-adding the Broken Bone does not
        // clear it, so that one gesture is the one that can't be undone by
        // repeating its inverse.
        removesInto: true,
        requirementTurns: true,
        requirementResources: true,
        requirementGambit: true,
        requirementSkills: { select: { id: true } },
        meleeArmor: true,
        ballisticArmor: true,
        // ChipLabel's mastery star.
        mastery: true,
        // So Clone from… in the custom-tag dialog carries an item's weight
        // across — cloning a longsword to make a notched one and silently
        // getting a weightless sword is the hole this door used to leave.
        weightLbs: true,
        // Composed into `description`/`paper` in the projection below and
        // never shipped raw — this DTO lists its columns by hand, so
        // paperText cannot ride along by accident. Without these a
        // player-written note hovered blank here too (tagChipRows.js).
        paperKind: true,
        paperText: true,
        sealMark: true,
        // Catalog or runtime-minted, for the browser's Minted tab.
        ephemeral: true,
        group: { select: { slug: true, name: true } },
      },
    }),
    // chipSelect() + composeChipTag() is what any surface drawing the sheet's
    // own cards (web/lib/sheetCards.js) needs — TAG_CHIP_FIELDS alone misses
    // carryBonus/miningBonus, which sheetCards.js#rowValue reads, and a raw
    // Tag row's `description`/`paper` are wrong for a paper tag until
    // composed. Same select the adjudication desk's inspector already uses
    // for the same reason (web/app/(desk)/gm/turns/actions.js).
    prisma.characterTag.findMany({
      where: { characterId },
      include: { tag: { select: chipSelect({ equippable: true, stackable: true, carryBonus: true, miningBonus: true, gambitBonus: true }) } },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    prisma.desire.findMany({
      where: { characterId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { template: { select: { name: true, tier: true, slug: true } } },
    }),
    // This turn's Move, for the state strip's "Acted" fact and the Turn tab.
    // It used to be found inside the 100-row Moves list — but that list moved
    // to loadDevPanelRecord, and refetching 100 rows to read one is not worth
    // it. Only the columns the DTO below actually maps.
    prisma.action.findFirst({
      where: { characterId, turn: { status: "OPEN" } },
      select: {
        id: true,
        description: true,
        moveKind: true,
        moveReviewStatus: true,
        resourceDelta: true,
        diceRoll: true,
        diceModifier: true,
        gmNotes: true,
      },
    }),
    // The full catalog for the GM's picker — retired rows included AND
    // marked (a GM grant bypasses gates entirely, see awardDesireGmImpl), so
    // this is a separate, wider select than the player-facing one in
    // character/page.js.
    prisma.desireTemplate.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        tier: true,
        families: true,
        onceEver: true,
        cooldownTurns: true,
        retired: true,
        requiresAnyOf: true,
        requiresAnyRoleSlugs: true,
        requiresNotRoleSlugs: true,
        requiresAnyTags: { select: { id: true, name: true } },
        requiresAllTags: { select: { id: true, name: true } },
        requiresNotTags: { select: { id: true, name: true } },
      },
    }),
    // Cursed is a live Discord role, not a DB field — read the account's
    // current guild roles rather than the Character row.
    getGuildMember(character.discordUserId).catch(() => null),
    // What the adjudication workspace has queued against this sheet for the
    // turn-end push. A GM live-editing resources here and a staged effect are
    // additive and can't corrupt each other — but a GM WILL double-grant
    // without the StateStrip hint this feeds. It depends on nothing above it,
    // so it rides along here rather than costing a second round trip.
    prisma.stagedEffect.findMany({
      where: { targetCharacterId: characterId, appliedAt: null },
      select: { payload: true },
    }),
    // The Transfer dialog's party picker — every other ALIVE character, so a
    // GM can move ⬢ between any two characters, not just this one. Same
    // ALIVE filter resolveParty applies.
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // The band's "Last activity" tile — one row, indexed by targetCharacterId
    // + createdAt already (AuditLog_details_trgm_idx's neighbour), so this
    // costs nothing worth batching separately.
    prisma.auditLog.findFirst({
      where: { targetCharacterId: characterId },
      orderBy: { createdAt: "desc" },
      select: { actionType: true, createdAt: true },
    }),
    // The Notes tab's own count, so its label can say "Notes (3)" without
    // waiting on AdminNotes.js's own client-side fetch — keyed on the
    // PLAYER, same as the notes themselves (PLAYER-DESK.md §7).
    prisma.adminNote.count({ where: { discordUserId: character.discordUserId } }),
  ]);

  // A staged transfer this character is the "to" end of is a pending credit;
  // the "from" end is a pending debit. Folded into the same ⬢ figure as a
  // plain staged `resources` mint/burn so a GM sees the whole pending change
  // to the sheet at once.
  function transferDelta(e) {
    const t = e.payload?.transfer;
    if (!t) return 0;
    if (t.to?.kind === "character" && t.to.id === characterId) return t.amount;
    if (t.from?.kind === "character" && t.from.id === characterId) return -t.amount;
    return 0;
  }

  const stagedForPush = pendingStaged.length
    ? {
        resources: pendingStaged.reduce((sum, e) => sum + (e.payload?.resources ?? 0) + transferDelta(e), 0),
        tagPoints: pendingStaged.reduce((sum, e) => sum + (e.payload?.tagPoints ?? 0), 0),
        tagOps: pendingStaged.reduce((sum, e) => sum + (e.payload?.tagOps?.length ?? 0), 0),
      }
    : null;

  // Composed ONCE, reused everywhere below that used to read the raw
  // `heldTags` — gambitModifiers/evaluateDesireCatalog/desireSlotsNeverLock
  // only ever read `.slug`/`.id`, which composeChipTag never touches, so
  // this is a strict superset of the raw shape, not a behavior change for
  // them. `held` (the flattened DTO array) and the new `characterTags` (the
  // nested shape the main-body tag display wants, same as
  // InspectorColumn.js's SheetView) both read off this one composition.
  const heldTagsComposed = heldTags.map((ct) => ({ ...ct, tag: composeChipTag(ct.tag, GM_CHIP_CTX) }));

  // The GM-facing Desire read-outs for GoalsTab. Two different shapes off the
  // same `desireTemplates` fetch:
  //   - desireCatalog: the full picker list, retired rows included and
  //     flagged — a GM grant bypasses every gate (see awardDesireGmImpl),
  //     so nothing here is filtered the way the player catalog is.
  //   - desireCooldowns: the read-only "what is this character locked out
  //     of" list, run through the SAME evaluator the player catalog uses.
  //     hiddenTagIds is an empty Set on purpose — this is a superadmin-only
  //     page, so nothing is withheld from the GM's own view (constraint:
  //     never let this projection reach a player payload).
  const desireSlotsConfig = config?.desireSlots ?? 2;
  const desireSlotLockTurns = config?.desireSlotLockTurns ?? 2;
  const roleBySlugForDesires = await loadRoleBySlugForTemplates(prisma, desireTemplates);
  const projectedDesireTemplates = desireTemplates.map((t) =>
    projectDesireTemplateForGates(roleBySlugForDesires, t),
  );
  const { visible: desireStatesEvaluated } = evaluateDesireCatalog({
    templates: projectedDesireTemplates,
    heldTags: heldTagsComposed.map((ct) => ct.tag),
    hiddenTagIds: new Set(),
    roleSlug: character.role?.slug ?? null,
    history: desires,
    openTurnNumber: openTurn?.number ?? 0,
    desireSlots: desireSlotsConfig,
    characterId,
  });
  const desireCooldowns = desireStatesEvaluated
    .filter((e) => e.state === "cooldown" || e.state === "spent")
    .map((e) => ({
      slug: e.template.slug,
      name: e.template.name,
      tier: e.template.tier,
      state: e.state,
      availableFromTurn: e.availableFromTurn,
    }));
  // Per-slot cooldown + last claim, the same read the player panel gets. A GM
  // award ignores the cooldown, but seeing it is what stops one being handed
  // out by accident into a slot the player is still locked out of.
  const desireSlotStates = slotStates({
    history: desires,
    openTurnNumber: openTurn?.number ?? 0,
    desireSlots: desireSlotsConfig,
    lockTurns: desireSlotLockTurns,
    noLock: desireSlotsNeverLock(heldTagsComposed),
  }).map((slot) => ({
    slotIndex: slot.slotIndex,
    lockedUntilTurn: slot.lockedUntilTurn,
    lastEnded: slot.lastEnded
      ? { id: slot.lastEnded.id, text: slot.lastEnded.text, points: slot.lastEnded.points }
      : null,
  }));
  const desireCatalog = desireTemplates.map((t) => ({
    slug: t.slug,
    name: t.name,
    tier: t.tier,
    families: t.families,
    retired: t.retired,
  }));

  // The band's Goals tile: a count, not the whole list — GoalsTab is where a
  // GM actually works with one. "Ready" means the slot isn't currently
  // filled by an ACTIVE desire and isn't locked out, i.e. a GM could award
  // into it right now.
  const activeSlotIndexes = new Set(
    desires.filter((d) => d.status === "ACTIVE").map((d) => d.slotIndex),
  );
  const goalsSummary = {
    active: activeSlotIndexes.size,
    total: desireSlotsConfig,
    ready: desireSlotStates.filter(
      (s) =>
        !activeSlotIndexes.has(s.slotIndex) &&
        (s.lockedUntilTurn == null || s.lockedUntilTurn <= (openTurn?.number ?? 0)),
    ).length,
  };

  // [{ label, value }] — what is weighing on their Gambit roll, named. Every
  // caller must pass `mood`; a missed one reads undefined and lands in Fine.
  const gambitParts = gambitModifiers(heldTagsComposed, { mood: character.mood });

  // The band's Carrying tile: the same carryStatus() LedgerBand.js's own
  // "Carrying" tile calls, fed the nested shape it needs — not the flattened
  // `held` below, which drops the columns carryStatus reads.
  // ⬢ are one of these rows now, so there is nothing to pass beside the tags.
  const carry = carryStatus({ tags: heldTagsComposed }, config);

  // The band's ⬢ figure, read off the stack the same way every other surface
  // reads it.
  const resources = resourcesOf({ tags: heldTags });

  return {
    character: {
      id: character.id,
      discordUserId: character.discordUserId,
      updatedAt: character.updatedAt.toISOString(),
      name: character.name,
      honorific: character.honorific,
      firstName: character.firstName,
      title: character.title,
      lastName: character.lastName,
      gender: character.gender,
      age: character.age,
      appearance: character.appearance,
      roleId: character.roleId,
      roleTitle: character.roleTitle,
      locationId: character.locationId,
      locationName: character.location?.name ?? null,
      zoneId: character.zoneId,
      zoneName: character.zone?.name ?? null,
      status: character.status,
      isLeader: character.isLeader,
      isTreasurer: character.isTreasurer,
      resources,
      tagPoints: character.tagPoints,
      // The dial itself, so the Mood box shows what it actually is
      // (docs/systemdocs/MOOD.md). It was missing while this was `fear`, so
      // that box read 0 for everybody however frightened they were.
      mood: character.mood,
      // The 0-100 hunger meter (db/lib/hunger.js). Never shown as a number on
      // the player's own sheet, but this is a GM-only debugging surface
      // (superadmin-gated), so the raw figure is fine here the way `mood`
      // above already is.
      hungerValue: character.hungerValue,
      starvingSinceTurn: character.starvingSinceTurn,
      turnPingOptIn: character.turnPingOptIn,
      // The two switches on /character a GM could not see. Both matter when a
      // player reports being visible, or unhidden, when they expect otherwise
      // — and `concealed` alone answers half the question, because the column
      // is only a wish: it takes effect solely while something concealing is
      // equipped (CHAT.md §6a, PROXYING.md §5). So the resolved answer comes
      // along beside it, from the same function every send path asks.
      discordMirrored: character.discordMirrored,
      concealed: character.concealed,
      concealedInEffect: presentedIdentity(character, {
        forcedName: forcedNameFrom(heldTagsComposed),
        concealment: concealmentFrom(heldTagsComposed),
      }).concealed,
      discordRoleId: character.discordRoleId,
      avatarMimeType: character.avatarMimeType,
      hasAvatar: Boolean(character.avatarMimeType),
    },
    discord: {
      // Two shapes: getGuildMember answers with Discord's raw member object
      // when it read one, and with a flat roster row when it served the
      // cached roster instead (discordGuild.js). Both carry the same two facts.
      username: member?.user?.username ?? member?.username ?? null,
      nickname: member?.nick ?? null,
      present: Boolean(member),
    },
    // The curse: what the rule says about this player right now, and whether a
    // GM has already forced it either way. Not under `discord` any more —
    // it stopped being a Discord fact when db/lib/curse.js took it over.
    curse: {
      cursed: await isPlayerCursed(prisma, character.discordUserId),
      override: character.cursedOverride ?? null,
    },
    // lastNameLocked is read off the already-loaded role rather than a
    // second query. The dynasty name is changed by editing the Baron,
    // which propagates to all three of his family.
    lastNameLocked: isDynastyMember(character.role?.slug),
    canDelete: isSuperadmin(actingDiscordUserId),
    transferRoster,
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      zoneId: l.zoneId,
      zoneName: l.zone?.name ?? null,
    })),
    roles: roles.map((r) => ({ id: r.id, name: r.name, groupSlug: r.groupSlug })),
    tags: allTags.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      category: t.category,
      // A GM reads a letter ungated (PAPERWORK.md); both helpers hand back the
      // plain description / null for anything that isn't paper, so this is a
      // passthrough for the other ~1000 rows.
      description: paperDescriptionGm(t),
      paper: paperViewGm(t),
      paperKind: t.paperKind,
      ephemeral: t.ephemeral,
      pointCost: t.pointCost,
      stackable: t.stackable,
      equippable: t.equippable,
      consumable: t.consumable,
      removable: t.removable,
      teachable: t.teachable,
      custom: t.custom,
      defaultDurationTurns: t.defaultDurationTurns,
      parentTagId: t.parentTagId,
      requiredTagId: t.requiredTagId,
      // Slugs, resolved to names client-side against this same list.
      removesInto: t.removesInto,
      weightLbs: t.weightLbs,
      group: t.group,
      // Precomputed server-side so the Heal-all and Inflict-wound
      // staging buttons and the server action agree on what an
      // affliction is — isHealable is the shared predicate.
      healable: isHealable(t),
    })),
    held: heldTagsComposed.map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      slug: ct.tag.slug,
      quantity: ct.quantity,
      equipped: ct.equipped,
      equippedQuantity: ct.equippedQuantity,
      // Where it sits, for the state strip's hands count (db/lib/equipSlots.js).
      equipSlot: ct.tag.equipSlot,
      twoHanded: ct.tag.twoHanded,
      expiresTurn: ct.expiresTurn,
      source: ct.source,
      // A negative pointCost is what makes a tag a drawback (TAGS.md §4a) —
      // read by nothing in this DTO's own band any more, but cheap to leave
      // for whatever next reads it off a held row rather than the catalog.
      pointCost: ct.tag.pointCost,
      // The band's Combat tile reads this same array (db/lib/fightingSkill.js
      // FIGHTING_TAG_FIELDS, db/lib/armorValue.js ARMOR_TAG_FIELDS) — one
      // query already fetched the whole Tag row, so this just carries what
      // combat arithmetic needs through to the client rather than a second
      // fetch.
      fighting: ct.tag.fighting,
      category: ct.tag.category,
      meleeArmor: ct.tag.meleeArmor,
      ballisticArmor: ct.tag.ballisticArmor,
      // The band's Afflictions tile — isHealable is the same predicate the
      // catalog's own `tags[].healable` above already runs.
      healable: isHealable(ct.tag),
    })),
    // The nested shape web/lib/sheetCards.js#buildCards wants (a `tag` on
    // every row, not a flattened one) — the main body's held-tags display
    // reuses the exact grouping/ordering the sheet and the GM inspector
    // already draw, rather than a second implementation of "what card does
    // this go in".
    characterTags: heldTagsComposed.map((ct) => ({
      tagId: ct.tagId,
      quantity: ct.quantity,
      equipped: ct.equipped,
      equippedQuantity: ct.equippedQuantity,
      expiresTurn: ct.expiresTurn,
      source: ct.source,
      tag: ct.tag,
    })),
    // "Fed them" is a real microaction now (feedCharacter, actions.js) that
    // sets hungerValue to HUNGER_MAX and clears the bands itself — it needs
    // no tag-op pair handed down the way the old drop-Hungry/grant-Ate-Meal
    // gesture did. DevBand's Hunger tile reads `character.hungerValue`
    // directly instead of a `feed.dropSlug` flag, so there is nothing to
    // hand down here for it any more.
    startingTagPoints: config?.startingTagPoints ?? 8,
    carry,
    openTurn: openTurn ? { id: openTurn.id, number: openTurn.number, dayNumber: openTurn.dayNumber } : null,
    // The parts, not just the total: the band's Gambit tile opens to say WHICH
    // modifiers, the way the player's own sheet does. Summed here rather than
    // calling gambitModifierTotal beside it — two calls to the same module is
    // two chances for the number and its explanation to disagree.
    gambitModifier: gambitParts.reduce((sum, m) => sum + m.value, 0),
    gambitParts,
    stagedForPush,
    openTurnAction: openTurnAction
      ? {
          id: openTurnAction.id,
          description: openTurnAction.description,
          moveKind: openTurnAction.moveKind,
          moveReviewStatus: openTurnAction.moveReviewStatus,
          resourceDelta: openTurnAction.resourceDelta,
          diceRoll: openTurnAction.diceRoll,
          diceModifier: openTurnAction.diceModifier,
          gmNotes: openTurnAction.gmNotes,
        }
      : null,
    desires: desires.map((d) => ({
      id: d.id,
      text: d.text,
      points: d.points,
      status: d.status,
      setTurnNumber: d.setTurnNumber,
      endedTurnNumber: d.endedTurnNumber,
      templateId: d.templateId,
      slotIndex: d.slotIndex,
      templateName: d.template?.name ?? null,
      templateTier: d.template?.tier ?? null,
    })),
    desireSlots: desireSlotsConfig,
    desireSlotStates,
    desireCatalog,
    desireFamilies: desireFamilies(),
    desireCooldowns,
    goalsSummary,
    // The band's Last activity tile — null for a character with no audit
    // history yet (a fresh creation nobody has touched).
    lastActivity: latestAudit
      ? { label: prettifyActionType(latestAudit.actionType), createdAt: latestAudit.createdAt.toISOString() }
      : null,
    adminNotesCount,
  };
}

// The Record tab's four history lists, split out of loadDevPanelProps above.
// They are 350 rows nobody sees until a GM clicks the fifth tab — and most
// visits to the panel are "grant a tag, close it", so they were the biggest
// thing the panel paid for and the least likely thing it used. DevPanel fetches
// this on the first switch to Record and caches it for the life of the mount.
//
// `discordUserId` is passed in rather than derived here, so the DM list keys
// off a value the caller resolved from the character row server-side — never
// off anything the client sent alongside the id.
export async function loadDevPanelRecord(characterId, discordUserId) {
  const [moves, auditLog, messages] = await Promise.all([
    prisma.action.findMany({
      where: { characterId },
      orderBy: { id: "desc" },
      take: 100,
      include: { turn: { select: { number: true, dayNumber: true } } },
    }),
    prisma.auditLog.findMany({ where: { targetCharacterId: characterId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.directMessage.findMany({
      where: { discordUserId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return {
    moves: moves.map((m) => ({
      id: m.id,
      turn: m.turn ? `Turn ${m.turn.number}` : "—",
      description: m.description,
      moveKind: m.moveKind,
      gmNotes: m.gmNotes,
      status: m.moveReviewStatus,
      resourceDelta: m.resourceDelta,
    })),
    auditLog: auditLog.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
