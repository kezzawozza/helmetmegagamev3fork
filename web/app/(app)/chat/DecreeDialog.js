"use client";

import { useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import DecreeComposer from "@/app/(desk)/gm/turns/DecreeComposer";
import { getDecreeZones } from "./actions";

// The `/decree` command's door, in a place DecreeComposer itself never had to
// know about: the desk (web/app/(desk)/gm/turns/Workspace.js) always has its
// zone list server-rendered already, because the page it lives on is GM-only
// from the route down. /chat is not — most of its readers are players — so
// this wrapper is the one new piece: fetch the zones a GM may address, GM-gated
// same as the send itself, then hand DecreeComposer exactly what it already
// expects. DecreeComposer is unchanged; this is the only new file.
export default function DecreeDialog({ onClose }) {
  const [zones, setZones] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDecreeZones().then((res) => {
      if (cancelled) return;
      if (res?.ok) setZones(res.zones);
      else setError(res?.error ?? "Couldn't load the zones.");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Modal title="Decree" onClose={onClose}>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-danger">{error}</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // No skeleton worth building for a fetch this quick — a blank Modal shell
  // for the one frame it takes says as much as a spinner would.
  if (!zones) return <Modal title="Decree" onClose={onClose} />;

  return <DecreeComposer zones={zones} onClose={onClose} />;
}
