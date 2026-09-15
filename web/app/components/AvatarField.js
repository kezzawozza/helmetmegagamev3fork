"use client";

import Switch from "./Switch";
import { useRef, useState, useTransition } from "react";
import PortraitMaker from "./PortraitMaker";
import InfoIcon from "./InfoIcon";
import { useConfirm } from "./ConfirmProvider";
import FormError from "./FormError";
import {
  MAX_AVATAR_PICK_BYTES,
  MAX_AVATAR_UPLOAD_BYTES,
  avatarTooBigMessage,
} from "@/lib/constants";
import { shrinkImage } from "@/lib/shrinkImage";
import { resetAvatarToDefault } from "../(app)/character/actions";

// An InfoIcon sits INSIDE the Switch's <label>, so a click on the "?" — which
// HoverCard uses to pin the panel open — would also flip the switch. The
// preventDefault is what stops the label activating its control; HoverCard's
// own onClick still runs, so the tooltip still pins.
function SwitchInfo({ text }) {
  return (
    <span onClick={(e) => e.preventDefault()}>
      <InfoIcon text={text} />
    </span>
  );
}

export default function AvatarField({
  defaultTurnPingOptIn,
  defaultWebOnly = false,
  // GameConfig.playPanelEnabled. Off, the "Play from the web" switch is drawn
  // only for a player who is already web-only — a character taken out of
  // Discord with no Chat to play in would be out of the game, but one already
  // out must be able to come back. The server action holds the same line.
  playPanelEnabled = true,
  defaultConcealed,
  uploadsEnabled = false,
  portraitMakerEnabled = false,
  portraitFantasyPartsEnabled = false,
  portraitSelection,
  hasCustomAvatar = false,
  // Character.gender, so the portrait maker's Randomize draws from the hair
  // and beard styles that suit it (web/lib/portrait/catalog.js). "NEUTRAL" is
  // the widest pool, so a missing prop rolls exactly as it did before.
  gender = "NEUTRAL",
  // While set, the face and the name are the tag's, not the player's: every
  // picture control gives way to one line, and the conceal switch is off and
  // locked. The server actions re-check it (character/actions.js).
  forcedIdentity = null,
  // The equipped thing covering this face, highest layer first, as
  // { tagName, forced } — or null for a bare face, which is what shuts the
  // conceal switch. Passed down from /character's page through BioForm.
  concealGear = null,
  // Raised while a picked picture is being shrunk in the browser. BioForm owns
  // the flag because BioForm renders Save, and Save must not take a click
  // while the input still holds the original.
  onBusyChange,
}) {
  const [fileName, setFileName] = useState("");
  // Said here rather than left to the action. The action's own refusal is still
  // the gate, but a file over the cap used to reach the framework's body limit
  // first and die with nothing rendered anywhere -- see the bodySizeLimit note
  // in next.config.mjs. Naming it at the moment of picking also saves carrying
  // a 12MB photo up the wire to be told no.
  const [sizeError, setSizeError] = useState("");
  const [makerOpen, setMakerOpen] = useState(false);
  const inputRef = useRef(null);
  // Supersedes an in-flight shrink when a second file is picked: without it a
  // slow first transcode can finish last and write the picture the player did
  // NOT choose back into the input.
  const jobRef = useRef(0);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSizeError("");
      setFileName("");
      return;
    }
    // Refused WITHOUT being decoded. Shrinking means an ordinary photo is fine
    // now, so the only thing left to refuse is something absurd -- and handing
    // a 2GB file to the decoder would lock the tab before any check could
    // speak.
    if (file.size > MAX_AVATAR_PICK_BYTES) {
      e.target.value = "";
      setFileName("");
      setSizeError(avatarTooBigMessage(file.size, MAX_AVATAR_PICK_BYTES));
      return;
    }

    const token = (jobRef.current += 1);
    setSizeError("");
    setFileName(file.name);
    // Before the first await, so there is no frame in which Save is live while
    // the input still holds the original.
    onBusyChange?.(true);
    try {
      const smaller = await shrinkImage(file);
      if (jobRef.current !== token) return;
      // Assigning .files does not fire another change event, so this cannot
      // re-enter onPick.
      if (smaller && typeof DataTransfer === "function" && inputRef.current) {
        const dt = new DataTransfer();
        dt.items.add(smaller);
        inputRef.current.files = dt.files;
      }
      // Whatever is in the input now -- shrunk, or the original because the
      // browser could not read it -- still has to clear the server's cap.
      const posting = inputRef.current?.files?.[0];
      if (posting && posting.size > MAX_AVATAR_UPLOAD_BYTES) {
        inputRef.current.value = "";
        setFileName("");
        setSizeError(avatarTooBigMessage(posting.size, MAX_AVATAR_UPLOAD_BYTES));
      }
    } finally {
      if (jobRef.current === token) onBusyChange?.(false);
    }
  };
  const [resetting, startReset] = useTransition();
  const confirm = useConfirm();

  const reset = async () => {
    const ok = await confirm({
      title: "Reset to default?",
      message: "Your picture goes back to the letter plaque for your first name.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    startReset(() => {
      resetAvatarToDefault();
    });
  };

  return (
    <div className="field">
      <span className="field-label">Profile picture</span>
      <div className="flex flex-wrap items-center gap-3">
        {forcedIdentity && (
          <span className="text-sm text-muted">
            Your face is fixed while you hold {forcedIdentity.tagName}. Everyone sees {forcedIdentity.name}.
          </span>
        )}
        {!forcedIdentity && portraitMakerEnabled && (
          <button type="button" className="btn-secondary" onClick={() => setMakerOpen(true)}>
            Customize Appearance
          </button>
        )}
        {forcedIdentity ? null : uploadsEnabled ? (
          // NO HoverCard here, deliberately. This used to wear one, and a
          // HoverCard PINS OPEN on click (HoverCard.js §"A click … pins the
          // panel open"). So clicking Browse opened the file picker and left
          // the note standing next to it — a note that said the picture had
          // been uploaded and a GM would review it. Players read that as
          // confirmation, never pressed Save, and their picture never went
          // anywhere: two uploads landed in the game's first eleven days while
          // people asked us how long approval takes. A tooltip must not claim
          // an act that has not happened. What is true at each moment is said
          // below instead — "Click Save below to finalize." on picking, and
          // the confirmation in BioForm once the save actually lands.
          <label className="btn" style={{ cursor: "pointer" }}>
            Browse
            <input
              ref={inputRef}
              type="file"
              name="avatar"
              accept="image/*"
              style={{ display: "none" }}
              onChange={onPick}
            />
          </label>
        ) : (
          // Uploads are off (GameConfig.avatarUploadsEnabled) — no `avatar`
          // field is posted at all. With the portrait maker off too, everyone
          // shows their letter plaque.
          !portraitMakerEnabled && <span className="text-sm text-muted">Using your letter plaque</span>
        )}
        {!forcedIdentity && hasCustomAvatar && (
          // Clears a built portrait and an uploaded picture alike; the plaque
          // is derived at read time, so there is nothing to restore.
          <button type="button" className="btn-quiet" onClick={reset} disabled={resetting}>
            {resetting ? "Resetting…" : "Reset to Default"}
          </button>
        )}
        {/* The ping is a role mention inside #turns, and Play from the web
            closes #turns along with every other channel (CHAT.md §6). So the
            box still records the preference — it is what comes back when they
            switch back — but the line under it says plainly that nothing will
            arrive meanwhile, rather than letting them tick a notification that
            silently cannot be delivered. */}
        <Switch name="turnPingOptIn" defaultChecked={defaultTurnPingOptIn}>
          Ping me when the turn advances
        </Switch>
        {/* The anonymity switch (docs/systemdocs/CHAT.md §6). On, this player's
            Discord account is taken out of every game channel, so a member
            sidebar can no longer say which account is standing in the room.
            The cooldown is enforced server-side in db/lib/webOnly.js — this is
            the hint, not the lock. */}
        {(playPanelEnabled || defaultWebOnly) && (
          <Switch name="webOnly" defaultChecked={defaultWebOnly}>
            <span className="inline-flex items-center gap-1.5">
              Play from the web
              <SwitchInfo text="Removes you from the Discord channels, preserving your character's anonymity. Recommended." />
            </span>
          </Switch>
        )}
        {/* While this is on every message you send posts under your alias and
            the concealing item's own face, and Who's here? lists the alias too.
            Three ways it can be locked — a forced name, a bare face, or
            something you don't get to take off. The label used to name which
            one; it says the rule once in its tooltip instead now, so the
            greying is the only signal left that one of the three applies. The
            server re-checks all three regardless — this is the hint, not the
            lock. */}
        <Switch
          name="concealed"
          defaultChecked={
            forcedIdentity ? false : concealGear?.forced ? true : Boolean(concealGear) && defaultConcealed
          }
          disabled={Boolean(forcedIdentity) || !concealGear || concealGear.forced}
        >
          <span className="inline-flex items-center gap-1.5">
            Conceal
            <SwitchInfo text="Concealment is based on headgear. Some headgear allows you to optionally conceal yourself, while some is forced." />
          </span>
        </Switch>
        {fileName ? (
          <span className="text-sm text-muted">
            {fileName}
          </span>
        ) : null}
      </div>

      {/* Picking a file does not submit anything — the Bio form still has to be
          saved. Saying so is the whole repair: the note that used to sit here
          claimed the upload had already happened, so nobody pressed Save. */}
      {fileName ? (
        <span className="text-sm text-muted">Click Save below to finalize.</span>
      ) : null}

      <FormError>{sizeError}</FormError>

      {/* Mounted only while open, so cancelling and reopening starts from what
          is stored rather than from the abandoned edits. */}
      {makerOpen && (
        <PortraitMaker
          onClose={() => setMakerOpen(false)}
          initialSelection={portraitSelection}
          allowFantasy={portraitFantasyPartsEnabled}
          gender={gender}
        />
      )}
    </div>
  );
}
