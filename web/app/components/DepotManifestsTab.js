"use client";

// Which shelves exist, and what opens each one.
//
// The shut ones are shown as well as the open ones, on purpose: knowing there
// is a black market and that it wants a chip is the interesting half, and a
// door you cannot see is a door nobody goes looking for.
export default function DepotManifestsTab({ manifests = [], openManifests = [], wares = [] }) {
  return (
    <section className="panel p-5">
      <h2 className="panel-header">Manifests</h2>
      <ul className="depot-list mt-4">
        {manifests.map((m) => {
          const open = openManifests.includes(m.id);
          const count = wares.filter((w) => w.manifest === m.id).length;
          return (
            <li key={m.id}>
              <span>
                <strong>{m.name}</strong>
              </span>
              <span className={open ? "mono" : "mono text-muted"}>{open ? `${count} wares` : "closed"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
