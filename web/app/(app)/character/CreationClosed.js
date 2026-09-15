import Link from "next/link";
import PageShell from "@/app/components/PageShell";

// Shown in place of the creation wizard when a player can't roll a character
// yet — game not running (GameState.phase) or not on the roster
// (PLAYER_ROLE_ID). With GameConfig.playtestModeEnabled on, anyone outside
// the build crew is turned away as "not open yet" rather than "not on the
// roster" (page.js's `gate.masked`) — a closed rehearsal shouldn't advertise
// itself. createCharacter enforces both independently; this just surfaces
// the reason up front instead of after four steps of work.
export default function CreationClosed({ open }) {
  return (
    <PageShell>
      <h2 className="section-title">{open ? "You are not on the roster" : "Ravenheart is not open yet"}</h2>
      <div className="panel flex flex-col gap-3 p-4">
        <p className="text-sm">
          {open
            ? "Character creation is open, but your Discord account doesn't carry the player role for this game. Apply in #apply."
            : "Character creation's not open yet!"}
        </p>
        <p className="text-sm text-muted">
          {open
            ? "If you think that's a mistake, ask a GM to add you. In the meantime, the public rules are worth reading."
            : "Have a look at the Documents page in the meantime."}
        </p>
        <div>
          <Link href="/documents" className="btn-secondary">
            Read the documents
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
