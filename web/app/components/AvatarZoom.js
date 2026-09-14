"use client";

import { useState } from "react";

import Modal from "./Modal";

// Click a face, see the face. Every avatar in the game is drawn somewhere
// between 16 and 64 pixels, and every one of them is stored at 256 — an upload
// is resized to 256 on save, and the portrait maker and the letter plaques both
// render onto a 256 canvas (PORTRAITS.md). So the good version was always there
// and nothing ever showed it; a player who spent ten minutes in the portrait
// maker only ever saw their work as a dot next to their name.
//
// Wraps the face rather than replacing it, so the caller keeps whatever it was
// already drawing — the catatonic dot, the tooltip, its own sizing.
//
// Everything a dialog needs is Modal's: the backdrop, Escape, the focus trap,
// focus restore, and the bottom sheet under 640px. `title` is not decoration —
// it carries the ✕, which on a phone is the only way out.
//
// `src` is whatever the caller was ALREADY showing, never a URL rebuilt here.
// That matters: a concealed character's face is a mask sprite or a letter
// plaque that presentedIdentity chose for the person looking, and rebuilding
// /api/avatar/<id> would serve their real one instead (PROXYING.md §5).
//
// `modalWidth`/`fullClassName` default to the avatar shape above (a fixed
// 256, a narrow panel) — a caller zooming something that isn't a stored
// avatar (a player's DM photo, DmThread.js#AttachedImages) passes its own.
export default function AvatarZoom({ src, name, children, modalWidth = "narrow", fullClassName = "avatar-zoom-full" }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="avatar-zoom"
        aria-label={`Look closer at ${name}`}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>

      {open && (
        <Modal title={name} width={modalWidth} onClose={() => setOpen(false)}>
          {/* Capped at its real 256 rather than filling the panel: a `narrow`
              panel is 24rem, and stretching 256 pixels across it would only
              show them bigger and blurrier. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className={fullClassName} />
        </Modal>
      )}
    </>
  );
}
