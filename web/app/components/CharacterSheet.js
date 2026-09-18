"use client";

import { MOTION_SICKNESS_SLUG, TRUMPET_SLUG } from "@lifeweb/db/lib/constants";
import { parksMounts } from "@lifeweb/db/lib/locationAttributes";
// Submodule path, not the @lifeweb/db barrel — this is a client component and
// the barrel drags PrismaClient into the browser bundle (ARCHITECTURE.md §2).
import { resourcesOf } from "@lifeweb/db/lib/resourceStack";
import BioForm from "./BioForm";
import CharacterPoller from "./CharacterPoller";
import EquipBoard from "./EquipBoard";
import GoalsPanel from "./GoalsPanel";
import HereList from "./HereList";
import LedgerBand from "./LedgerBand";
import LedgerWork from "./LedgerWork";
import MoodPanel from "./MoodPanel";
import RequestActionsProvider from "./RequestActionsProvider";
import RichText from "./RichText";
import StandingHerePanel from "./StandingHerePanel";
import TagRail from "./TagRail";

// The character sheet, at /character. See docs/systemdocs/SHEET.md.
//
// A band across the top — the face, the blackletter name, five tiles, the turn
// and combat boxes, and every verb in one strip — over TWO columns: what you
// have on the left (the tag rail, the inventory, the bio), and what you are
// wearing, how you feel and what you want on the right. Under 720px they stack.
// The whole thing scrolls as one ordinary page; nothing here scrolls inside
// itself.
//
// It was three columns behind a You / Do / Tags tab bar until phase 4 of the
// game 3 redesign (docs/design/mockups/character/index.html is the spec). The
// middle column existed mostly to give the bio form somewhere to be, and the
// tabs hid two thirds of a sheet on a phone — so reading your own wound cost
// two taps.
//
// The props are built once in character/page.js#FreshCharacter, which is also
// what /chat's YOU column reads from, so the two surfaces cannot disagree
// about what a character is carrying.
//
// The file this replaced was the older sheet — PageShell, chips for tags, an
// icon rack of verbs. The .ledger-* class names and the LedgerBand/LedgerWork
// components are that rebuild's own, kept on purpose rather than churned;
// SHEET.md §6 says why.

