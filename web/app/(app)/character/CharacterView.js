"use client";

import CharacterSheet from "@/app/components/CharacterSheet";
import CreateCharacterWizard from "./CreateCharacterWizard";
import CreationClosed from "./CreationClosed";
import Lobby from "./lobby/Lobby";

// What /character draws, from page.js#FreshCharacter (stored copy first, then
// fresh via web/lib/snapshot). Four kinds, one component each. The other
// three draw their own PageShell; the sheet is the full-width workspace
// (CharacterSheet.js), so the layout above wears no shell of its own.
export default function CharacterView({ kind, open, lobby, wizard, sheet }) {
  if (kind === "closed") return <CreationClosed open={open} />;
  if (kind === "lobby") return <Lobby {...lobby} />;
  if (kind === "wizard") return <CreateCharacterWizard {...wizard} />;
  return <CharacterSheet {...sheet} />;
}
