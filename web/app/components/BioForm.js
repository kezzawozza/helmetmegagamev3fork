"use client";

// The Bio form, pulled out of CharacterSheet so it can be a client component
// and read what the action returns.
//
// It used to be a bare `<form action={updateCharacterProfile}>` inside a
// server component, which meant the action had nowhere to report a problem to.
// The avatar size check therefore threw a plain Error — and Next redacts
// anything thrown out of a Server Action into React error #441, so a player
// picking a 6MB photo got a digest instead of "that image is too big". Same
// for a corrupt image sharp can't decode.
//
// useActionState is the channel: the action returns { error } and it renders
// here. See web/lib/actionResult.js for why validation is returned, never
// thrown.

import { useActionState, useState } from "react";
import BioNameFields from "./BioNameFields";
import AvatarField from "./AvatarField";
import AppearanceField from "./AppearanceField";
import FormError from "./FormError";
import Modal from "./Modal";
import { updateCharacterProfile } from "../(app)/character/actions";

// The mockup's own Bio panel shows one field: Appearance, then Save
// (docs/design/mockups/character/index.html). Everything else this card used
// to hold — the read-only name fields, gender, age, title, the picture and
// its three switches — moves behind one quiet button in the header, opening a
// settings dialog on the same fields, unchanged.
//
// TWO independent forms, both posting the same server action
// (updateCharacterProfile), because Modal fully UNMOUNTS its children on
// close (Modal.js: `if (!open) return null`) — a single shared form would
// lose turnPingOptIn/discordMirrored/concealed off the DOM the moment the
// dialog closed, and updateCharacterProfile reads a missing checkbox as
// "off" and applies it (character/actions.js), which would silently un-mirror
// a player from Discord or drop their ping the next time they saved
// Appearance alone. So Appearance's own form carries hidden fallback inputs
// for those three, defaulting to the character's actual stored values, and
// the settings dialog is a save of its own — each revalidates the page, so
// the fallbacks are never stale once a settings save has actually landed.
export default function BioForm({
  character,
  avatarUploadsEnabled,
  playPanelEnabled = true,
  portraitMakerEnabled,
  portraitFantasyPartsEnabled,
  portraitSelection,
  hasCustomAvatar,
  forcedIdentity,
  concealGear,
}) {
  const [appearanceState, appearanceAction, appearancePending] = useActionState(
    updateCharacterProfile,
    null,
  );
  const [settingsState, settingsAction, settingsPending] = useActionState(
    updateCharacterProfile,
    null,
  );
  // Raised by AvatarField while it shrinks a picked picture in the browser.
  // The transcode is async, so without this a player who picks a file and
  // hits Save immediately would post the original — which for a big photo is
  // the silent body-limit rejection all over again.
  const [shrinking, setShrinking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <section className="panel p-3">
      <h2 className="panel-header">
        Bio
        <button type="button" className="note btn-quiet" onClick={() => setSettingsOpen(true)}>
          Name, portrait and settings…
        </button>
      </h2>
      <form action={appearanceAction} className="flex flex-col gap-3">
        <AppearanceField defaultValue={character.appearance ?? ""} />
        {/* The fallback trio — see the header comment. Present only while the
            dialog holding the real checkboxes is closed, so there is never a
            second input answering to the same name at once. */}
        <input type="hidden" name="turnPingOptIn" value={character.turnPingOptIn ? "on" : ""} />
        <input type="hidden" name="discordMirrored" value={character.discordMirrored ? "on" : ""} />
        <input type="hidden" name="concealed" value={character.concealed ? "on" : ""} />
        <FormError>{appearanceState?.error}</FormError>
        <button type="submit" className="btn self-start" disabled={appearancePending}>
          {appearancePending ? "Saving…" : "Save"}
        </button>
      </form>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Name, portrait and settings"
      >
        <form action={settingsAction} className="flex flex-col gap-3">
          <BioNameFields character={character} />
          <AvatarField
            defaultTurnPingOptIn={character.turnPingOptIn}
            gender={character.gender}
            defaultDiscordMirrored={character.discordMirrored}
            playPanelEnabled={playPanelEnabled}
            defaultConcealed={character.concealed}
            uploadsEnabled={avatarUploadsEnabled}
            portraitMakerEnabled={portraitMakerEnabled}
            portraitFantasyPartsEnabled={portraitFantasyPartsEnabled}
            portraitSelection={portraitSelection}
            hasCustomAvatar={hasCustomAvatar}
            forcedIdentity={forcedIdentity}
            concealGear={concealGear}
            onBusyChange={setShrinking}
          />
          {/* Appearance is not touched by this form — a blank hidden field
              here would otherwise clear it, since updateCharacterProfile
              treats a missing appearance the same as an emptied one. */}
          <input type="hidden" name="appearance" value={character.appearance ?? ""} />
          <FormError>{settingsState?.error}</FormError>
          {/* Said HERE, after the save has actually landed, and only when a
              picture really went with it. This sentence used to be a tooltip
              on the Browse button, where it was simply untrue — it announced
              an upload that had not happened yet, and players believed it and
              never pressed Save. */}
          {settingsState?.avatarUploaded ? (
            <span className="text-sm text-muted">
              Your picture has been uploaded. A GM will review it later.
            </span>
          ) : null}
          <div className="modal-actions">
            <button type="submit" className="btn" disabled={settingsPending || shrinking}>
              {settingsPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
