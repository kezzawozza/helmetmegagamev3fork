"use client";

import { useState } from "react";
// Zero-require and so safe from a client component, the same way
// web/lib/tagRequests.js imports ./tradeable — importing the @lifeweb/db
// barrel here would drag PrismaClient into the browser bundle.
import { resourcesOf } from "@lifeweb/db/lib/resourceStack";
import { formatGambitModifiers, gambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import { bandOf } from "@lifeweb/db/lib/mood";
import StatusStrip from "@/app/(app)/chat/StatusStrip";
import ActionGrid from "./ActionGrid";
import AvatarZoom from "./AvatarZoom";
import CombatTile from "./CombatReadout";
import DetailTile from "./DetailTile";
import FactionLink from "./FactionLink";
import { MOOD_DETAIL } from "./MoodPanel";
import SheetTurn from "./SheetTurn";
import SoundTrumpetButton from "./SoundTrumpetButton";
import TagDetails from "./TagDetails";
import TurnForecast from "./TurnForecast";

// The coin's slug, spelled here the way character/actions/crafting.js spells it
// — there is no constant for it in db/lib, and a client component may not reach
// the @lifeweb/db barrel to look for one.
const OBOL_SLUG = "obol";

// A signed figure with a real U+2212 minus, matching
// db/lib/gambitModifier.js#formatGambitModifiers and the bot's roll line.
function signed(n) {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`;
}

// The band across the top of the sheet — the face, the name in blackletter,
// where they stand, the status chips, the five things a player checks first,
// then This turn / Combat / Turn effects, then every verb in one strip.
// The numbers are read-only on purpose. The strip is where things happen.
//
// Each of the five tiles carries a quiet second line as of phase 4 (the `sub`
// prop): the coin beside the ⬢, the mood's own figure, which modifier is on the
// Gambit. That is the mockup's shape, and it means the numbers say what they
// mean without having to be pressed.
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
  hungerWarning = null,
}) {

  const moodBand = bandOf(character.mood ?? 0);
  // The Combat tile below is drawn only on your OWN sheet: a fighting band is
  // one number nobody should read off somebody they might have to fight (every
  // fighting tag is `visible: false`). CombatReadout.js derives it.
  const carrying = carry ? `${carry.weightUsed} / ${carry.weightCap}` : null;
  // Both already computed by db/lib, so neither tile derives a second opinion about its own number.
  const carryDetail = carry?.breakdown?.length
    ? carry.breakdown
        .map((b) => `${b.name} ${b.bonus > 0 ? "+" : "−"}${Math.abs(Math.round(b.bonus * 100))}%`)
        .join(" · ")
    : "Nothing you hold changes what you can carry.";
  // ⬢ are a stack row on the sheet like anything else, so the tile reads them
  // off the tags already loaded rather than taking a number as a prop. There
  // is no cap beside it any more — a ⬢ weighs a pound and pushes against the
  // Carrying tile's cap instead (docs/systemdocs/CARRY.md §1).
  const heldResources = resourcesOf(character);
  // Physical coin, on the ⬢ tile's own sub-line. One obol is one ⬢ (DEPOT.md
  // §0) — parity, not identity — so it is counted and printed in ¢ beside the
  // ⬢ rather than added into them. Off the held rows, like the ⬢ above.
  const obols = (character.tags ?? []).reduce(
    (n, ct) => (((ct?.tag?.slug ?? ct?.slug) === OBOL_SLUG) ? n + (ct.quantity ?? 1) : n),
    0,
  );
  // The mockup's Resources tile also shows a cap. There is none: the old
  // GameConfig.carryResourceCap was retired when a ⬢ started weighing a pound
  // and pushing against the Carrying tile's cap instead (CARRY.md §1). So the
  // sub-line says the coin and nothing else.
  const resourceSub = obols > 0 ? `${obols} ¢ on you` : "no coin on you";

  const gambitParts = gambitModifiers(character.tags, { mood: character.mood });
  // Summed from the parts: two calls to the same module is two chances for the number and its explanation to disagree.
  const gambit = gambitParts.reduce((sum, m) => sum + m.value, 0);
  const gambitDetail = gambitParts.length
    ? formatGambitModifiers(gambitParts)
    : "Nothing is weighing on your roll.";
  const heaviest = gambitParts.reduce(
    (worst, m) => (worst && Math.abs(worst.value) >= Math.abs(m.value) ? worst : m),
    null,
  );
  const gambitTop = heaviest
    ? `${heaviest.label} ${signed(heaviest.value)}${gambitParts.length > 1 ? ` · +${gambitParts.length - 1} more` : ""}`
    : "nothing weighing on it";
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
            {/* "Standing in Town — Tallow Row", the mockup's line: the zone and
                the Location emphasised inside a sentence rather than sitting as
                two bare nouns with a dot between them. */}
            <p className="m-0 text-sm text-muted">
              Standing in <strong>{character.zone?.name ?? "Unassigned"}</strong> —{" "}
              <strong>{character.location?.name ?? "Nowhere"}</strong>
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
          <DetailTile
            label="Free moves"
            value={zoneMoves != null ? zoneMoves : "—"}
            over={zoneMoves === 0}
            // The mockup's "Gambit not yet filed" under this number: the same
            // fact the turn card below states, said where a player counting
            // their moves is already looking.
            sub={isSelf ? (moveState?.move ? "Gambit filed" : "Gambit not yet filed") : null}
            detail={zoneMovesReason || null}
            open={tileOpen === "moves"}
            onOpen={(want) => setTileOpen(want ? "moves" : null)}
          />
          <DetailTile label="Resources" value={`${heldResources} ⬢`} sub={resourceSub} />
          <DetailTile
            label="Carrying"
            value={carrying ? `${carrying} lb` : "—"}
            over={Boolean(carry && carry.weightUsed > carry.weightCap)}
            detail={carryDetail}
            open={tileOpen === "carrying"}
            onOpen={(want) => setTileOpen(want ? "carrying" : null)}
          >
            {carry && (
              <span
                className="sheet-meter"
                data-over={carry.weightUsed > carry.weightCap ? "true" : undefined}
                role="img"
                aria-label={`${carry.weightUsed} of ${carry.weightCap} pounds carried`}
              >
                <span style={{ width: `${loadPct}%` }} />
              </span>
            )}
          </DetailTile>
          {/* The mood dial as ONE WORD (docs/systemdocs/MOOD.md), never the number; the tone picks the token. */}
          <DetailTile
            label="Mood"
            value={moodBand?.label ?? "Fine"}
            tone={moodBand?.tone ?? "muted"}
            word
            // The mockup's "−16 · press for why". The number IS shown here, on
            // the quiet line, where the word above it is what carries the
            // meaning — and "press for why" is a true sentence, because the
            // tile's detail is Bascinet's paragraph on what moves a mood. Only
            // on your own sheet: somebody else's figure is not yours to read.
            sub={isSelf ? `${signed(character.mood ?? 0)} · press for why` : null}
            detail={MOOD_DETAIL}
            open={tileOpen === "mood"}
            onOpen={(want) => setTileOpen(want ? "mood" : null)}
          />
          {/* The modifier the bot actually rolls the Gambit die against — same module, same arguments — and says WHICH modifiers. */}
          <DetailTile
            label="Gambit die"
            value={gambit ? `${gambit > 0 ? "+" : ""}${gambit}` : "±0"}
            over={Boolean(gambit)}
            // The mockup's "Bleeding −1": the heaviest single modifier, named.
            // Which one is the biggest swing, not the first in the list — that
            // is the one a player wants to know about. The whole list is still
            // one press away in the detail below.
            sub={gambitTop}
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
        {isSelf && (
          <CombatTile
            tags={character.tags}
            open={tileOpen === "combat"}
            onOpen={(want) => setTileOpen(want ? "combat" : null)}
          />
        )}
        <TurnForecast
          tags={character.tags}
          openTurnNumber={openTurn?.number ?? null}
          craftProjects={craftProjects}
          sitesHere={sitesHere}
          resources={heldResources}
          // Never on someone else's sheet — a hunger meter is a private fact
          // (db/lib/hunger.js), same reasoning the Combat tile above uses.
          hungerWarning={isSelf ? hungerWarning : null}
        />
      </div>

      {isSelf && <ActionGrid variant="strip">{hasTrumpet && <SoundTrumpetButton />}</ActionGrid>}
    </section>
  );
}
