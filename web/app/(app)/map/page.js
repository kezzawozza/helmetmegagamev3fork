import MapBoard from "./MapBoard";

// The map as its own page — a link of its own, and a phone shouldn't open a full-bleed board inside the "Here"
// sheet. Owns its whole screen like Chat and the (desk) workspaces: no PageShell, no centred max-width, a column
// that doesn't scroll. Sign-in gate is the (app) layout's; the FOG is loadMap()'s, per character not per route. No
// AppHeader any more — the universal top bar ((app)/layout.js) already says "Map" via the active link.

export const metadata = { title: "Map" };

export default function MapPage() {
  return (
    <div className="map-shell">
      <MapBoard />
    </div>
  );
}
