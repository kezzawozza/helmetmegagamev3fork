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
import { updateCharacterProfile } from "../(app)/character/actions";

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
  const [state, formAction, pending] = useActionState(updateCharacterProfile, null);
  // Raised by AvatarField while it shrinks a picked picture in the browser.
  // The transcode is async, so without this a player who picks a file and
  // hits Save immediately would post the original — which for a big photo is
  // the silent body-limit rejection all over again.
  const [shrinking, setShrinking] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <BioNameFields character={character} />
      <AvatarField
        defaultTurnPingOptIn={character.turnPingOptIn}
        gender={character.gender}
        defaultWebOnly={character.webOnly}
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
      <AppearanceField defaultValue={character.appearance ?? ""} />
      <FormError>{state?.error}</FormError>
      {/* Said HERE, after the save has actually landed, and only when a picture
          really went with it. This sentence used to be a tooltip on the Browse
          button, where it was simply untrue — it announced an upload that had
          not happened yet, and players believed it and never pressed Save. */}
      {state?.avatarUploaded ? (
        <span className="text-sm text-muted">
          Your picture has been uploaded. A GM will review it later.
        </span>
      ) : null}
      <button type="submit" className="btn self-start" disabled={pending || shrinking}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
