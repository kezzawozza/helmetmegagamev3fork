"use client";

import { useState } from "react";
import { handsFor, handsUsed } from "@lifeweb/db/lib/equipSlots";
import { bandOf } from "@lifeweb/db/lib/mood";
import { formatGambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import CombatTile from "@/app/components/CombatReadout";
import DetailTile from "@/app/components/DetailTile";
import FactionLink from "@/app/components/FactionLink";
import StatusPill, { CHARACTER_STATUS } from "@/app/components/StatusPill";
import TagPointsValue from "@/app/components/TagPointsValue";

// The band across the top of the Dev Character Panel: who this is, and the
// derived numbers a GM wants before touching anything.
//
// It used to be a 15-fact grid of bare label/value pairs, and it read like a
// rulebook: every tile carried a sentence explaining the rule behind it. A GM
// running this panel already knows the rules — so the tiles are read-only
// boxes with nothing to hover, except This turn, which names a fact about
// THIS character rather than a rule.
export default function DevBand({
  character,
  staged,
  discord,
  held,
  maxDrawbackTags,
  maxDrawbackPoints,
  gambitModifier,
  gambitParts,
  openTurn,
  hasActed,
  stagedForPush,
}) {
  // One open slot for the whole band, so two boxes never show detail at once.
  const [tileOpen, setTileOpen] = useState(null);
  const tile = (key) => ({
    open: tileOpen === key,
    onOpen: (want) => setTileOpen(want ? key : null),
  });

  // Slots spent, not rows worn — a stack equipped 3-of-5 spends 3.
  const equipped = held.reduce((sum, h) => sum + (h.equippedQuantity ?? 0), 0);
  // Hands, not a flat count: the only equipment limit that is a number now
  // (db/lib/equipSlots.js). The layered slots refuse on their own. handsUsed
  // expands each row by its own equippedQuantity, matching `equipped` above.
  const hands = handsUsed(held.filter((h) => h.equippedQuantity > 0));
  // The cap this character actually has — a maiming takes hands away.
  const handCap = handsFor(held);
  // Point-bought drawbacks only, matching the ceilings PointBuy enforces — a
  // GM-inflicted wound is not one of the player's tags. Shown as a fact, not
  // a limit: a GM grant deliberately ignores every gate, these included.
  const drawbacks = held.reduce(
    (acc, h) => {
      if (h.source !== "POINT_BUY" || (h.pointCost ?? 0) >= 0) return acc;
      return { count: acc.count + 1, points: acc.points - h.pointCost };
    },
    { count: 0, points: 0 },
  );
  const overDrawbackCap = drawbacks.count > maxDrawbackTags || drawbacks.points > maxDrawbackPoints;
  const moodBand = bandOf(staged.mood ?? 0);
  const status = CHARACTER_STATUS[character.status];

  return (
    <section className="panel sheet-band">
      {/* Not .ledger-band: the player's sheet sits its five tiles BESIDE the
          portrait and caps them at 47rem, which is right for five and leaves a
          hole at seven. Here the identity is its own line and the tiles get the
          full width under it. */}
      <div className="dev-band-identity">
        {/* Wrapped rather than dropped straight into the flex row:
            AvatarZoom's button is `all: unset`, so without a shrink-proof
            box of its own the face squashes when the name beside it runs
            long. */}
        <div className="shrink-0">
          <CharacterAvatar
            characterId={character.id}
            name={character.name}
            version={character.updatedAt}
            size={96}
            zoomable
          />
        </div>
        <div className="ledger-who">
          {/* The staged name, not the stored one — the rest of the panel
              already renders what Apply would write, and the heading
              disagreeing with the field being typed into read as a bug. */}
          <h2 className="ledger-name">{staged.name || character.name}</h2>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <StatusPill tone={status?.tone ?? "neutral"}>{status?.label ?? character.status}</StatusPill>
            <span>
              {staged.roleTitle || "No role"} ·{" "}
              <FactionLink
                factionId={character.factionId}
                name={character.factionName ?? "No faction"}
                className="ledger-faction"
              />
            </span>
          </p>
          <p className="m-0 text-sm text-muted">
            {character.zoneName ?? "No zone"} · {character.locationName ?? "Nowhere"}
          </p>
          <p className="m-0 text-sm text-muted">
            {discord.username ?? "not in the guild"}
            {discord.nickname ? ` · "${discord.nickname}"` : ""}
            {character.discordRoleId ? "" : " · no name role"}
          </p>
        </div>
      </div>

      <div className="dev-band-tiles">
          <DetailTile label="Resources" value={`${staged.resources} ⬢`} />
          <DetailTile label="Tag points" value={<TagPointsValue points={staged.tagPoints} />} />
          <DetailTile
            label="Mood"
            value={moodBand?.label ?? "Fine"}
            tone={moodBand?.tone ?? "muted"}
            word
          />
          <DetailTile
            label="Gambit die"
            value={gambitModifier ? `${gambitModifier > 0 ? "+" : ""}${gambitModifier}` : "±0"}
            over={Boolean(gambitModifier)}
            detail={gambitParts?.length ? formatGambitModifiers(gambitParts) : null}
            {...tile("gambit")}
          />
          <DetailTile
            label="Equipped"
            value={`${equipped} · ${hands}/${handCap} hands`}
            over={hands > handCap}
          />
          <DetailTile
            label="Drawbacks"
            value={
              <span className={overDrawbackCap ? "text-danger" : undefined}>
                {drawbacks.count}/{maxDrawbackTags} · {drawbacks.points}/{maxDrawbackPoints} pts
              </span>
            }
          />
          <DetailTile
            label="This turn"
            value={openTurn ? `${openTurn.number} ${openTurn.phase}` : "none open"}
            word
            tone={openTurn ? null : "muted"}
            detail={
              openTurn
                ? hasActed
                  ? `${character.name} has filed a Move`
                  : `${character.name} hasn't acted this turn`
                : "No turn is open"
            }
            {...tile("turn")}
          />
      </div>

      {/* Combat lives on its own row, not in the tile grid above — the same
          reason LedgerBand.js gives: the tile row's columns fit a short
          value each, and Combat's two-tree readout needs a third of the
          band's width to lay out without wrapping into its neighbour. */}
      <div className="sheet-band-row">
        <CombatTile tags={held} showArmorPieces {...tile("combat")} />
      </div>

      {/* Concealed has no column on the form and no verb — it's a resolved
          fact, not a switch. The column itself is only a wish: it takes
          effect solely while something concealing is equipped, which is why
          this can read differently from what the player set. */}
      <div className="dev-switches">
        <div className="dev-switch">
          <span className="field-label">Concealed</span>
          <span className="text-sm">
            {character.concealedInEffect ? "Yes" : character.concealed ? "On, but nothing worn" : "No"}
          </span>
        </div>
      </div>

      {stagedForPush && (
        /* The adjudication workspace has queued changes against this sheet
           for the turn-end push. Live edits here are additive with those —
           nothing corrupts — but a GM who can't see the queue double-grants. */
        <p className="m-0 text-xs text-accent">
          Staged for the push:{" "}
          {[
            stagedForPush.resources
              ? `${stagedForPush.resources > 0 ? "+" : ""}${stagedForPush.resources} ⬢`
              : null,
            stagedForPush.tagOps
              ? `${stagedForPush.tagOps} tag change${stagedForPush.tagOps === 1 ? "" : "s"}`
              : null,
            (stagedForPush.tagPoints ?? 0)
              ? `${stagedForPush.tagPoints > 0 ? "+" : ""}${stagedForPush.tagPoints} tag points`
              : null,
          ]
            .filter(Boolean)
            .join(", ")}{" "}
          — queued in /gm/turns, lands at turn end.
        </p>
      )}
    </section>
  );
}
