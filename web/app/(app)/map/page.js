import AppHeader from "@/app/components/AppHeader";
import MapBoard from "./MapBoard";

// The map as its own page — a link of its own, and a phone shouldn't open a full-bleed board inside the "Here"
// sheet. Owns its whole screen like Chat and the (desk) workspaces: no PageShell, no centred max-width, a 100dvh
// column that doesn't scroll. Sign-in gate is the (app) layout's; the FOG is loadMap()'s, per character not per route.

export const metadata = { title: "Map" };

export default function MapPage() {
  return (
    <div className="map-shell">
      <AppHeader title="Map" />
      <MapBoard />
    </div>
  );
}
