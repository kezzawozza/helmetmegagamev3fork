"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { tagsById as buildTagsById, heldHigherTiers } from "@/lib/characterCreation";
import { craftableTags, destroyableTags, consumableTags, placementOfferedHere } from "@/lib/tagRequests";
import { useConfirm } from "./ConfirmProvider";
import { heldSlugsOf } from "@/lib/consumeGrants";
import { useNotice } from "./NoticeProvider";
import { INSTANT, DIALOGS, FAST_PATHS } from "./actions";
import { ActionPoolsContext } from "./actions/poolsContext";
import { noticeLine } from "./actions/noticeLines";
// Prisma-free on purpose (it takes `db` as a parameter), so importing it here
// does not drag the @lifeweb/db barrel into the browser bundle.
import { RECOVERABLE_SLUGS } from "@lifeweb/db/lib/thanati";

// Every player action on the character sheet: the mode that is open, what
// the grid greys each button on, and the one place a result is spoken.
// Renders no chrome of its own — mounted once per sheet (CharacterSheet.js,
// self mode only) and once on /chat, read off
// context by ActionGrid.js, HereList.js, RoomPanel.js and ThingsDrawer.js.
//
// This is a ROUTER now. It used to hold every dialog's fields and every
// dialog's body — forty pieces of state reset on each open, one switch to run
// the action and one to decide whether it could be. Each dialog owns its own
// state in components/actions/*, and this decides three things on a click:
//
//   an INSTANT verb   → confirm if it has a question, run, say the result;
//   a FAST PATH       → the picker's answer was already known (Bind from a
//                       person's own row), so ask the one question and run;
//   everything else   → mount the dialog for the mode.
//
// `open(mode, presetTagId, presets)` keeps the shape every caller always used.

const RequestActionsContext = createContext(null);

export function useRequestActions() {
  return useContext(RequestActionsContext);
}

