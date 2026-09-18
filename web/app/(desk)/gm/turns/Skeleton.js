import { SkeletonBar } from "@/app/components/PageShell";

// Deliberately not SkeletonPage — draws the real desk's own FRAME so only the
// content swaps: a skeleton local `.desk-header` sized like Workspace.js's
// (no DeskHeader component any more — see that file), the three columns, and
// the push tray strip (mirrors StagingTray.js's `.desk-tray` /
// `.desk-tray-bar`). `.desk-header` is flex-wrap, so a bar-free skeleton
// would be one line where the real one is two.
export default function Loading() {
  return (
    <div className="desk-shell">
      <div className="desk-header">
        <div className="flex min-w-0 items-center gap-3">
          <SkeletonBar width="5rem" height={22} />
          <SkeletonBar width="4rem" height={16} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SkeletonBar width="6.5rem" height={28} />
        </div>
      </div>
      <div className="desk-body">
        <aside className="desk-rail" aria-hidden="true" />
        <main className="desk-main">
          <p className="p-6 text-sm text-muted">Loading the queue…</p>
        </main>
        <aside className="desk-inspector" aria-hidden="true" />
      </div>
      <section className="desk-tray" aria-hidden="true">
        <div className="desk-tray-bar">
          <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <strong>Push tray</strong>
            <span className="mono">…</span>
          </span>
        </div>
      </section>
    </div>
  );
}
