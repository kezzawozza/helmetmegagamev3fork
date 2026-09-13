"use client";

// The one "+ Effect / + Transfer / + Room / + Death / + Message / + Public"
// strip.
//
// It existed three times — on the Move desk, on the Caving desk and on the
// push tray — in three slightly different orders, with the tray's extra
// "+ Transfer" wedged into the middle of its copy. Three strips is three
// places for a fourth (now fifth) composer to be added to two of them.
//
// Order is fixed here and never at the call site: Effect, Transfer, Room,
// Death, Message, Public — mechanics first, then words, because that is the
// order a GM stages them in. `onTransfer` is optional; only the tray has
// anything to transfer between. `onRoom` and `onDeath` stage onto a room's
// stash or a character's death respectively and are offered everywhere — a
// staged kill belongs on the Move or caving result that caused it as much as
// on the tray.
export default function StagingStrip({
  onEffect,
  onTransfer = null,
  onRoom = null,
  onDeath = null,
  onMessage,
  onPublic,
  disabled = false,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-quiet" disabled={disabled} onClick={onEffect}>
        + Effect
      </button>
      {onTransfer && (
        <button type="button" className="btn-quiet" disabled={disabled} onClick={onTransfer}>
          + Transfer
        </button>
      )}
      {onRoom && (
        <button type="button" className="btn-quiet" disabled={disabled} onClick={onRoom}>
          + Room
        </button>
      )}
      {onDeath && (
        <button type="button" className="btn-quiet" disabled={disabled} onClick={onDeath}>
          + Death
        </button>
      )}
      <button type="button" className="btn-quiet" disabled={disabled} onClick={onMessage}>
        + Message
      </button>
      <button type="button" className="btn-quiet" disabled={disabled} onClick={onPublic}>
        + Public
      </button>
    </div>
  );
}
