"use client";

// The body of every error boundary in the app, so the three of them can't
// drift into three different apologies.
//
// The digest is shown deliberately. In a production build Next replaces a
// server-side error's real message with a hash and logs the message
// server-side only, so the hash is the one thing a player can tell a GM that
// makes the container logs searchable. Hiding it would leave them with
// nothing to report.

import PageShell from "@/app/components/PageShell";

// No header component wraps this any more — the universal top bar
// (AppBar.js) is drawn by the route group's own layout, above whichever
// error boundary caught the failure, so it is already on screen and needs no
// second copy here (and, unlike the old AppHeader, fetches nothing that
// could itself fail). The title becomes a plain in-panel heading instead.
export default function ErrorPanel({ error, retry, title = "Something went wrong" }) {
  return (
    <PageShell width="narrow">
      <div className="panel flex flex-col items-start gap-4 p-4">
        <h1 className="section-title">{title}</h1>
        <p className="text-sm text-muted">That page didn&apos;t load.</p>
        <p className="text-sm text-muted">
          If it keeps happening, tell a GM. Give them the reference below:
        </p>
        {error?.digest && (
          <p className="mono text-xs text-muted">
            Reference: {error.digest}
          </p>
        )}
        <button type="button" className="btn" onClick={() => retry?.()}>
          Try again
        </button>
      </div>
    </PageShell>
  );
}
