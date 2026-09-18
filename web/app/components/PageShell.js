import { GAME_YEAR } from "@lifeweb/db/turnCalendar";

// The page chrome every top-level route sits in. No "use client": markup only, usable from the server components
// every page here is. The container itself is the one from
// docs/design/mockups/character/index.html (see shell.css's ".page" rules) —
// `default` and `wide` both mean that one 1180px column now, `narrow` is a
// tighter reading width (/lifeweb, /notes), and `full` stays unconstrained
// for a page whose own layout is the width, e.g. /gm/dev's zone editors.
const WIDTH_CLASS = {
  narrow: "page page--narrow",
  default: "page",
  wide: "page",
  full: "page page--full",
};

export default function PageShell({ width = "default", children }) {
  return (
    <div className={`mx-auto flex w-full flex-col gap-6 ${WIDTH_CLASS[width] ?? WIDTH_CLASS.default}`}>
      {children}
      <div className="foot">
        <span>Ravenheart · the year of our Lord God, {GAME_YEAR}</span>
      </div>
    </div>
  );
}

// There is no per-page header any more. The universal top bar
// (components/AppBar.js) draws full-bleed ABOVE this shell, once per route
// group — that's where the active link says which page this is.

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
