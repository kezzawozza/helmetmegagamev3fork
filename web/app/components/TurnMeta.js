import { describeTurn } from "@/lib/turnFormat";
import { loadFeedViewer } from "@/lib/feedAccess";

// "TOWN · DAY 6" — where you are and when it is, in the header of every page (AppHeader.js), the
// one place the turn is stated. A server component inside a Suspense boundary; loads the zone itself rather than
// taking it from the page since it's used from layouts too, and a layout can't be handed a prop by its child.
export default async function TurnMeta({ turnPromise }) {
  const [turn, viewer] = await Promise.all([turnPromise, loadFeedViewer()]);
  const { label } = describeTurn(turn);
  const zone = viewer.character?.location?.zone?.name ?? (viewer.gm ? "Gamemaster" : null);

  return (
    <span className="header-note">
      {zone ? `${zone} · ` : ""}
      {label}
    </span>
  );
}
