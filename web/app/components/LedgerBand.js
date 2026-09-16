"use client";

import { Fragment, useState } from "react";
import { armorWord, combineArmor } from "@/lib/armorValue";
import { fightingSkill, TREES } from "@/lib/fightingSkill";
import { formatGambitModifiers, gambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import { bandOf } from "@lifeweb/db/lib/mood";
import StatusStrip from "@/app/(app)/chat/StatusStrip";
import ActionGrid from "./ActionGrid";
import AvatarZoom from "./AvatarZoom";
import FactionLink from "./FactionLink";
import LedgerTile from "./LedgerTile";
import SheetTurn from "./SheetTurn";
import SoundTrumpetButton from "./SoundTrumpetButton";
import TagDetails from "./TagDetails";
import TurnForecast from "./TurnForecast";

// What the Mood box says when you open it. Bascinet's words, verbatim.
const MOOD_DETAIL =
  "Certain things, like spending time in the wilderness without the Rough Camper trait or receiving wounds harm " +
  "your mood. Other things, like listening to music, fulfilling desires, or eating meals boost your mood. Your " +
  "Mood impacts your Gambit rolls.";

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
function CombatDetail({ combat }) {
  return (
    <>
      {TREES.map((tree) => (
        <span key={tree} className="combat-line">
          <span className="field-label">{tree === "melee" ? "Melee" : "Ranged"}</span>{" "}
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
    </>
  );
}

// Combat's resting face: a row per dimension, each carrying its own band and
// armour, each line labelled at its head. One honest approximation: the
// Ranged row pairs ranged SKILL with BALLISTIC armour, not quite the same
// axis (db/lib/depotTurret.js) — Bascinet's call, made knowingly.
function CombatFace({ combat, armor }) {
  // Names only, once each: a tag on both halves of the tree would otherwise print twice.
  const names = [...new Set(TREES.flatMap((t) => combat[t].situational.map((s) => s.label)))];
  return (
    <>
      {/* A grid, not two flex rows, so the bands and armour actually share an edge. */}
      <span className="combat-rows">
        {TREES.map((tree) => (
          <Fragment key={tree}>
            <span className="field-label">{tree === "melee" ? "Melee" : "Ranged"}</span>
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

// The band across the top of the sheet — who this is and where they stand,
// the five things a player checks first, the turn card and status strip, and
// under them what the turn will change and every verb in one strip.
// The numbers are read-only on purpose. The strip is where things happen.
export default function LedgerBand({
  character,
  avatarSrc,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  openTurn = null,
  moveState = null,
  pendingOffers = [],
  craftProjects = [],
  sitesHere = [],
  hasTrumpet = false,
  isSelf = true,
}) {

  const moodBand = bandOf(character.mood ?? 0);
  // Derived every render, never stored, so it can't go stale. Drawn only on
  // your OWN sheet: a fighting band is one number nobody should read off
  // somebody they might have to fight (every fighting tag is `visible: false`).
  const combat = isSelf ? fightingSkill(character.tags) : null;
  // Kept apart rather than pre-joined: a joined string could only be split again.
  const armorWords = {
    melee: armorWord(combineArmor(character.tags, "meleeArmor")),
    ranged: armorWord(combineArmor(character.tags, "ballisticArmor")),
  };
  const carrying = carry ? `${carry.weightUsed} / ${carry.weightCap}` : null;
  // Both already computed by db/lib, so neither tile derives a second opinion about its own number.
  const carryDetail = carry?.breakdown?.length
    ? carry.breakdown
        .map((b) => `${b.name} ${b.bonus > 0 ? "+" : "−"}${Math.abs(Math.round(b.bonus * 100))}%`)
        .join(" · ")
    : "Nothing you hold changes what you can carry.";
  const gambitParts = gambitModifiers(character.tags, {
    hungerStreak: character.hungerStreak,
    mood: character.mood,
  });
  // Summed from the parts: two calls to the same module is two chances for the number and its explanation to disagree.
  const gambit = gambitParts.reduce((sum, m) => sum + m.value, 0);
  const gambitDetail = gambitParts.length
    ? formatGambitModifiers(gambitParts)
    : "Nothing is weighing on your roll.";
  const loadPct = carry
    ? Math.min(100, Math.round((carry.weightUsed / Math.max(carry.weightCap, 1)) * 100))
    : 0;
  // The status chip a player clicked open, read inline under the strip — reachable by a tap, not just hover.
  const [picked, setPicked] = useState(null);
  // Which tile's detail is open — one slot, one paragraph under the row for all of them to write into.
  const [tileOpen, setTileOpen] = useState(null);
  const pickedRow = picked ? character.tags.find((ct) => (ct.tag.id ?? ct.tagId) === picked) ?? null : null;

  return (
    <section className="sheet-band panel">
      <div className="ledger-band">
        <div className="ledger-identity">
          <div className="ledger-face">
            {avatarSrc ? (
              // `avatarSrc` is already whatever presentedIdentity resolved for the person looking; the zoom never rebuilds a URL.
              <AvatarZoom src={avatarSrc} name={character.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarSrc} alt={character.name} />
              </AvatarZoom>
            ) : (
              <div className="ledger-face-blank" aria-hidden="true" />
            )}
          </div>
          {/* The only place on the page that names the person. */}
          <div className="ledger-who">
            <h2 className="ledger-name">{character.name}</h2>
            <p className="m-0 text-sm text-muted">
              {character.roleTitle ?? "No role"} ·{" "}
              <FactionLink
                factionId={character.faction?.id ?? null}
                name={character.faction?.name ?? "No faction"}
                className="ledger-faction"
              />
            </p>
            <p className="m-0 text-sm text-muted">
              {character.zone?.name ?? "Unassigned"} · {character.location?.name ?? "Nowhere"}
            </p>
            <div className="mt-2">
              {/* No ⬢ and no pounds here: the tiles to the right already carry both. What's left is what is actually worn. */}
              <StatusStrip
                numbers={false}
                carry={carry}
                tags={character.tags}
                onPick={(ct) => setPicked((was) => (was === (ct.tag.id ?? ct.tagId) ? null : ct.tag.id ?? ct.tagId))}
                pickedId={picked}
              />
              {pickedRow && (
                <div className="sheet-picked">
                  <TagDetails
                    tag={pickedRow.tag}
                    quantity={pickedRow.quantity}
                    expiresTurn={pickedRow.expiresTurn}
                    currentTurn={openTurn?.number ?? null}
                    inTooltip={false}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Five tiles, one row — Combat lives on the row below instead of squeezing a sixth, double-width tile in. */}
        <div className="ledger-tiles">
          {/* One open slot across the band, so two boxes never show detail at once. */}
          <LedgerTile
            label="Free moves"
            value={zoneMoves != null ? zoneMoves : "—"}
            over={zoneMoves === 0}
            detail={zoneMovesReason || null}
            open={tileOpen === "moves"}
            onOpen={(want) => setTileOpen(want ? "moves" : null)}
          />
          <LedgerTile
            label="Resources"
            value={carry ? `${carry.resources} / ${carry.resourcesCap} ⬢` : `${character.resources} ⬢`}
            over={Boolean(carry && carry.resources > carry.resourcesCap)}
          />
          <LedgerTile
            label="Carrying"
            value={carrying ? `${carrying} lb` : "—"}
            over={Boolean(carry && carry.weightUsed > carry.weightCap)}
            detail={carryDetail}
            open={tileOpen === "carrying"}
            onOpen={(want) => setTileOpen(want ? "carrying" : null)}
          >
            {carry && (
              <span
                className="depot-meter"
                role="img"
                aria-label={`${carry.weightUsed} of ${carry.weightCap} pounds carried`}
              >
                <span className="depot-meter-fill" style={{ width: `${loadPct}%` }} />
              </span>
            )}
          </LedgerTile>
          {/* The mood dial as ONE WORD (docs/systemdocs/MOOD.md), never the number; the tone picks the token. */}
          <LedgerTile
            label="Mood"
            value={moodBand?.label ?? "Fine"}
            tone={moodBand?.tone ?? "muted"}
            word
            detail={MOOD_DETAIL}
            open={tileOpen === "mood"}
            onOpen={(want) => setTileOpen(want ? "mood" : null)}
          />
          {/* The modifier the bot actually rolls the Gambit die against — same module, same arguments — and says WHICH modifiers. */}
          <LedgerTile
            label="Gambit die"
            value={gambit ? `${gambit > 0 ? "+" : ""}${gambit}` : "±0"}
            over={Boolean(gambit)}
            detail={gambitDetail}
            open={tileOpen === "gambit"}
            onOpen={(want) => setTileOpen(want ? "gambit" : null)}
          />
        </div>
      </div>

      {/* This turn · Combat · Turn Effects, same build (.ledger-turn/.ledger-tile share background/border/radius/padding). Grid is auto-fit. */}
      <div className="sheet-band-row">
        {isSelf && (
          <div className="ledger-turn">
            <span className="field-label">This turn</span>
            <SheetTurn moveState={moveState} pendingOffers={pendingOffers} />
          </div>
        )}
        {combat && (
          <LedgerTile
            label="Combat"
            value={<CombatFace combat={combat} armor={armorWords} />}
            detail={<CombatDetail combat={combat} />}
            open={tileOpen === "combat"}
            onOpen={(want) => setTileOpen(want ? "combat" : null)}
          />
        )}
        <TurnForecast
          tags={character.tags}
          openTurnNumber={openTurn?.number ?? null}
          craftProjects={craftProjects}
          sitesHere={sitesHere}
          resources={character.resources}
        />
      </div>

      {isSelf && <ActionGrid variant="strip">{hasTrumpet && <SoundTrumpetButton />}</ActionGrid>}
    </section>
  );
}
