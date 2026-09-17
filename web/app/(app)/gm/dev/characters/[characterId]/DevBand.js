"use client";

import { useState, useTransition } from "react";
import { handsFor, handsUsed } from "@lifeweb/db/lib/equipSlots";
import { bandOf } from "@lifeweb/db/lib/mood";
import { bandOf as hungerBandOf, HUNGER_MAX } from "@lifeweb/db/lib/hunger";
import { formatGambitModifiers } from "@lifeweb/db/lib/gambitModifier";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import DetailTile from "@/app/components/DetailTile";
import FactionLink from "@/app/components/FactionLink";
import StatusPill, { CHARACTER_STATUS } from "@/app/components/StatusPill";
import TagPointsValue from "@/app/components/TagPointsValue";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useRefresh } from "@/app/components/useRefresh";
import { setCurseOverride, setCharacterMirroring } from "./actions";

// The band across the top of the Dev Character Panel: who this is, the derived
// numbers a GM wants before touching anything, and the three switches that are
// not columns on the form.
//
// It used to be a 15-fact grid of bare label/value pairs, and the complaint
// about it was exactly right: it was tall, and it explained nothing. A GM
// reading "3 / 12 pts" off it had no way to ask what that meant. So it is
// built out of the same DetailTile the player's own sheet uses — a box that
// SWAPS ITS FACE for a sentence on hover, focus or tap, inside the same
// height. Every number here says what it is and where it comes from, and the
// panel got shorter rather than longer.
//
// The numbers are read-only. The Identity tab is where they are edited and the
// action bar is where things happen — except the three switches below the
// tiles, which have no column on the form at all.
export default function DevBand({
  character,
  staged,
  discord,
  curse,
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
  // The 0-100 hunger meter (db/lib/hunger.js). Read straight off `character`,
  // not `staged` — there is no form field for it, the way there is for
  // Resources/Tag points/Mood. Never shown as a number on the player's own
  // sheet, but this panel is superadmin-only debugging, the same posture the
  // Mood tile's detail popover already takes with the raw dial.
  const hungerBand = hungerBandOf(character.hungerValue ?? HUNGER_MAX);
  const HUNGER_TONE = { fed: "muted", hungry: "warn", starving: "bad" };
  const HUNGER_LABEL = { fed: "Fed", hungry: "Hungry", starving: "Starving" };
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
          <DetailTile
            label="Resources"
            value={`${staged.resources} ⬢`}
            detail="What they can spend. Set it on the Identity tab."
            {...tile("resources")}
          />
          <DetailTile
            label="Tag points"
            value={<TagPointsValue points={staged.tagPoints} />}
            detail="Unspent, and the player spends them at /store."
            {...tile("points")}
          />
          <DetailTile
            label="Mood"
            value={moodBand?.label ?? "Fine"}
            tone={moodBand?.tone ?? "muted"}
            word
            detail={`The dial reads ${staged.mood ?? 0}. It moves nightly and shifts their Gambit roll.`}
            {...tile("mood")}
          />
          <DetailTile
            label="Hunger"
            value={HUNGER_LABEL[hungerBand]}
            tone={HUNGER_TONE[hungerBand]}
            word
            detail={`The meter reads ${character.hungerValue ?? HUNGER_MAX}/${HUNGER_MAX}.${
              character.starvingSinceTurn != null
                ? ` Starving since turn ${character.starvingSinceTurn}.`
                : ""
            } Never shown as a number on their own sheet — set it with Feed Them, on the action bar.`}
            {...tile("hunger")}
          />
          <DetailTile
            label="Gambit die"
            value={gambitModifier ? `${gambitModifier > 0 ? "+" : ""}${gambitModifier}` : "±0"}
            over={Boolean(gambitModifier)}
            detail={
              gambitParts?.length
                ? formatGambitModifiers(gambitParts)
                : "Nothing is weighing on their roll."
            }
            {...tile("gambit")}
          />
          <DetailTile
            label="Equipped"
            value={`${equipped} · ${hands}/${handCap} hands`}
            over={hands > handCap}
            detail="Slots spent, then hands used of the hands they have. Change it on the Tags tab."
            {...tile("equipped")}
          />
          <DetailTile
            label="Drawbacks"
            value={
              <span className={overDrawbackCap ? "text-danger" : undefined}>
                {drawbacks.count}/{maxDrawbackTags} · {drawbacks.points}/{maxDrawbackPoints} pts
              </span>
            }
            detail="Point-bought only, against the creation ceilings. A fact, not a limit."
            {...tile("drawbacks")}
          />
          <DetailTile
            label="This turn"
            value={openTurn ? `${openTurn.number} ${openTurn.phase}` : "none open"}
            word
            tone={openTurn ? null : "muted"}
            detail={
              openTurn
                ? hasActed
                  ? "They have filed a Move. The Turn tab has it."
                  : "They have not acted yet. The bar can spend the turn."
                : "No turn is open, so nobody can act."
            }
            {...tile("turn")}
          />
      </div>

      {/* The three answers that are not columns on the form. Each is a live
          control with its state written beside it, rather than a readout a GM
          has to go somewhere else to act on. */}
      <div className="dev-switches">
        <MirrorSwitch characterId={character.id} value={character.discordMirrored} />
        <div className="dev-switch">
          <span className="field-label">Concealed</span>
          {/* The column is only a wish: it takes effect solely while something
              concealing is equipped. A bare "Yes" against a player insisting
              they are visible would teach a GM nothing. */}
          <span className="text-sm">
            {character.concealedInEffect ? "Yes" : character.concealed ? "On, but nothing worn" : "No"}
          </span>
          <span className="dev-switch-note">
            Their own switch on /character. It only bites while something concealing is equipped.
          </span>
        </div>
        <CurseSwitch characterId={character.id} curse={curse} name={character.name} />
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

// The GM remedy for the switch's own 2-hour cooldown (db/lib/discordMirroring.js):
// a player stuck off Discord with no way to flip it back themselves. OFF strips
// channel access immediately, so it asks first; ON is a quiet grant and doesn't.
function MirrorSwitch({ characterId, value }) {
  const [pending, startTransition] = useTransition();
  const [refresh] = useRefresh();
  const [error, setError] = useState(null);
  const confirm = useConfirm();

  const onClick = async () => {
    setError(null);
    if (
      value &&
      !(await confirm({
        title: "Turn off Play on Discord too?",
        message: "This strips their Discord channel access right away.",
        confirmLabel: "Turn off",
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await setCharacterMirroring({ characterId, on: !value });
      if (result?.error) setError(result.error);
      else refresh();
    });
  };

  return (
    <div className="dev-switch">
      <span className="field-label">Play on Discord too</span>
      <span className="flex items-center gap-2 text-sm">
        {value ? "On" : "Off"}
        <button type="button" className="btn-quiet" disabled={pending} onClick={onClick}>
          Turn {value ? "off" : "on"}
        </button>
      </span>
      <span className="dev-switch-note">
        Their own switch on /character, bypassing its 2-hour cooldown.
      </span>
      {error && <span className="text-danger text-xs">{error}</span>}
    </div>
  );
}

// The GM's thumb on the curse (db/lib/curse.js). It used to be a three-option
// <select> reading "Automatic / Cursed / Not cursed" in the middle of a grid of
// read-only facts, which is a fair description of a control nobody found: the
// commonest thing a GM wants — lift a curse off somebody who has earned their
// way out of it — was a dropdown that never said it could do that.
//
// Now the verb is a button and it says what it does. The three states are
// still the three states: null lets the rule decide, true and false overrule it
// and stay overruled, so "Back to automatic" is always offered beside them.
//
// It writes Character.cursedOverride and NOT buriedAt. Stamping that to lift a
// curse would also take the body out of the world — un-lootable, un-draggable,
// gone from every target menu (db/lib/presence.js, db/lib/escort.js).
function CurseSwitch({ characterId, curse, name }) {
  const [pending, startTransition] = useTransition();
  const [refresh] = useRefresh();
  const [error, setError] = useState(null);
  const confirm = useConfirm();

  const set = (override) => {
    setError(null);
    startTransition(async () => {
      const result = await setCurseOverride({ characterId, override });
      if (result?.error) setError(result.error);
      else refresh();
    });
  };

  const lift = async () => {
    if (
      !(await confirm({
        title: `Lift the curse on ${name}?`,
        message:
          "Their next character may take any role, at full points. It stays lifted until a gamemaster puts it back.",
        confirmLabel: "Lift it",
      }))
    ) {
      return;
    }
    set(false);
  };

  return (
    <div className="dev-switch">
      <span className="field-label">Curse</span>
      <span className="flex flex-wrap items-center gap-2 text-sm">
        {curse.cursed ? "Cursed" : "Not cursed"}
        {curse.override !== null && curse.override !== undefined && <em className="text-muted">— forced</em>}
        {curse.cursed ? (
          <button type="button" className="btn-quiet" disabled={pending} onClick={lift}>
            Lift it
          </button>
        ) : (
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => set(true)}>
            Curse them
          </button>
        )}
        {(curse.override === true || curse.override === false) && (
          <button type="button" className="btn-quiet" disabled={pending} onClick={() => set(null)}>
            Back to automatic
          </button>
        )}
      </span>
      <span className="dev-switch-note">
        A cursed player&apos;s next character may only be a Migrant or a Bum, six points short. Left to
        itself the rule says yes while their last body is still lying unburied.
      </span>
      {error && <span className="text-danger text-xs">{error}</span>}
    </div>
  );
}
