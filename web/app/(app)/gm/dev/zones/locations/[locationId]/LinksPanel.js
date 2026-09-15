"use client";

import Link from "next/link";
import Panel from "@/app/components/Panel";

// A location's own travel edges, read-only — the full editor with a
// create-a-link form lives at /gm/dev/zones/links, which needs a picker
// across every location. This is just "what does this place connect to".
export default function LinksPanel({ links }) {
  return (
    <Panel title="Travel links">
      {links.length === 0 ? (
        <p className="text-muted text-sm">No links yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.id}>
              <Link href={`/gm/dev/zones/locations/${l.otherId}`} className="menu-item">
                {l.otherName}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <Link href="/gm/dev/zones/links" className="menu-item">
          Manage links →
        </Link>
      </p>
    </Panel>
  );
}