export default function CharacterSheet({
  character,
  mode,
  // The 0-100 hunger meter's ONLY client-visible trace (db/lib/hunger.js):
  // "hungry" | "starving" | null, resolved server-side in character/page.js
  // so the raw hungerValue never crosses into the flight payload at all.
  hungerWarning = null,
  openTurn,
  avatarSrc,
  transferParties,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  examineBlocked = null,
  // Eight flags the page computes off your own sheet and the provider gates
  // buttons on. They were passed here and dropped for a while, which is why
  // the Nuclear Datacard never showed its buttons: the provider's default
  // `false` won, silently. Torture and Mutilate were dropped the same way,
  // and had never once rendered until they were added to this list.
  canCrucify = false,
  canShackle = false,
  canDisguise = false,
  canPickpocket = false,
  canTorture = false,
  canMutilate = false,
  canBrand = false,
  canBreakRestraints = false,
  hasDatacard = false,
  hasStepstone = false,
  stepstoneTargets = [],
  hasDevice = false,
  // The THANATI section (docs/systemdocs/THANATI.md), resolved in
  // character/page.js and handed straight through to the dialogs.
  isThanati = false,
  isThanatiLeader = false,
  isCerberon = false,
  canWarrant = false,
  atHideout = false,
  hideoutRooms = [],
  hideoutStock = null,
  thanatiWares = [],
  // Same fate: BioForm's conceal toggle reads it, and it never arrived.
  concealGear = null,
  // World state the sheet shows: the bomb's countdown on its chip, and the
  // build this render came from, for the self-refresh poll.
  nukeArmedTurn = null,
  deployVersion = null,
  hasWorkshop = false,
  tagCatalog,
  desireSlots = 2,
  desireSlotLockTurns = 2,
  desireSlotStates = [],
  desireCatalog = [],
  desireFamilies = [],
  desireFamilyGroups = [],
  desireLockNotes = [],
  desireAddiction = null,
  canHeal = false,
  healsLeft = null,
  canMiracle = false,
  miracleTargets = [],
  miraclesLeft = null,
  // Surgery's site (the medical pass, M3, reworked M6b): whether one is in
  // reach at all, and whether the only thing standing in for it is a
  // Portable Surgical Pack, which the Gambit takes a −1 for.
  hasSurgicalSite = false,
  surgicalSitePenalty = false,
  // Lessons and Craft (LESSONS.md, CRAFTING.md), all built in character/page.js.
  hasMoved = false,
  // Research (CRAFTING.md §2b), same posture: three facts built
  // once in character/page.js and handed straight to the provider, which
  // composes them into canResearch/researchHint for the Research row in
  // the tag rail.
  holdsResearch = false,
  atCathedral = false,
  researchOptions = [],
  teachCostsMove = true,
  knownRecipeIds = [],
  deathMaskCorpses = [],
  craftProjects = [],
  // The turn's craft Move ledger and each ration's free units left, both
  // computed in character/page.js (web/lib/craftBudget.js).
  craftBudget = null,
  craftAllowances = {},
  // Building (db/lib/structures.js): what stands at this Location, and
  // whether the ground takes anything new. Both built in character/page.js.
  sitesHere = [],
  buildable = false,
  locationSlug = null,
  teachers = [],
  learners = [],
  confessors = [],
  mySins = [],
  pendingOffers = [],
  hasBird = false,
  hasRavenDraught = false,
  canRead = false,
  canWrite = false,
  hasSeal = false,
  canSeal = false,
  paperOptions = [],
  letterOptions = [],
  sealOptions = { stamps: [], letters: [] },
  birdSentToday = false,
  birdTargets = [],
  birdZones = [],
  birdReplies = [],
  healTargets = [],
  healParties = null,
  // Everyone and everything in this character's zone worth acting on, built
  // once in character/page.js so the Actions dialogs can't disagree about who
  // is standing here. Empty on someone else's sheet.
  corpses = [],
  canButcher = false,
  identity = null,
  canSeeExtract = false,
  canExtract = false,
  extractBlocked = null,
  canSeeRefine = false,
  canRefine = false,
  refineBlocked = null,
  canSeeMine = false,
  canMine = false,
  mineBlocked = null,
  canSeeFarm = false,
  canFarm = false,
  farmBlocked = null,
  farmMaxCrops,
  canSeePackage = false,
  lootTargets = [],
  // Who a cure or an administerable item could be given to (the medical
  // pass), and who is helpless enough to be dosed directly (M4). Both built
  // server-side in web/lib/peoplePools.js.
  consumeTargets = [],
  doseTargets = [],
  bindTargets = [],
  harmTargets = [],
  harmTags = [],
  kissTargets = [],
  searchParties = [],
  kissBlocked = null,
  avatarUploadsEnabled = false,
  playPanelEnabled = true,
  portraitMakerEnabled = false,
  portraitFantasyPartsEnabled = false,
  portraitSelection = null,
  hasCustomAvatar = false,
  // { name, tagName } while a held tag fixes the character's presented name
  // and face (Tag.forcedName); null otherwise. Self sheet only.
  forcedIdentity = null,
  // The mid-game Store, opened from the tag rail's header as a modal (see
  // TagRail.js / StorePanel.js). Absent on someone else's sheet.
  storeTags = null,
  storeHeldTags = null,
  // The seat, so the store's shelf can drop a tag this role may never buy
  // (Tag.excludedRoleSlugs). Null on someone else's sheet, like the two above.
  storeRoleSlug = null,
  // The turn card's first paint: { turn, move } from play/actions.js#myMove,
  // read by character/page.js beside everything else.
  moveState = null,
}) {
  const isSelf = mode === "self";
  // Held, not equipped: you pick a trumpet up to blow it.
  const hasTrumpet = character.tags?.some(
    (ct) => (ct?.tag?.slug ?? ct?.slug) === TRUMPET_SLUG,
  );
  // The two facts the rig needs beyond the slot rule, because equipActions.js
  // refuses on them too: a cart is not set up indoors — bar the places built
  // to be driven into (locationAttributes.js#parksMounts) — and a queasy stomach
  // rules out riding anything at all.
  const indoors = parksMounts(character.location);
  const motionSick = Boolean(
    character.tags?.some((ct) => (ct?.tag?.slug ?? ct?.slug) === MOTION_SICKNESS_SLUG),
  );

  return (
    <div className="sheet-body">
      {isSelf && <CharacterPoller deployVersion={deployVersion} />}

      {/* One provider around the band AND the grid: the verb strip in the
            band, the rows' verbs in the rail and the wound's Heal all open
            their dialogs through it, and they are a screen apart. */}
      <RequestActionsProvider
        enabled={isSelf}
        selfId={character.id}
        selfName={character.name}
        catalog={tagCatalog ?? []}
        characterTags={character.tags}
        // Off the tag rows, not a column — ⬢ are a stack now. This is what the
        // Transfer dialog reads to cap how many ⬢ you may hand over, so a
        // missing number here does not read as an error, it silently pins the
        // cap at 0 and the verb quietly stops working.
        resources={resourcesOf(character)}
        transferParties={transferParties}
        carry={carry}
        hasWorkshop={hasWorkshop}
        canHeal={canHeal}
        healsLeft={healsLeft}
        canMiracle={canMiracle}
        miracleTargets={miracleTargets}
        miraclesLeft={miraclesLeft}
        hasSurgicalSite={hasSurgicalSite}
        surgicalSitePenalty={surgicalSitePenalty}
        hasMoved={hasMoved}
        holdsResearch={holdsResearch}
        atCathedral={atCathedral}
        researchOptions={researchOptions}
        teachCostsMove={teachCostsMove}
        knownRecipeIds={knownRecipeIds}
        deathMaskCorpses={deathMaskCorpses}
        craftProjects={craftProjects}
        craftBudget={craftBudget}
        craftAllowances={craftAllowances}
        sitesHere={sitesHere}
        buildable={buildable}
        locationSlug={locationSlug}
        teachers={teachers}
        learners={learners}
        confessors={confessors}
        mySins={mySins}
        hasBird={hasBird}
        hasRavenDraught={hasRavenDraught}
        canRead={canRead}
        canWrite={canWrite}
        hasSeal={hasSeal}
        canSeal={canSeal}
        paperOptions={paperOptions}
        letterOptions={letterOptions}
        sealOptions={sealOptions}
        birdSentToday={birdSentToday}
        birdTargets={birdTargets}
        birdZones={birdZones}
        birdReplies={birdReplies}
        healTargets={healTargets}
        healParties={healParties}
        corpses={corpses}
        canButcher={canButcher}
        canSeeExtract={canSeeExtract}
        canExtract={canExtract}
        extractBlocked={extractBlocked}
        canSeeRefine={canSeeRefine}
        canRefine={canRefine}
        refineBlocked={refineBlocked}
        canSeeMine={canSeeMine}
        canMine={canMine}
        mineBlocked={mineBlocked}
        canSeeFarm={canSeeFarm}
        canFarm={canFarm}
        farmBlocked={farmBlocked}
        farmMaxCrops={farmMaxCrops}
        canSeePackage={canSeePackage}
        lootTargets={lootTargets}
        consumeTargets={consumeTargets}
        doseTargets={doseTargets}
        bindTargets={bindTargets}
        harmTargets={harmTargets}
        harmTags={harmTags}
        kissTargets={kissTargets}
        searchParties={searchParties}
        kissBlocked={kissBlocked}
        examineBlocked={examineBlocked}
        canCrucify={canCrucify}
        canShackle={canShackle}
        canDisguise={canDisguise}
        canPickpocket={canPickpocket}
        canTorture={canTorture}
        canMutilate={canMutilate}
        canBrand={canBrand}
        canBreakRestraints={canBreakRestraints}
        hasDatacard={hasDatacard}
        hasStepstone={hasStepstone}
        stepstoneTargets={stepstoneTargets}
        hasDevice={hasDevice}
        isThanati={isThanati}
        isThanatiLeader={isThanatiLeader}
        isCerberon={isCerberon}
        canWarrant={canWarrant}
        atHideout={atHideout}
        hideoutRooms={hideoutRooms}
        hideoutStock={hideoutStock}
        thanatiWares={thanatiWares}
      >
        <LedgerBand
          character={character}
          avatarSrc={avatarSrc}
          carry={carry}
          zoneMoves={zoneMoves}
          zoneMovesReason={zoneMovesReason}
          openTurn={openTurn}
          moveState={moveState}
          pendingOffers={pendingOffers}
          craftProjects={craftProjects}
          sitesHere={sitesHere}
          hasTrumpet={hasTrumpet}
          isSelf={isSelf}
          hungerWarning={hungerWarning}
        />

        <div className="ledger-body">
          {/* LEFT: what you have. The tag rail leads, because it is the thing a
              player opens the sheet to read; the two inventory cards come out of
              it (TagRail.js draws them as their own panels), then the bio. */}
          <div className="ledger-col">
            <TagRail
              // The ⬢ stack rides along: Bascinet wants it in the Items table like
              // any other thing you carry, weight and all. The band's tile keeps
              // the figure; TagRail keeps Destroy off the row (a one-click burn of
              // a character's savings is a road nothing else in the game has).
              characterTags={character.tags}
              isSelf={isSelf}
              selfId={character.id}
              identity={identity}
              tagPoints={character.tagPoints}
              tagCatalog={tagCatalog ?? []}
              currentTurn={openTurn?.number ?? null}
              storeTags={storeTags}
              storeHeldTags={storeHeldTags}
              storeRoleSlug={storeRoleSlug}
              nukeArmedTurn={nukeArmedTurn}
            />

            {isSelf ? (
              <section className="panel p-3">
                <h2 className="panel-header">Bio</h2>
                <BioForm
                  character={character}
                  avatarUploadsEnabled={avatarUploadsEnabled}
                  playPanelEnabled={playPanelEnabled}
                  portraitMakerEnabled={portraitMakerEnabled}
                  portraitFantasyPartsEnabled={portraitFantasyPartsEnabled}
                  portraitSelection={portraitSelection}
                  hasCustomAvatar={hasCustomAvatar}
                  forcedIdentity={forcedIdentity}
                  concealGear={concealGear}
                />
              </section>
            ) : (
              character.appearance && (
                <section className="panel p-3">
                  <h2 className="panel-header">Appearance</h2>
                  <p className="text-sm">
                    <RichText text={character.appearance} />
                  </p>
                </section>
              )
            )}

            {/* Under the Bio. It is a clock, not a verb — nothing on it
                presses — so it sits at the foot of the reading column rather
                than beside the rig, which is all controls. */}
            {isSelf && <LedgerWork craftProjects={craftProjects} sitesHere={sitesHere} />}
          </div>

          {/* RIGHT: what you are wearing, how you feel, and what you want —
              the three things the mockup puts in this column, in that order.
              Who's here and what stands here follow, because they are about
              the room rather than about you. */}
          <div className="ledger-col">
            <EquipBoard
              characterTags={character.tags}
              isSelf={isSelf}
              indoors={indoors}
              motionSick={motionSick}
              // The same rooms the Transfer dialog offers, so the board's empty
              // cells can hold out what a stash here is keeping. One list, one
              // reach rule: a door locked to the dialog is locked to the board.
              stash={transferParties?.rooms ?? []}
              carry={carry}
            />

            {/* The mood ladder, and only on your own sheet: the band above shows
                somebody else's word, and where that word sits plus the figure
                behind it is a private reading (the same posture the Combat tile
                takes). No narrative paragraph here (Bascinet, 2026-09-18): the
                only text for it would be Bascinet's own generic paragraph on
                what moves a mood, not this character's own reason — that one
                still lives on the band's Mood tile, one press away
                ("press for why"), which is what SHEET.md documents it as. */}
            {isSelf && <MoodPanel mood={character.mood ?? 0} />}

            {isSelf && (
              <GoalsPanel
                desireSlots={desireSlots}
                slotLockTurns={desireSlotLockTurns}
                slotStates={desireSlotStates}
                catalog={desireCatalog}
                families={desireFamilies}
                familyGroups={desireFamilyGroups}
                lockNotes={desireLockNotes}
                addiction={desireAddiction}
                openTurnNumber={openTurn?.number ?? null}
              />
            )}

            {/* Who is standing here, with the same menu /chat's column has — so
                Bind, Loot, Heal and the rest start from the person rather than
                from a picker. No seed: the list is read on mount, which is the
                click that asked. */}
            {isSelf && (
              <section className="panel p-3">
                <h2 className="panel-header">Who&apos;s here</h2>
                <HereList people={null} selfId={character.id} poll />
              </section>
            )}

            <StandingHerePanel sites={sitesHere} />
          </div>
        </div>
      </RequestActionsProvider>
    </div>
  );
}
