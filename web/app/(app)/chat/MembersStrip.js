"use client";

import { useCallback, useState } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import FormError from "@/app/components/FormError";
import IconButton from "@/app/components/IconButton";
import { CloseIcon } from "@/app/components/icons";
import useActionRunner from "@/app/components/useActionRunner";
import { addMember, removeMember } from "./actions";
import useNarrow from "./useNarrow";

// How many faces the phone's folded row shows before it says "+n".
const FACEPILE_MAX = 5;

// Who is in this conversation or private room, and the two buttons that
// change it. Draws for a `conv:` place and for a PRIVATE `room:` place only —
// a public room needs no guest list, so placeMembers() answers with a null
// `members`. Every rule is the server's: the × is drawn even on a key-holder
// who can't actually be shown out — "take the key" beats a dead button
// (web/app/components/actionRegistry.js).

// `data` is placeMembers()' answer, loaded once by Feed.js and shared with
// the /remove command's picker. `onChanged` asks for a re-read after a write.
// The Add button lives in the chat head now (Feed.js), beside Search, so the
// strip no longer grows the header; `picking` / `setPicking` come from there.
export default function MembersStrip({ placeKey, data, onChanged, picking: pickingProp, setPicking: setPickingProp }) {
  // Controlled by the head's Add button when the shell passes it; its own
  // state otherwise, so no caller can leave it without a way to shut.
  const [pickingOwn, setPickingOwn] = useState(false);
  const picking = setPickingProp ? Boolean(pickingProp) : pickingOwn;
  const setPicking = setPickingProp ?? setPickingOwn;
  const { run, pending, error } = useActionRunner();
  // On a phone the strip is one row of faces until tapped open; closes again
  // on a place change since Feed.js keys itself on the place.
  const narrow = useNarrow();
  const [unfolded, setUnfolded] = useState(false);
  const folded = narrow && !unfolded && !picking;

  const done = useCallback(() => {
    setPicking(false);
    onChanged?.();
  }, [onChanged, setPicking]);

  const onAdd = useCallback(
    (ref) => run(() => addMember(placeKey, ref), undefined, { onOk: done }),
    [placeKey, run, done],
  );

  // Character id for somebody named, opaque hood token for a concealed row (db/lib/presentedMembers.js).
  const onRemove = useCallback(
    (ref) => run(() => removeMember(placeKey, ref), undefined, { onOk: done }),
    [placeKey, run, done],
  );

  if (!data) return null;
  if (!data.ok) {
    return (
      <div className="chat-members">
        <FormError>{data.error}</FormError>
      </div>
    );
  }
  if (!data.members) return null;
  // Nobody else here and the picker shut: nothing to draw, and an empty padded
  // strip would only push the feed down.
  if (data.members.length === 0 && !picking) return null;

  const candidates = data.candidates ?? [];

  if (folded) {
    const shown = data.members.slice(0, FACEPILE_MAX);
    const rest = data.members.length - shown.length;
    return (
      <div className="chat-members chat-members--folded">
        <button
          type="button"
          className="chat-facepile"
          aria-expanded={false}
          aria-label={`${data.members.length} in here — show who`}
          onClick={() => setUnfolded(true)}
        >
          {shown.map((person) => (
            <span key={person.characterId ?? person.token ?? person.name} className="chat-facepile-face">
              <CharacterAvatar
                characterId={person.characterId ?? undefined}
                src={person.avatarPath ?? undefined}
                unknown={Boolean(person.unknownFace)}
                name={person.name}
                version={person.avatarVersion}
                size={22}
              />
            </span>
          ))}
          <span className="chat-facepile-count">
            {rest > 0 ? `+${rest}` : data.members.length === 0 ? "Nobody else" : `${data.members.length} in here`}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="chat-members">
      <div className="chip-row">
        {data.members.map((person) => (
          <span key={person.characterId ?? person.token ?? person.name} className="chip chat-member">
            {/* Same three props the HERE column draws with — must not pass the character id unconditionally, or a disguise breaks. */}
            <CharacterAvatar
              characterId={person.characterId ?? undefined}
              src={person.avatarPath ?? undefined}
              unknown={Boolean(person.unknownFace)}
              name={person.name}
              version={person.avatarVersion}
              size={20}
              zoomable
            />
            <span className="truncate">{person.name}</span>
            <IconButton
              icon={CloseIcon}
              label={`Show ${person.name} out`}
              disabled={pending}
              onClick={() => onRemove(person.characterId ?? person.token)}
            />
          </span>
        ))}
      </div>

      {picking && (
        <div className="chip-row chat-member-picker">
          {candidates.length === 0 ? (
            <span className="text-sm text-muted">Nobody else is standing here.</span>
          ) : (
            candidates.map((person, index) => (
              <button
                key={person.characterId ?? person.token ?? `hooded-${index}`}
                type="button"
                className="chip"
                disabled={pending}
                onClick={() => onAdd(person.characterId ?? person.token)}
              >
                <CharacterAvatar
                  characterId={person.characterId ?? undefined}
                  name={person.name}
                  version={person.avatarVersion}
                  src={person.avatarPath ?? undefined}
                  unknown={Boolean(person.unknownFace)}
                  size={16}
                />
                {person.name}
              </button>
            ))
          )}
        </div>
      )}

      <FormError>{error}</FormError>
    </div>
  );
}
