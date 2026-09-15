"use client";

import { useCallback, useMemo, useState } from "react";
import CraftDialog from "../CraftDialog";
import TagPicker from "./TagPicker";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { useConfirm } from "../ConfirmProvider";
import { useActionPools } from "./poolsContext";
import { craftFamily, moveFamilyOf } from "@/lib/tagRequests";
// The craft Move budget. Pure arithmetic, no prisma — the same module the
// server enforces with, so the dialog's numbers and the server's refusals
// come from one place (docs/systemdocs/CRAFTING.md §2a).
import {
  WHOLE_MOVE,
  craftMoveCost,
  fitsInRemaining,
  formatMoveFraction,
  unitsAffordable,
} from "@/lib/craftBudget";
import { heldSlugsOf } from "@/lib/consumeGrants";
import { customCraftFor } from "@/lib/customCraft";
import {
  craftRequest,
  continueCraft,
  cancelCraft,
  joinBuildSite,
  cancelBuildSite,
} from "@/app/(app)/character/requestActions";

// Craft (docs/systemdocs/CRAFTING.md): the recipe catalog, a project in
// progress or a build site to keep working, the Move budget readout and the
// three-branch confirm. Moved out of RequestActionsProvider whole — the
// budget maths and the confirm wording are ~400 lines of interlocking state
// that the server re-checks under a lock, and none of it was changed on the
// way. CraftDialog.js is still the form; this owns the state around it.

// Maps a "kind:id" party key back to a name for the confirm prompt.
function payerLabel(parties, key) {
  const [kind, id] = (key ?? "").split(":");
  const pool = kind === "room" ? parties?.rooms : parties?.characters;
  return pool?.find((p) => p.id === id)?.name ?? "They";
}

