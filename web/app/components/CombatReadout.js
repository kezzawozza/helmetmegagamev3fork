"use client";

import { Fragment } from "react";
import { armorPieces, armorWord, combineArmor } from "@/lib/armorValue";
import { fightingSkill, TREES } from "@/lib/fightingSkill";
import DetailTile from "./DetailTile";

// THE Combat readout. One component, four surfaces: the player's own sheet
// (LedgerBand.js), the GM inspector's Sheet tab, and the Move desk — which
// means /gm/turns, /gm/players and /gm/oracle all draw the same thing, because
// all three mount the same inspector.
//
// It was three lines of dead text on the desk before this: a GM read
// "Melee: Seasoned | Ranged: Weak" and had to open the Tags list to find out
// why, which is the arithmetic db/lib/fightingSkill.js exists to have already
// done. See docs/systemdocs/COMBAT.md §6.
//
// The two halves of the tree stay apart everywhere (COMBAT.md §2): the catalog
// never merges them, so neither does the readout.

// Which field of a Tag each half of the tree reads for armour. The Ranged row
// pairs ranged SKILL with BALLISTIC armour, which is not quite the same axis —
// Bascinet's call, made knowingly (COMBAT.md §6).
const ARMOR_FIELD = { melee: "meleeArmor", ranged: "ballisticArmor" };

function treeLabel(tree) {
  return tree === "melee" ? "Melee" : "Ranged";
}

// A tier shift as the catalog writes it: "+2", "−0.5". U+2212 minus, matching
// db/lib/gambitModifier.js#formatGambitModifiers and the bot's roll line.
function tierLabel(tiers) {
  return `${tiers > 0 ? "+" : "−"}${Math.abs(tiers)}`;
}

// "Melee (Expert)" under a run already headed MELEE is the word twice; drop the prefix here.
function shortName(label, tree) {
  const prefix = tree === "melee" ? "Melee (" : "Ranged (";
  return label.startsWith(prefix) && label.endsWith(")") ? label.slice(prefix.length, -1) : label;
}

// What the Combat tile opens: every contributor behind the two bands and what
// a GM has to decide, in the shared detail slot (SHEET.md §2). The SCORE is
// never printed, only the names and their shifts — working out that Seasoned
// beats Capable is the player's job, the same posture armour takes.
//
// `pieces` names the worn armour behind each row's word, and is GM-ONLY on
// purpose. Armour never enters the fighting arithmetic (COMBAT.md §2), so on
// the player's sheet it would read as though it did; a GM arbitrating a hit is
// asking the other question — what is actually turning the blow aside — and
// deserves the answer. Absent, nothing is drawn.
export function CombatDetail({ combat, pieces = null }) {
  return (
    <>
      {TREES.map((tree) => (
        <span key={tree} className="combat-line">
          <span className="field-label">{treeLabel(tree)}</span>{" "}
          {combat[tree].contributors
            .map((c) => {
              const name = shortName(c.label, tree);
              if (c.base) return name;
              return `${name} ${c.cancelledBy ? `nil, ${c.cancelledBy}` : tierLabel(c.tiers)}`;
            })
            .join(" · ")}
          {combat[tree].cap && ` · held at ${combat[tree].cap}`}
          {combat[tree].floor && ` · ${combat[tree].floor}`}
        </span>
      ))}
      {pieces &&
        TREES.map((tree) => (
          <span key={`armor-${tree}`} className="combat-line">
            <span className="field-label" aria-hidden="true">
              ⛊
            </span>{" "}
            <span className="field-label">{treeLabel(tree)}</span>{" "}
            {pieces[tree].length
              ? pieces[tree].map((p) => `${p.label} ${p.word}`).join(" · ")
              : "nothing worn"}
          </span>
        ))}
    </>
  );
}

// Combat's resting face: a row per dimension, each carrying its own band and
// armour, each line labelled at its head.
export function CombatFace({ combat, armor }) {
  // Names only, once each: a tag on both halves of the tree would otherwise print twice.
  const names = [...new Set(TREES.flatMap((t) => combat[t].situational.map((s) => s.label)))];
  return (
    <>
      {/* A grid, not two flex rows, so the bands and armour actually share an edge. */}
      <span className="combat-rows">
        {TREES.map((tree) => (
          <Fragment key={tree}>
            <span className="field-label">{treeLabel(tree)}</span>
            <span className="combat-band" data-band={combat[tree].band.key}>
              {combat[tree].band.label}
            </span>
            <span className="combat-armor">
              <span aria-hidden="true">⛊</span> {armor[tree]}
            </span>
          </Fragment>
        ))}
      </span>
      {/* A footnote, not controls — just says there is something here to ask a gamemaster about. */}
      {names.length > 0 && <span className="combat-situational">{names.join(" · ")}</span>}
    </>
  );
}

// The whole tile, deriving its own numbers. Callers hand it held tag rows and
// nothing else, so no surface can arrive at a second opinion about somebody's
// band — which is exactly how the desk's old one-line version drifted.
//
// Derived every render, never stored, so it cannot go stale (COMBAT.md §7).
//
// `tags` MUST carry each row's `equipped` flag. Both fightingSkill and
// combineArmor read a MISSING flag as equipped (deliberate latitude for a bare
// Tag[]), so a caller that drops the column counts every sword in a sack and
// every breastplate in a cart.
export default function CombatTile({ tags = [], open = false, onOpen = null, showArmorPieces = false }) {
  const combat = fightingSkill(tags);
  // Kept apart rather than pre-joined: a joined string could only be split again.
  const armor = {
    melee: armorWord(combineArmor(tags, ARMOR_FIELD.melee)),
    ranged: armorWord(combineArmor(tags, ARMOR_FIELD.ranged)),
  };
  const pieces = showArmorPieces
    ? { melee: armorPieces(tags, ARMOR_FIELD.melee), ranged: armorPieces(tags, ARMOR_FIELD.ranged) }
    : null;
  return (
    <DetailTile
      label="Combat"
      value={<CombatFace combat={combat} armor={armor} />}
      detail={<CombatDetail combat={combat} pieces={pieces} />}
      open={open}
      onOpen={onOpen}
    />
  );
}
