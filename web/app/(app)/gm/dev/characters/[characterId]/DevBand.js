"use client";

import { useState } from "react";
import { bandOf } from "@lifeweb/db/lib/mood";
import { formatGambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import { moveKindLabel } from "@/lib/moves";
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
// running this panel already knows the rules — so the primary tiles are
// read-only boxes with nothing to hover. Equipped/Drawbacks/the bare "This
// turn" answered questions nobody was asking; they're gone, replaced below by
// facts a GM actually glances at.
export default function DevBand({
  character,
  staged,
  discord,
  curse,
  held,
  feed,
  carry,
  goalsSummary,
  lastActivity,
  gambitModifier,
  gambitParts,
  openTurn,
  openTurnAction,
  stagedForPush,
}) {
  // One open slot for the whole band, so two boxes never show detail at once.
  const [tileOpen, setTileOpen] = useState(null);
  const tile = (key) => ({
    open: tileOpen === key,
    onOpen: (want) => setTileOpen(want ? key : null),
  });

  const moodBand = bandOf(staged.mood ?? 0);
  const status = CHARACTER_STATUS[character.status];

  // Tags due to run out this turn or next — free of anything a GM has to go
  // looking for.
  const expiringSoon = held.filter(
    (h) => h.expiresTurn != null && h.expiresTurn <= (openTurn?.number ?? 0) + 1,
  ).length;
  // healable is the same isHealable predicate the wound picker/heal-all
  // button already agree on (web/lib/devPanelData.js).
  const afflictions = held.filter((h) => h.healable).length;
  const hungry = held.some((h) => h.slug === feed.dropSlug);

  const stagedSummary = stagedForPush
    ? [
        stagedForPush.resources
          ? `${stagedForPush.resources > 0 ? "+" : ""}${stagedForPush.resources} ⬢`
          : null,
        stagedForPush.tagOps
          ? `${stagedForPush.tagOps} tag change${stagedForPush.tagOps === 1 ? "" : "s"}`
          : null,
        (stagedForPush.tagPoints ?? 0)
          ? `${stagedForPush.tagPoints > 0 ? "+" : ""}${stagedForPush.tagPoints} tag points`
          : null,
      ].filter(Boolean)
    : [];

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
            {/* Not read off Character.status — that enum has no CURSED value
                of its own (CHARACTER_STATUS.CURSED is the ghost seat's
                colour, not a live fact). curse.cursed is db/lib/curse.js's
                own answer, so this can be true on an ALIVE character. */}
            {curse?.cursed && <StatusPill tone="bad">Cursed</StatusPill>}
            <span>
              {staged.roleTitle || "No role"} ·{" "}
              <FactionLink
                factionId={character.factionId}
                name={character.factionName ?? "No faction"}
                className="ledger-faction"
              />
              {character.isLeader && <span className="chip">Leader</span>}
              {character.isTreasurer && <span className="chip">Treasurer</span>}
            </span>
          </p>
          <p className="m-0 text-sm text-muted">
            {character.zoneName ?? "No zone"} · {character.locationName ?? "Nowhere"}
          </p>
          <p className="m-0 text-sm text-muted">
            {discord.username ?? "not in the guild"}
            {discord.nickname ? ` · "${discord.nickname}"` : ""}
            {character.discordRoleId ? "" : " · no name role"}
            {character.turnPingOptIn ? " · turn ping" : ""}
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
      </div>

      {/* Combat lives on its own row, not in the tile grid above — the same
          reason LedgerBand.js gives: the tile row's columns fit a short
          value each, and Combat's two-tree readout needs a third of the
          band's width to lay out without wrapping into its neighbour. */}
      <div className="sheet-band-row">
        <CombatTile tags={held} showArmorPieces {...tile("combat")} />
      </div>

      {/* The informational glance: what filled the hole Equipped/Drawbacks/
          the bare "This turn" left. Its own grid, free to wrap over more than
          one line — unlike the primary four above, there's no attempt to
          keep these on a single row. */}
      <div className="dev-band-tiles">
        <DetailTile
          label="Concealed"
          value={character.concealedInEffect ? "Yes" : character.concealed ? "On, but nothing worn" : "No"}
        />
        <DetailTile
          label="This turn"
          value={
            openTurnAction
              ? moveKindLabel(openTurnAction.moveKind, openTurnAction.gmNotes)
              : openTurn
                ? "Not yet"
                : "No turn"
          }
          word
          tone={openTurnAction ? null : "muted"}
          detail={openTurnAction?.description || null}
          {...tile("thisTurn")}
        />
        <DetailTile
          label="Staged for push"
          value={stagedSummary.length ? stagedSummary.join(", ") : "None"}
          tone={stagedSummary.length ? "warn" : "muted"}
          detail={stagedSummary.length ? "Queued in /gm/turns, lands at turn end." : null}
          {...tile("staged")}
        />
        <DetailTile label="Carrying" value={`${carry.weightUsed} lb`} over={carry.weightUsed > carry.weightCap} />
        <DetailTile label="Expiring soon" value={String(expiringSoon)} over={expiringSoon > 0} />
        <DetailTile label="Afflictions" value={String(afflictions)} over={afflictions > 0} />
        <DetailTile label="Hunger" value={hungry ? "Hungry" : "Fed"} tone={hungry ? "warn" : "good"} />
        <DetailTile
          label="Goals"
          value={`${goalsSummary.active}/${goalsSummary.total}`}
          tone={goalsSummary.ready > 0 ? "warn" : null}
          detail={
            goalsSummary.ready > 0
              ? `${goalsSummary.ready} slot${goalsSummary.ready === 1 ? "" : "s"} ready`
              : null
          }
          {...tile("goals")}
        />
        <DetailTile
          label="Last activity"
          value={lastActivity?.label ?? "None"}
          tone={lastActivity ? null : "muted"}
          detail={lastActivity ? new Date(lastActivity.createdAt).toLocaleString() : null}
          {...tile("lastActivity")}
        />
      </div>
    </section>
  );
}