export default function CraftAction({ presets, onDone, onClose }) {
  const {
    selfId,
    characterTags = [],
    craftable = [],
    gateById = null,
    heldIds = [],
    buildSites = [],
    craftProjects = [],
    craftBudget = null,
    craftAllowances = {},
    deathMaskCorpses = [],
    hasWorkshop = false,
    healParties = null,
    hasMoved = false,
  } = useActionPools();

  const [tagId, setTagId] = useState(presets?.tagId ?? null);
  const [quantity, setQuantity] = useState("1");
  // A project in progress, and what to do with it.
  const [projectId, setProjectId] = useState("");
  // A build site standing here, picked from the same dropdown as a project.
  const [siteId, setSiteId] = useState("");
  const [projectChoice, setProjectChoice] = useState("continue");
  // Which member of a recipe's `anyOf` ingredient goes in.
  const [ingredientChoice, setIngredientChoice] = useState("");
  // The slugs a cook slotted, in order, on a recipe with `ingredientSlots`
  // (docs/systemdocs/COOKING.md). Deliberately NOT folded into
  // ingredientChoice above: that one is a single pick from a list the recipe
  // wrote down, and this is an ordered set out of a catalog the recipe says
  // nothing about. A recipe never carries both.
  const [ingredientChoices, setIngredientChoices] = useState([]);
  // The custom-item fields on a `customizable` recipe, and the builder's
  // line on an inscribable placement (CRAFTING.md). Raw as typed — the
  // shared cleaner (web/lib/customCraft.js) decides what they amount to, on
  // both sides, so the +1 ⬢ shown is the +1 ⬢ billed.
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [inscription, setInscription] = useState("");
  const [payerKey, setPayerKey] = useState(selfId ? `character:${selfId}` : "");
  // Smithing only (SMITHING.md, requestActions.js#resolveObolSpend): held
  // Obols put toward this craft's cost before the payer covers the rest.
  const [obolsSpent, setObolsSpent] = useState("0");
  const confirm = useConfirm();
  const { submit: run, busy, error } = useSubmit();
  const mode = "craft";

  const chosen = useMemo(() => craftable.find((t) => t.id === tagId) ?? null, [craftable, tagId]);
  // A placement is a place, not a stack, and openBuildSiteImpl ignores the
  // count anyway.
  const stacking = Boolean(chosen?.stackable) && !chosen?.placement;
  const heldSlugs = useMemo(() => heldSlugsOf(characterTags), [characterTags]);

  // An `anyOf` ingredient (Tag.requirementItems) is the one part of a recipe
  // the catalog cannot decide for the player: which delicacy goes into the
  // Lavish Meal. Only members they are actually holding are offered — the
  // server re-checks both membership and possession, so this is a shortlist,
  // not a gate. At most one per recipe; the sync refuses a second.
  const ingredientPick = useMemo(() => {
    if (mode !== "craft") return null;
    // The Death Mask's `group` corpse entry needs a SPECIFIC body — same
    // picker, same ingredientChoice channel (a recipe never carries both an
    // anyOf and this; the sync caps anyOf at one and only this recipe binds
    // a group member). The server re-resolves the choice like any other
    // (requestActions.js#resolveDeathMaskSource).
    if (chosen?.slug === "death-mask") {
      return { label: "Whose face?", options: deathMaskCorpses };
    }
    const entry = (chosen?.requirementItems ?? []).find(
      (i) => i?.kind === "anyOf",
    );
    if (!entry) return null;
    return {
      label: entry.label,
      options: (entry.options ?? []).filter((o) => heldSlugs.has(o.slug)),
    };
  }, [mode, chosen, heldSlugs, deathMaskCorpses]);
  // One option needs no decision, so it is taken as made rather than asked for.
  const ingredientChoiceValue =
    ingredientChoice ||
    (ingredientPick?.options.length === 1
      ? ingredientPick.options[0].slug
      : "");

  // COOKING (docs/systemdocs/COOKING.md). Deliberately NOT given the auto-pick
  // above: slotting a cook's only onion into a Fine Meal because it was the
  // only thing they were carrying would spend it without being asked. An
  // optional slot has to stay empty until somebody clicks it.
  const ingredientSlots = chosen?.requirementIngredientSlots ?? null;
  // Everything on this sheet that can go in a pot: a `cooked` block is the
  // whole membership rule, and the block reaching the browser has already
  // been cut to its taste server-side (web/lib/referenceData.js).
  //
  // Computed off the sheet rather than off the chosen recipe, because
  // recipeBlocked below has to answer for EVERY recipe in the menu, including
  // the ones nobody has clicked yet.
  const cookables = useMemo(
    () =>
      characterTags
        .filter((ct) => ct.tag?.cooked && ct.tag.slug)
        .map((ct) => ({
          slug: ct.tag.slug,
          name: ct.tag.name,
          taste: ct.tag.cooked.taste ?? "",
          held: ct.quantity ?? 1,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [characterTags],
  );

  // --- Craft's Move budget ------------------------------------------------
  //
  // Everything here is a READOUT. The numbers come off the two server-computed
  // props, the arithmetic is the same module craftRequest enforces with, and
  // every refusal below is repeated server-side under a row lock. A greyed row
  // is a hint; the server is the lock.
  const craftQty =
    mode === "craft" && chosen?.stackable
      ? Math.max(1, Number(quantity) || 1)
      : 1;
  const craftRemaining = useMemo(
    () =>
      craftBudget
        ? { num: craftBudget.remainingNum, den: craftBudget.remainingDen }
        : hasMoved
          ? { num: 0, den: 1 }
          : WHOLE_MOVE,
    [craftBudget, hasMoved],
  );
  // What one recipe costs of the Move at a given count, priced against the
  // free units this turn has left.
  const priceRecipe = useCallback(
    (tag, units) =>
      craftMoveCost(tag, {
        quantity: units,
        allowance: craftAllowances[tag.id]?.per ?? null,
        freeLeft: craftAllowances[tag.id]?.left ?? null,
        // Same override the server prices with — a never-spills recipe
        // (Obol) reads as family-less here too, so the client's own "capped"
        // read never disagrees with the refusal craftRequest would give.
        family: moveFamilyOf(tag),
      }),
    [craftAllowances],
  );
  // Can the turn still pay for this? A free craft always can.
  const affordsMove = useCallback(
    (cost) => {
      if (!cost || cost.kind === "free") return true;
      if (cost.kind === "capped") return false;
      return fitsInRemaining(cost, craftRemaining);
    },
    [craftRemaining],
  );
  const craftCost = useMemo(
    () => (mode === "craft" && chosen ? priceRecipe(chosen, craftQty) : null),
    [mode, chosen, craftQty, priceRecipe],
  );
  const craftAllowance = chosen ? (craftAllowances[chosen.id] ?? null) : null;
  const craftMoveOk = affordsMove(craftCost);
  // What the quantity stepper stops at: the ingredients on your own sheet, and
  // what the Move can still pay for. The 99 is craftRequest's own clamp.
  const heldBySlug = useMemo(
    () =>
      new Map(
        characterTags
          .filter((ct) => ct.tag?.slug)
          .map((ct) => [ct.tag.slug, ct.quantity ?? 1]),
      ),
    [characterTags],
  );
  // Smithing only — an obol is one ⬢ (DEPOT.md), so a smith may put some of
  // their own held Obols toward this craft's cost, the rest billed to the
  // usual payer (SMITHING.md, requestActions.js#resolveObolSpend). Read off
  // the sheet the same way every other ingredient count on this form is.
  const isSmithing = chosen ? craftFamily(chosen) === "smithing" : false;
  const craftResourceCost = useMemo(() => {
    if (mode !== "craft" || !chosen) return 0;
    const { surcharge } = customCraftFor(chosen, { customName, customDescription });
    return ((chosen.requirementResources ?? 0) + surcharge) * craftQty;
  }, [mode, chosen, customName, customDescription, craftQty]);
  const heldObols = heldBySlug.get("obol") ?? 0;
  const obolsSpentNum = isSmithing
    ? Math.min(Math.max(0, Number(obolsSpent) || 0), heldObols, craftResourceCost)
    : 0;
  const craftRemainingResourceCost = craftResourceCost - obolsSpentNum;
  // Why a recipe can't be picked at all right now. Ingredients first — a
  // spent ingredient you don't hold blocks the recipe Move or no Move, and
  // greyed-with-a-reason beats a refusal after the confirm. `group` entries
  // (a corpse to hand) stay the server's call. The Move questions are only
  // asked once the turn's Move is spoken for, so an untouched turn greys
  // nothing on that account.
  const recipeBlocked = useCallback(
    (tag) => {
      for (const item of tag.requirementItems ?? []) {
        if (item.keep || item.kind === "group") continue;
        const held =
          item.kind === "anyOf"
            ? (item.options ?? []).some((o) => (heldBySlug.get(o.slug) ?? 0) >= (item.count ?? 1))
            : (heldBySlug.get(item.slug) ?? 0) >= (item.count ?? 1);
        if (!held)
          return `You don't have the ${item.label || "ingredients"} it uses.`;
      }
      // A recipe that REQUIRES an ingredient is unpickable with an empty
      // pantry. One that merely offers a slot never is — a Fine Meal with
      // nothing in it is still a Fine Meal.
      if ((tag.requirementIngredientSlots?.min ?? 0) > 0 && !cookables.length) {
        return "You don't have any ingredients.";
      }
      if (!hasMoved) return null;
      const cost = priceRecipe(tag, 1);
      if (cost.kind === "free" || affordsMove(cost)) return null;
      // A capped recipe hit its ration, not the Move — bone-mask past its
      // one-a-turn would otherwise be blamed on a Routine it never touches.
      if (cost.kind === "capped") {
        return "You've made all of those a turn allows.";
      }
      if (!craftBudget) return "You've already used your Move this turn.";
      return "There isn't enough of your Move left for that.";
    },
    [hasMoved, craftBudget, priceRecipe, affordsMove, heldBySlug, cookables],
  );
  const craftQuantityMax = useMemo(() => {
    if (mode !== "craft" || !chosen) return 99;
    let max = 99;
    for (const item of chosen.requirementItems ?? []) {
      if (item.keep || item.kind === "group") continue;
      const slug = item.kind === "anyOf" ? ingredientChoiceValue : item.slug;
      if (!slug) continue;
      max = Math.min(max, Math.floor((heldBySlug.get(slug) ?? 0) / (item.count ?? 1)));
    }
    // A slotted ingredient is spent once per unit of the batch, so a stack of
    // two caps the order at two. Duplicate slots are refused server-side, so
    // each slug counts once.
    for (const slug of ingredientChoices) {
      max = Math.min(max, heldBySlug.get(slug) ?? 0);
    }
    const per = craftAllowances[chosen.id]?.per ?? null;
    const left = craftAllowances[chosen.id]?.left ?? 0;
    // moveFamilyOf, not craftFamily: a never-spills recipe's stepper stops
    // dead at what's left of its ration rather than counting on the Move
    // to buy more.
    const family = moveFamilyOf(chosen);
    const turns = chosen.requirementTurns ?? 1;
    const perTurn = chosen.requirementPerTurn ?? null;
    if (turns === 0 && per != null) {
      // Free units first, then whatever the Move can still buy at 1/per each.
      max = Math.min(
        max,
        family ? left + unitsAffordable(craftRemaining, per) : left,
      );
    } else if (turns === 1) {
      // The server's batch rule: `perTurn` or ONE per turn of work. A family
      // recipe stops where the Move does; the odd no-family one (holy water)
      // stops at the count itself.
      const batch = perTurn > 0 ? perTurn : 1;
      max = Math.min(
        max,
        family ? unitsAffordable(craftRemaining, batch) : batch,
      );
    } else {
      // A project's turns are per piece — it makes one at a time.
      max = 1;
    }
    return Math.max(1, max);
  }, [
    mode,
    chosen,
    heldBySlug,
    ingredientChoiceValue,
    ingredientChoices,
    craftAllowances,
    craftRemaining,
  ]);

  function pick(nextTagId) {
    setTagId(nextTagId);
    setQuantity("1");
    setIngredientChoice("");
    setIngredientChoices([]);
    setCustomName("");
    setCustomDescription("");
    setInscription("");
    setObolsSpent("0");
  }

  // Any Craft that spends ⬢ or a Move asks twice. Confirm is awaited OUTSIDE
  // the transition, or the dialog never renders.
  async function onSubmit() {
    if (!projectId && !siteId && chosen) {
      const turns = chosen.requirementTurns ?? 1;
      const qty = craftQty;
      // The same price craftRequestImpl charges, so the confirm can never
      // quote less than the bill (web/lib/customCraft.js). Hoisted above so
      // the Obols input and this confirm always agree on the total.
      const cost = craftResourceCost;
      const resourcesCost = craftRemainingResourceCost;
      const what = qty > 1 ? `${qty}× ${chosen.name}` : chosen.name;
      // What this costs of the Move, in the player's words. Three shapes: it
      // opens the turn's Routine, it spends from a Routine already started,
      // or — the new one — it spills past a free allowance into the Move.
      // Declining crafts nothing.
      const move = craftCost;
      const share =
        move && move.num < move.den
          ? `${formatMoveFraction(move.num, move.den)} of your Move`
          : "your whole Move for the turn";
      let moveLine = null;
      if (move && move.kind !== "free" && move.kind !== "capped") {
        if (move.kind === "whole" && !craftBudget) {
          moveLine = "This is your Move for the turn.";
        } else {
          const takes =
            move.freeQty > 0
              ? `The first ${move.freeQty} ${move.freeQty === 1 ? "is" : "are"} free; the rest take ${share}`
              : `That takes ${share}`;
          // A spill is the one Move spend a player may not have planned as
          // their day's work, so it alone says what a filed Action always
          // costs: the day's labor pay (CRAFTING.md §2a).
          const labor =
            move.freeQty > 0 && !craftBudget
              ? " That counts as your day's work — no labor pay today."
              : "";
          moveLine = craftBudget
            ? `${takes}, on top of what you've already done this turn.`
            : `${takes}. That starts your Move — you can keep working until it's spent.${labor}`;
        }
      }
      if (moveLine || cost > 0) {
        const ok = await confirm({
          title: turns > 1 ? "Start the work?" : "Make it?",
          message: [
            turns > 1
              ? `${what} takes ${turns} turns of work.`
              : `Make ${what}?`,
            cost > 0
              ? obolsSpentNum > 0
                ? resourcesCost > 0
                  ? `${cost} ⬢: ${obolsSpentNum} from your own Obols, ${resourcesCost} paid now by ${payerLabel(healParties, payerKey)}, and not refunded if you stop.`
                  : `${cost} ⬢, all ${obolsSpentNum} from your own Obols, and not refunded if you stop.`
                : `${cost} ⬢ ${cost === 1 ? "is" : "are"} paid now by ${payerLabel(healParties, payerKey)}, and not refunded if you stop.`
              : null,
            moveLine,
            // The one-line Move note is signed-off copy; the budget wording is not.
            moveLine && moveLine !== "This is your Move for the turn." ? "" : "",
          ]
            .filter(Boolean)
            .join(" "),
          confirmLabel: turns > 1 ? "Start" : "Make it",
        });
        if (!ok) return;
      }
    }
    if (projectId && projectChoice === "cancel") {
      const name =
        craftProjects.find((p) => p.id === projectId)?.tagName ?? "the work";
      const ok = await confirm({
        title: "Give it up?",
        message: `${name} stays unfinished and whatever you paid for it is gone.`,
        confirmLabel: "Give it up",
      });
      if (!ok) return;
    }
    if (siteId && projectChoice === "cancel") {
      const name =
        buildSites.find((s) => s.id === siteId)?.typeName ?? "the work";
      const ok = await confirm({
        title: "Give it up?",
        message: `The ${name} is left where it stands, and the ⬢ that went into it are gone. Anyone else working on it loses that work too.`,
        confirmLabel: "Give it up",
      });
      if (!ok) return;
    }

    const giving = projectChoice === "cancel" && (projectId || siteId);
    const working = !giving && (projectId || siteId);
    run(
      () => runAction(),
      (res) =>
        onDone(
          giving
            ? "The work is given up."
            : working
              ? "Another turn goes into it."
              : res.made
                ? `${res.made} made.`
                : `${chosen?.name ?? "The work"} is begun.`,
        ),
    );
  }

  function runAction() {
    // A build site takes the same two verbs as a project, against the
    // structure instead of the CraftProject.
    if (siteId) {
      return projectChoice === "cancel"
        ? cancelBuildSite({ structureId: siteId })
        : joinBuildSite({ structureId: siteId });
    }
    if (projectId) {
      return projectChoice === "cancel"
        ? cancelCraft({ projectId })
        : continueCraft({ projectId });
    }
    // Always sent; the server pins it to 1 for a non-stackable tag anyway.
    return craftRequest({
      tagId,
      quantity,
      payerKey,
      customName,
      customDescription,
      inscription,
      ingredientChoice: ingredientChoiceValue,
      ingredientChoices,
      // What the confirm just showed as billable against the Move — 0
      // when it read as free. The server refuses to bill past this, so a
      // stale tab gets a retry instead of a silent Move charge.
      billedSeen: String(craftCost?.billedQty ?? 0),
      // Smithing only; resolveObolSpend ignores this on any other recipe.
      obolsSpent: String(obolsSpentNum),
    });
  }

  const canSubmit = (() => {
    if (siteId) {
      const site = buildSites.find((s) => s.id === siteId);
      if (!site) return false;
      // Cancelling is the opener's alone and costs no Move; joining is a
      // Move like any other turn of work.
      return projectChoice === "cancel" ? Boolean(site.mine) : !hasMoved;
    }
    if (projectId) {
      const project = craftProjects.find((p) => p.id === projectId);
      if (!project) return false;
      return (
        projectChoice === "cancel" || (!hasMoved && !project.workedThisTurn)
      );
    }
    if (!chosen) return false;
    // A recipe with a pick and nothing to pick from cannot be made at all.
    if (ingredientPick && !ingredientChoiceValue) return false;
    // A Lavish Meal needs something in it. A Fine Meal's slot is optional, so
    // min 0 never blocks (docs/systemdocs/COOKING.md).
    if (ingredientChoices.length < (ingredientSlots?.min ?? 0)) return false;
    // A 0-turn craft inside its free allowance never needed a Move and
    // still doesn't; everything else has to fit in what the turn has left
    // (CRAFTING.md §2a). craftRequest refuses the same cases regardless. A
    // payer is only needed for whatever Obols don't already cover.
    return Boolean(craftRemainingResourceCost === 0 || payerKey) && craftMoveOk;
  })();

  const title = "Craft";
  return (
    <ActionDialog
      title={title}
      submitLabel={projectId || siteId ? (projectChoice === "cancel" ? "Give it up" : "Keep working") : title}
      width="wide"
      busy={busy}
      error={error}
      canSubmit={canSubmit}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <CraftDialog
        hasWorkshop={hasWorkshop}
        projects={craftProjects}
        projectId={projectId}
        sites={buildSites}
        siteId={siteId}
        // One dropdown, two id spaces — the prefix says which.
        onPick={(key) => {
          const [kind, id] = key.split(":");
          setProjectId(kind === "project" ? id : "");
          setSiteId(kind === "site" ? id : "");
          setProjectChoice("continue");
        }}
        projectChoice={projectChoice}
        onProjectChoice={setProjectChoice}
        picker={
          <TagPicker
            tags={craftable}
            selectedId={tagId}
            onSelect={pick}
            byId={gateById}
            heldIds={heldIds}
            blockedReason={recipeBlocked}
            emptyLabel="Nothing you could make right now."
          />
        }
        chosen={chosen}
        stacking={stacking}
        quantity={quantity}
        onQuantity={setQuantity}
        quantityMax={craftQuantityMax}
        budget={craftBudget}
        moveCost={craftCost}
        allowance={craftAllowance}
        moveOk={craftMoveOk}
        ingredientPick={ingredientPick}
        ingredientChoice={ingredientChoiceValue}
        onIngredientChoice={(slug) => {
          // The quantity cap is per-ingredient (you may hold 5 tea
          // and 1 honey), so switching resets the count rather than
          // stranding a 5 over a max of 1.
          setIngredientChoice(slug);
          setQuantity("1");
        }}
        ingredientSlots={ingredientSlots}
        cookables={cookables}
        ingredientChoices={ingredientChoices}
        onIngredientChoices={(slugs) => {
          // Same reasoning as the pick above: the count is capped by the
          // scarcest thing in the pot, so slotting resets it rather than
          // stranding a 5 over a stack of 1.
          setIngredientChoices(slugs);
          setQuantity("1");
        }}
        customName={customName}
        onCustomName={setCustomName}
        customDescription={customDescription}
        onCustomDescription={setCustomDescription}
        inscription={inscription}
        onInscription={setInscription}
        payerKey={payerKey}
        onPayer={setPayerKey}
        parties={healParties}
        selfId={selfId}
        hasMoved={hasMoved}
        obolsSpent={obolsSpent}
        onObolsSpent={setObolsSpent}
        heldObols={heldObols}
      />
    </ActionDialog>
  );
}
