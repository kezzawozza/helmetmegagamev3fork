"use client";

import PageShell from "@/app/components/PageShell";
import NotesBoard from "./NotesBoard";

// What the page draws, from the one object page.js#FreshNotes produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <NotesBoard> always took.
export default function NotesView(props) {
  return (
    <PageShell width="narrow">
      <NotesBoard {...props} />
    </PageShell>
  );
}
