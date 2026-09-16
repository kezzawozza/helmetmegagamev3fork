"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import ArchiveContext from "@/app/components/ArchiveContext";
import ClickMenu from "@/app/components/ClickMenu";
import FormError from "@/app/components/FormError";
import { MUTE_DURATIONS } from "@lifeweb/db/lib/oocMuteDurations";
import { muteOoc, unmuteOoc } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import { fullTimestamp } from "@/lib/dmTime";

// One out-of-character line, in the scene it was said in.
//
// The lens used to have no desk at all, on the argument that there is nothing
// a GM DOES to a sentence already said. Reading it turned out to be the thing
// they do — a line on its own ("is Mountaineering the skill for the Road by
// the Keep?") tells a GM nothing about what prompted it — so the desk is the
// surrounding transcript, with the line itself marked.
//
// The archive view is ArchiveContext, the same component the inspector's
// Archive tab opens in a modal. One renderer, one fetch, one anchor rule.
//
// Two verbs, and they are the two a GM actually has: answer the person, or
// stop them for a while. Both act on the ACCOUNT behind the character, because
// OOC is the player talking.
export default function OocDesk({ row, onInspect, onClose, registerEscape }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  // Seeded from the server's row and then owned here, so the button answers
  // the last thing this GM did rather than the last page render.
  const [mutedUntil, setMutedUntil] = useState(row.mutedUntil ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const muteTriggerRef = useRef(null);

  useEffect(() => {
    registerEscape?.(() => onClose?.());
    return () => registerEscape?.(null);
  }, [registerEscape, onClose]);

  const run = (fn, args) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn(args);
        if (!res?.ok) {
          setError(res?.error ?? "Something went wrong.");
          return;
        }
        setMutedUntil(res.mutedUntil ?? null);
      } catch (err) {
        setError(mutationErrorMessage(err));
      }
    });
  };

  // A non-null `mutedUntil` IS the mute: the server only ever hands back a
  // LIVE one (db/lib/ooc.js#oocMuteFor drops a lapsed row, and both actions
  // return what they just wrote). Re-deriving it here would mean calling
  // Date.now() during render, which this repo forbids for the good reason that
  // it makes a component's output depend on when it happened to re-render.
  //
  // The cost is small and worth naming: a mute that lapses while the desk sits
  // open still reads "Unmute" until something re-renders it from the server.
  // Pressing it then is a no-op delete, so nothing is lost by being late.
  const muted = Boolean(mutedUntil);

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <CharacterAvatar
            characterId={row.characterId}
            name={row.characterName}
            version={row.avatarVersion}
            catatonic={row.catatonic}
            size={40}
          />
          <div className="min-w-0">
            <h2 className="section-title truncate">{row.characterName}</h2>
            <p className="text-xs text-muted truncate">
              {row.placeName || "somewhere"}
              {row.discordUsername ? ` · @${row.discordUsername}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* The inspector already knows how to be asked for a tab: a third
              argument to onInspect bumps its requestedTab token, and "DMs" is
              one of its base tabs. On a narrow screen inspect() also opens the
              overlay, so this works there without a second affordance. */}
          <button
            type="button"
            className="btn-quiet"
            disabled={!row.characterId}
            onClick={() => onInspect?.(row.characterId, row.characterName, "DMs")}
          >
            Message player
          </button>

          {muted ? (
            <button type="button" className="btn-quiet" disabled={pending} onClick={() => run(unmuteOoc, { discordUserId: row.discordUserId })}>
              Unmute OOC
            </button>
          ) : (
            <>
              {/* A menu rather than a select: picking a duration IS the
                  action, and a select would need a second click on a confirm
                  to say the same thing. */}
              <button
                type="button"
                ref={muteTriggerRef}
                className="btn-quiet"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={pending || !row.discordUserId}
                onClick={() => setMenuOpen((v) => !v)}
              >
                Mute OOC ▾
              </button>
              {menuOpen && (
                <ClickMenu triggerRef={muteTriggerRef} ariaLabel="Mute OOC for" onClose={() => setMenuOpen(false)}>
                  {MUTE_DURATIONS.map((d) => (
                    <button
                      key={d.minutes}
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setMenuOpen(false);
                        run(muteOoc, { discordUserId: row.discordUserId, minutes: d.minutes });
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </ClickMenu>
              )}
            </>
          )}
          <button type="button" className="btn-quiet" onClick={() => onClose?.()}>
            Close
          </button>
        </div>
      </header>

      {/* The line itself, above its scene — so the thing you clicked is
          readable before the transcript has finished loading under it. */}
      <p className="mt-3 text-sm">{row.text}</p>

      {muted && (
        <p className="mt-2 text-xs text-muted">
          OOC muted until {fullTimestamp(new Date(mutedUntil).getTime())}.
        </p>
      )}

      <FormError>{error}</FormError>

      {row.archiveEntryId ? (
        <ArchiveContext archiveEntryId={row.archiveEntryId} />
      ) : (
        // Every line said from here on carries its archive id (db/lib/ooc.js
        // staples it on at delivery). One said before that does not, and there
        // is nothing to look it up by — so this says so plainly instead of
        // showing an empty scene that looks like a bug.
        <p className="p-3 text-sm text-muted">
          This line isn&apos;t linked to the transcript, so there&apos;s no scene to show.
        </p>
      )}
    </div>
  );
}
