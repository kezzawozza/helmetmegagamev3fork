import { SkeletonBar } from "@/app/components/PageShell";

// Only the middle column — the shell lives in layout.js, which stays mounted
// across navigation. Matches RosterTable.js's own root (FilterBar row, table)
// so the column doesn't reflow twice.
export default function Loading() {
  return (
    <main className="desk-main">
      <div className="flex flex-col gap-4 p-3" aria-hidden="true">
        <div className="animate-pulse flex flex-col gap-4">
          {/* FilterBar: the search field, its filters, and the bulk buttons. */}
          <div className="flex flex-wrap items-end gap-3">
            <SkeletonBar width="16rem" height={34} />
            <SkeletonBar width="7rem" height={34} />
            <SkeletonBar width="7rem" height={34} />
            <SkeletonBar width="10rem" height={34} />
          </div>
          {/* The roster itself: a header row and a first screenful. */}
          <SkeletonBar width="100%" height={28} />
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonBar key={i} width="100%" height={22} />
          ))}
        </div>
      </div>
    </main>
  );
}