export default function RequestActionsProvider({
  children,
  // False on someone else's sheet — hooks still run unconditionally, but no
  // context/dialog is handed down, so the tag rail's rows stay read-only.
  enabled = true,
  selfId,
  selfName,
  catalog = [],
  characterTags = [],
  resources = 0,
  transferParties = null,
  // Your faction's silo, when there is one and you are in its zone: a
  // deposit-only destination the Transfer dialog pins above the rooms here
  // (FACTIONS.md). Null the rest of the time.
  transferSilo = null,
  // Load vs caps for the Transfer dialog's projection line (CARRY.md).
  carry = null,
  // Why this character's eyes cannot look anyone over right now, or null.
  // Resolved server-side in character/page.js (db/lib/examineVision.js) —
  // examineActions.js refuses with the same sentence.
  examineBlocked = null,
  hasWorkshop = false,
  canHeal = false,
  healsLeft = null,
  // Surgery needs a site (M3, TAGS.md §5c; reworked M6b) — whether Surgical
  // Equipment, a Surgical Theater, or a Portable Surgical Pack is in reach
  // right now, resolved server-side (web/lib/peoplePools.js). A hint for the
  // tier-6/7 rows below; the server re-checks it under lock either way.
  hasSurgicalSite = false,
  // True only when a Portable Surgical Pack is the ONE thing making
  // hasSurgicalSite true — the fixed kit or a real Theater in reach cancels
  // this outright. That's the only case a surgery Gambit takes its −1.
  surgicalSitePenalty = false,
  healTargets = [],
  // Who can pay for a treatment or a craft: you, anyone here, rooms here.
  healParties = null,
  // Craft (CRAFTING.md): the recipe ids whose skills you hold, decided
  // server-side, and your projects in progress.
  knownRecipeIds = [],
  // The Death Mask's corpse shortlist — held corpses whose face is still
  // theirs, server-computed in character/page.js. See ingredientPick below.
  deathMaskCorpses = [],
  craftProjects = [],
  // The craft Move budget (CRAFTING.md §2a), both server-computed in
  // character/page.js. `craftBudget` is this turn's ledger — which family of
  // work the Routine is committed to and how much of the Move is left, or
  // null. `craftAllowances` is `{ [tagId]: { per, left } }` for every rationed
  // 0-turn recipe. Advisory: craftRequest re-checks all of it under a lock.
  craftBudget = null,
  craftAllowances = {},
  // Building (db/lib/structures.js). `sitesHere` is every structure at this
  // Location, all statuses; `buildable` is whether the ground takes anything
  // new at all. Both decided server-side in character/page.js, and both are
  // menu hygiene — openBuildSiteImpl re-checks each refusal.
  sitesHere = [],
  buildable = false,
  // The Location's own slug, for the per-type site gate
  // (Tag.placement.locations). Null just means the gate is left to the
  // server — placementOfferedHere fails open on it.
  locationSlug = null,
  // Lessons (LESSONS.md): who could teach you what, and whom you could teach.
  teachCostsMove = true,
  teachers = [],
  learners = [],
  // Confession (CONFESSION.md). `confessors` is who here can hear one;
  // `mySins` is my own psychological tags. There is no chaplain-side list.
  confessors = [],
  mySins = [],
  // Whether a Move is already filed this turn — a craft with turns needs one.
  hasMoved = false,
  // Research (the Scholastic skill, CRAFTING.md §2b): whether you hold it at
  // all, whether you're standing in the Cathedral, and the held ingredients
  // that are in ANY recipe (db/lib/research.js#researchableHeld, computed
  // server-side so the picker and researchRequest's own re-check agree). All
  // three are folded into `canResearch` below, which is what the sheet's
  // Research row (TagRail.js) and the Cathedral's place card (play/PlaceCard.js)
  // both draw off.
  holdsResearch = false,
  atCathedral = false,
  researchOptions = [],
  // Built once in character/page.js so the four target menus can't disagree.
  lootTargets = [],
  // Consume's optional administer target: everyone alive on this roster, a
  // corpse being nobody to hand a cure to. Empty selection means self.
  consumeTargets = [],
  bindTargets = [],
  harmTargets = [],
  harmTags = [],
  // Poison's own dose-a-helpless-person roster (M4) — the same helpless class
  // HARM/LOOT use, built once server-side (web/lib/peoplePools.js) so this
  // menu and the server's own re-check can't disagree.
  doseTargets = [],
  // Kiss (docs/systemdocs/KISS.md). `kissTargets` is who you could ask;
  // `kissBlocked` is why YOU can't ask anybody, or null — your own broken jaw,
  // your own hood. Both resolved server-side in web/lib/peoplePools.js so the
  // greyed button and kissRequestImpl's refusal read the same sentence.
  kissTargets = [],
  kissBlocked = null,
  // Corpses (CORPSES.md): every body in reach — yours and the ones lying in
  // rooms here — built once server-side by db/lib/corpses.js#corpsesInReach so
  // the menu and the two server re-checks can't disagree about what you can
  // touch. canButcher is just "do you hold the Butcher tag".
  corpses = [],
  canButcher = false,
  // The Bird. birdTargets is EVERY character, alive or dead, on purpose —
  // and the Raven Draught reaches into the same list, for the same reason.
  hasBird = false,
  hasRavenDraught = false,
  birdSentToday = false,
  birdTargets = [],
  birdZones = [],
  // Letters the bird is still standing over, waiting to carry an answer back
  // (docs/systemdocs/BIRD.md). Not gated on holding a bird: the one that
  // brought the letter is the one that takes the reply.
  birdReplies = [],
  // Paperwork (docs/systemdocs/PAPERWORK.md). `canRead` is letters AND eyes,
  // resolved server-side so the button, the tag chip and the action's own
  // refusal all say the same thing. The option lists carry an EXCERPT rather
  // than the whole text, and only for a reader — the full text is fetched on
  // demand so an unreadable sheet never sits in the page source.
  canRead = false,
  canWrite = false,
  hasSeal = false,
  canSeal = false,
  paperOptions = [],
  // Everything the bird could carry: written notes AND sealed letters. A
  // courier does not have to be able to read what they are carrying, so this
  // is not gated on literacy — only the excerpts inside it are.
  letterOptions = [],
  sealOptions = { stamps: [], letters: [] },
  // Books (docs/systemdocs/PAPERWORK.md). No excerpts here — a book's name IS
  // its title, unlike a note's deliberately anonymous waybill code.
  // The Godard Factory (docs/systemdocs/FACTORY.md). All three are facts about
  // where this character is standing and what is in their hands, resolved
  // server-side in character/page.js — the actions re-check every one.
  canSeeExtract = false,
  canExtract = false,
  extractBlocked = null,
  canSeePackage = false,
  // Crucify: you hold `fundamentalist` and a COMPLETE Cross stands where you
  // are. Both facts about YOUR sheet and YOUR ground, resolved in
  // character/page.js; the action re-checks both.
  canCrucify = false,
  // Disguise: you are carrying a disguise kit. Hidden rather than greyed —
  // see actionRegistry.js.
  canDisguise = false,
  // Torture: you hold `torturer`. Your own sheet; the action re-checks it and
  // that the target is Bound.
  canTorture = false,
  canMutilate = false,
  // Brand: you hold `branding-iron`. Your own sheet; the action re-checks it
  // and that the target is bound or otherwise incapacitated
  // (INCAPACITATING_SLUGS — TORTURE.md §8). Reuses `doseTargets` above.
  canBrand = false,
  // Break Restraints: you hold `bound`. Your own sheet, the same HIDDEN rule
  // as Extract — the action re-checks the tag and the Move itself.
  canBreakRestraints = false,
  // The datacard, and the device itself. Both facts about your own sheet.
  hasDatacard = false,
  hasDevice = false,
  // The Stepstone. Whether you carry one is your own sheet; where you may step
  // is the fog behind /map, resolved server-side in character/page.js and
  // re-checked by stepstoneRequest.
  hasStepstone = false,
  stepstoneTargets = [],
  // THE THANATI (docs/systemdocs/THANATI.md). Whether you are one and whether
  // you lead are your own sheet; the hideout is one you set. `hideoutRooms`
  // is Set Hideout's picker, `thanatiWares` / `hideoutStock` are Purchase
  // Gear's shelf and the purse on the hideout's floor.
  isThanati = false,
  isThanatiLeader = false,
  isCerberon = false,
  canTax = false,
  canWarrant = false,
  atHideout = false,
  hideoutRooms = [],
  hideoutStock = null,
  thanatiWares = [],
}) {
  const [mode, setMode] = useState(null);
  const confirm = useConfirm();
  const notice = useNotice();
  const [, startTransition] = useTransition();
  // Which instant verb is in flight, so its button can say so.
  const [busy, setBusy] = useState(null);
  // What a caller already knew when it opened the dialog — the person whose
  // row was clicked, the stack, the two ends of a move — handed to the dialog
  // component for the mode (components/actions/*).
  const [presets, setPresets] = useState(null);

  const heldIds = useMemo(
    () => characterTags.map((ct) => ct.tagId),
    [characterTags],
  );
  // The catalog excludes gate-opening tags (Demoness). Fold in
  // held tags too, or a chain walk from a held gate tag dead-ends.
  const gateById = useMemo(
    () =>
      buildTagsById([
        ...catalog,
        ...characterTags.map((ct) => ct.tag).filter(Boolean),
      ]),
    [catalog, characterTags],
  );
  // heldHigherTiers hides rungs below a held chain tier — craftRequest
  // rejects the same thing server-side.
  // A site is only joinable while it is going up; the rest of sitesHere is
  // for the standing-here panel.
  const buildSites = useMemo(
    () => sitesHere.filter((s) => s.status === "UNDER_CONSTRUCTION"),
    [sitesHere],
  );
  const craftable = useMemo(
    () =>
      craftableTags(catalog, heldIds, knownRecipeIds)
        .filter((t) => heldHigherTiers(t, gateById, heldIds).length === 0)
        // A placement you could not raise on this ground is dropped rather
        // than offered and refused.
        .filter((t) =>
          placementOfferedHere(t, { buildable, sites: sitesHere, locationSlug }),
        ),
    [catalog, heldIds, knownRecipeIds, gateById, buildable, sitesHere, locationSlug],
  );
  const removable = useMemo(
    () => destroyableTags(characterTags),
    [characterTags],
  );
  const consumable = useMemo(
    () => consumableTags(characterTags),
    [characterTags],
  );
  // The poison-use dialog's own two narrowed views over `consumable` (M4):
  // held poisons (what the chip click and the grid button both offer), and
  // held food/drink a poison could lace — never another poison (you can't
  // lace the bottle itself), and only the two groups the plan names.
  const poisonable = useMemo(() => consumable.filter((t) => t.poison), [consumable]);
  const foodTargets = useMemo(
    () =>
      consumable.filter(
        (t) => !t.poison && (t.group?.slug === "items-food" || t.group?.slug === "items-drink"),
      ),
    [consumable],
  );
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);
  // Which of the robes and the mask are NOT on this sheet — what Recover
  // Equipment would hand back, and the label the button wears
  // (actionRegistry.js#labelFor). Your own pockets, so the button may grey.
  const recoverMissing = useMemo(
    () => RECOVERABLE_SLUGS.filter((slug) => !heldSlugs.has(slug)),
    [heldSlugs],
  );

  // Everything the dialogs read (components/actions/poolsContext.js): the
  // page's rosters as seeds, and the own-sheet facts. A plain object, so a
  // dialog always sees this render's props.
  const bag = {
    selfId,
    selfName,
    characterTags,
    // Letters AND eyes, resolved once in web/lib/selfPools.js. Package reads
    // it to decide whether to offer a line for the side of the crate.
    canRead,
    resources,
    carry,
    transferParties,
    transferSilo,
    lootTargets,
    consumeTargets,
    bindTargets,
    harmTargets,
    harmTags,
    doseTargets,
    kissTargets,
    kissBlocked,
    corpses,
    healTargets,
    healParties,
    healsLeft,
    hasSurgicalSite,
    surgicalSitePenalty,
    hasMoved,
    teachCostsMove,
    teachers,
    learners,
    confessors,
    mySins,
    paperOptions,
    letterOptions,
    sealOptions,
    birdTargets,
    birdZones,
    birdReplies,
    stepstoneTargets,
    hideoutRooms,
    hideoutStock,
    thanatiWares,
    atHideout,
    researchOptions,
    // Poison's own two narrowed views over `consumable` (actions/PoisonDialog.js).
    poisonable,
    foodTargets,
    // Craft's slice (actions/CraftAction.js).
    craftable,
    gateById,
    heldIds,
    buildSites,
    craftProjects,
    craftBudget,
    craftAllowances,
    deathMaskCorpses,
    hasWorkshop,
  };
  // Read through a ref by `open`, which is memoized and would otherwise hold
  // the first render's rosters forever — the pattern Modal.js uses for
  // onClose. Written in an effect, never during render.
  const bagRef = useRef(bag);
  useEffect(() => {
    bagRef.current = bag;
  });

  const runNow = useCallback(
    async (next, { ask = null, run, ctx = null }) => {
      if (ask && !(await confirm(ask))) return;
      setBusy(next);
      startTransition(async () => {
        try {
          const res = await run();
          if (!res?.ok) {
            notice({ text: res?.error ?? "Something went wrong.", tone: "bad" });
            return;
          }
          notice({
            text: noticeLine(next, res, ctx),
            rows: Array.isArray(res.roster)
              ? res.roster.map((r) => ({ name: r.name, note: r.role, mark: r.leader ? "[LEADER]" : null }))
              : null,
          });
        } catch {
          notice({ text: "Could not reach the server. Nothing was changed.", tone: "bad" });
        } finally {
          setBusy(null);
        }
      });
    },
    [confirm, notice],
  );

  const runInstant = useCallback(
    (next) => {
      const verb = INSTANT[next];
      if (!verb) return;
      runNow(next, { ask: verb.confirm({ recoverMissing }), run: verb.run });
    },
    [runNow, recoverMissing],
  );

  const open = useCallback(
    (next, presetTagId = null, presets = null) => {
      // The world is NOT re-read here any more. It used to be — a whole server
      // render of the sheet page on every open, to keep "who is standing here"
      // honest. Each dialog now reads its own slice the moment it mounts
      // (components/actions/useRoster.js), which is cheaper, and paints the
      // page's copy until the answer lands.
      const seed = { ...(presets ?? {}), ...(presetTagId ? { tagId: presetTagId } : {}) };
      if (INSTANT[next]) {
        runInstant(next);
        return;
      }
      // Opened from a person's own row with everything already decided —
      // Bind from Ada's menu — the picker is skipped and the one question
      // asked straight away.
      const shortcut = FAST_PATHS[next]?.(seed, bagRef.current);
      if (shortcut) {
        runNow(next, shortcut);
        return;
      }
      setPresets(seed);
      setMode(next);
    },
    [runInstant, runNow],
  );

  // Research (CRAFTING.md §2b). A READOUT — researchRequestImpl re-checks all
  // three gates under its own read.
  const canResearch = holdsResearch && atCathedral && !hasMoved && researchOptions.length > 0;
  const researchHint = !holdsResearch
    ? null // Never shown: nobody without the tag ever asks why the verb is
      // missing, because the row it hangs off isn't on their sheet.
    : !atCathedral
      ? "Go to the Cathedral."
      : hasMoved
        ? "Your Move is already used."
        : researchOptions.length === 0
          ? "You're carrying nothing worth studying."
          : null;

  // What the grid needs to grey a button out — this character's sheet only.
  const pools = useMemo(
    () => ({
      canCraft:
        craftable.length > 0 ||
        craftProjects.length > 0 ||
        buildSites.length > 0,
      canDestroy: removable.length > 0,
      canConsume: consumable.length > 0,
      canPoison: poisonable.length > 0,
      canHeal,
      // Research's two, composed here rather than at either call site so the
      // sheet row and the place card can never disagree. `canResearch` is
      // every gate open at once; `researchHint` names the first one that
      // isn't, in the order a player would fix them — get to the Cathedral,
      // free up the Move, then find something worth studying. Both are null/
      // false for anyone without the tag, who is never shown either.
      canResearch,
      researchHint,
      canExamine: !examineBlocked,
      // The sentence ActionGrid appends to a greyed button's tooltip, so a
      // player reads why instead of DMing to ask.
      gateReason: { examine: examineBlocked, extract: extractBlocked, kiss: kissBlocked },
      canLearn: teachers.length > 0,
      // Symmetrical with canLearn: a list the server already filtered to who
      // is standing here and what they could actually take off you.
      canTeach: learners.length > 0,
      teachCostsMove,
      // Your own sheet only. Greying this on whether a chaplain happens to be
      // standing here would announce their presence to anyone who glanced at
      // their own page — the rule at the top of actionRegistry.js.
      canConfess: mySins.length > 0,
      // Your own mouth, never the room's. A Kiss button that lit up only when
      // somebody kissable was standing there would be free scouting on every
      // page load — the rule at the top of actionRegistry.js.
      canKiss: !kissBlocked,
      kissTargets,
      // `show` gates whether ActionGrid renders the icon; canSendBirdToday
      // is a `gate` on top, so the button exists but is dead post-send.
      hasBird,
      hasRavenDraught,
      hasStepstone,
      canRead,
      canWrite,
      hasSeal,
      canSeal,
      // HIDES rather than greys, the rule the Write and Seal buttons above it
      // follow: a Reply that sat there dead would teach a player only that
      // somebody might have written to them.
      hasBirdReply: birdReplies.length > 0,
      // Holding a book IS having one to tear up — no second prop for it.
      canSendBirdToday: !birdSentToday,
      canButcher,
      canSeeExtract,
      canExtract,
      canSeePackage,
      canCrucify,
      canDisguise,
      canTorture,
      canMutilate,
      canBrand,
      canBreakRestraints,
      hasDatacard,
      hasDevice,
      isThanati,
      isThanatiLeader,
      isCerberon,
      canTax,
      canWarrant,
      atHideout,
      canRecover: recoverMissing.length > 0,
      recoverMissing,
    }),
    [
      recoverMissing,
      craftable,
      craftProjects,
      buildSites,
      removable,
      consumable,
      poisonable,
      canHeal,
      canResearch,
      researchHint,
      examineBlocked,
      extractBlocked,
      kissBlocked,
      kissTargets,
      teachers,
      learners,
      teachCostsMove,
      mySins,
      hasBird,
      hasRavenDraught,
      hasStepstone,
      canRead,
      canWrite,
      hasSeal,
      canSeal,
      birdSentToday,
      birdReplies,
      canButcher,
      canSeeExtract,
      canExtract,
      canSeePackage,
      canCrucify,
      canDisguise,
      canTorture,
      canMutilate,
      canBrand,
      canBreakRestraints,
      hasDatacard,
      hasDevice,
      isThanati,
      isThanatiLeader,
      isCerberon,
      canTax,
      canWarrant,
      atHideout,
    ],
  );

  // `selfId` rides along so a caller can build the `character:<id>` party key
  // the Transfer presets take without being handed the id a second way. The
  // Chat's room panel is the one that needs it (Drop and Take name both ends).
  const value = useMemo(
    () => (enabled ? { open, pools, selfId, busy } : null),
    [enabled, open, pools, selfId, busy],
  );

  // The dialog for the open mode (components/actions/index.js).
  const Dialog = mode ? (DIALOGS[mode] ?? null) : null;
  // Closes the dialog and says what it did, if it did anything.
  const done = useCallback(
    (line) => {
      setMode(null);
      if (line) notice(line);
    },
    [notice],
  );

  return (
    <RequestActionsContext.Provider value={value}>
      {children}
      {enabled && Dialog && (
        // `open` rides along here rather than through a second context: a
        // dialog that wants to switch to another mode — HealDialog's "or
        // use: …" item-cure shortcut (actions/HealDialog.js) — would
        // otherwise have to import this module to reach it, which is
        // exactly the import loop components/actions/poolsContext.js exists
        // to avoid (this file imports every dialog through
        // components/actions/index.js).
        <ActionPoolsContext.Provider value={{ ...bag, open }}>
          <Dialog mode={mode} presets={presets ?? {}} onDone={done} onClose={() => setMode(null)} />
        </ActionPoolsContext.Provider>
      )}
    </RequestActionsContext.Provider>
  );
}
