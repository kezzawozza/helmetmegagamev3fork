import PageShell from "@/app/components/PageShell";
import { CURSED_REFUSAL } from "@/lib/characterCreation";

// Shown in place of the creation wizard while this player's last body lies
// unburied (db/lib/curse.js). The curse used to narrow the wizard to Migrant
// and Bum at six fewer points; it shuts the door outright now, so there is no
// wizard to grey out. createCharacter and reserveRoleAction enforce it
// independently — this only says so before four steps of work.
export default function CreationCursed() {
  return (
    <PageShell>
      <h2 className="section-title">You are still in the ground</h2>
      <div className="panel flex flex-col gap-3 p-4">
        <p className="text-sm">{CURSED_REFUSAL}</p>
        <p className="text-sm text-muted">
          You can still watch, and you can still speak with the other dead.
        </p>
      </div>
    </PageShell>
  );
}
