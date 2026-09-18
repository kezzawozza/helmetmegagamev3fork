"use client";

// What this character has standing half-finished: a CraftProject is a pocket
// item in progress, an UNDER_CONSTRUCTION site is a wall someone is still
// building. Both otherwise only show up inside the Craft dialog, which is a
// bad place to keep a clock.
//
// A finished or ruined site is not "in progress" and belongs to
// StandingHerePanel, which the sheet mounts beside this one.
export default function LedgerWork({ craftProjects = [], sitesHere = [] }) {
  const sites = sitesHere.filter((s) => s.status === "UNDER_CONSTRUCTION");
  const nothing = craftProjects.length === 0 && sites.length === 0;

  return (
    <section className="panel p-3">
      <h2 className="panel-header">Crafting & building</h2>
      {nothing ? (
        <p className="text-sm text-muted">Nothing in progress.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {craftProjects.map((p) => (
            <li key={`project-${p.id}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                {p.quantity > 1 ? `${p.quantity}× ` : ""}
                {p.tagName}
              </span>
              <span className="mono text-muted">
                {p.turnsDone}/{p.turnsNeeded} turns
              </span>
            </li>
          ))}
          {sites.map((s) => (
            <li key={`site-${s.id}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">{s.typeName}</span>
              <span className="mono text-muted">
                {s.turnsDone}/{s.turnsNeeded} turns
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
