"use client";

// The one "+ Effect / + Transfer / + Room / + Death / + Message / + Public"
// strip, shared by the Move desk, Caving desk and push tray so a new composer
// is added once, not three times. Order is fixed here, never at the call
// site: mechanics first, then words, the order a GM stages them in.
// `onTransfer` is optional — only the tray has anything to transfer between.
// `onRoom`/`onDeath` are offered everywhere: a staged kill belongs on the
// causing Move or caving result as much as on the tray.
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
