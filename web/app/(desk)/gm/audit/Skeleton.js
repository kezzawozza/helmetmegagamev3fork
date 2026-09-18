import { SkeletonBar } from "@/app/components/PageShell";

// The desk paints its own frame, so the skeleton is the frame with empty
// columns rather than PageShell's stacked bars — a centred card here would
// reflow into a three-pane workspace the moment the data lands. Traces the
// real AuditDesk's own local .desk-header (no DeskHeader component any
// more — see that file) and AuditInspector's real empty-state root class, so
// the swap-in doesn't visibly reflow.
export default function Loading() {
  return (
    <div className="desk-shell">
      <div className="desk-header">
        <div className="flex min-w-0 items-center gap-3" />
        <div className="flex flex-wrap items-center gap-2">
          <SkeletonBar width="5rem" height={28} />
          <SkeletonBar width="3.5rem" height={28} />
        </div>
      </div>
      <div className="desk-body">
        <div className="desk-rail" />
        <main className="desk-main audit-main">
          <p className="text-muted text-sm p-3">Reading the log…</p>
        </main>
        <aside className="desk-inspector">
          <div className="desk-empty text-muted">
            <p>Pick a line to see who did it, to whom, and with what.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
