// The page chrome every top-level route sits in. No "use client": markup only, usable from the server components
// every page here is.

const WIDTHS = {
  narrow: "max-w-3xl", // forms and reading-width pages
  default: "max-w-5xl",
  wide: "max-w-6xl", // long GM tables
  // No centring — for a page whose own layout is the width, e.g. /ledger's three columns.
  full: "max-w-none",
};

export default function PageShell({ width = "default", children }) {
  return (
    <div className={`mx-auto flex w-full ${WIDTHS[width] ?? WIDTHS.default} flex-col gap-6 p-6 sm:p-8`}>
      {children}
    </div>
  );
}

// The one page header is components/AppHeader.js, drawn full-bleed ABOVE this shell — that's where a page's title lives.

// A shaped placeholder bar. Deliberately not text, so the layout doesn't jump when real content lands.
export function SkeletonBar({ width = "100%", height = 12 }) {
  return (
    <div
      aria-hidden="true"
      style={{ width, height, background: "var(--field-bg)", borderRadius: "var(--r-sm)" }}
    />
  );
}

// A page-shaped skeleton, built from PageShell so it can't disagree with the real page about width. There is no
// route-level loading.js anywhere (this app holds the screen until the next page is ready, like Discord); this is
// used instead as a Suspense fallback INSIDE a page, shown the first time before a stored snapshot exists.
// Deliberately draws NO header — `title` is ignored, kept only so call sites read as "the skeleton for the Notes
// page" — since the route's own header (drawn above the Suspense boundary) is already on screen while this renders.
export function SkeletonPage({ width, title, panels = [[70, 100, 45]] }) {
  void title;
  return (
    <PageShell width={width}>
      {panels.map((bars, i) => (
        <div key={i} className="panel animate-pulse p-4">
          <div className="flex flex-col gap-3">
            {bars.map((w, j) => (
              <SkeletonBar key={j} width={`${w}%`} />
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  );
}
