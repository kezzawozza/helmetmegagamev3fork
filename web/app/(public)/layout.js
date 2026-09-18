import { getGmSession } from "@/lib/discordGuild";
import AppBar from "../components/AppBar";
import { GM_NAV, PLAYER_NAV } from "@/lib/navItems";
import SnapshotGuard from "@/lib/snapshot/SnapshotGuard";

// The one route group that renders for a signed-out visitor. (app) redirects
// to "/" without a session (AppLayout), and (desk) is GM-only — neither can
// hold a page meant to be handed out as a bare link (a recruiting post, a
// Discord pin) before the reader has ever signed in. /handbook lives here for
// exactly that reason.
//
// Same .app-shell/.app-main frame as (app), but the bar only mounts for a
// signed-in reader — an anonymous visitor gets the page alone, full width,
// with nothing in the chrome implying a session that doesn't exist. .app-main
// is a plain `flex: 1` (globals.css), so it needs no extra class to fill the
// column on its own when AppBar isn't there above it.
export default async function PublicLayout({ children }) {
  // Same call and the same reason as (app)'s layout: the rail's fallback has
  // to know whether this reader is a GM, or /handbook paints a player rail
  // and then shoves a GM section in above it. A signed-out visitor returns
  // below before any of that, so the anonymous path pays nothing for it.
  const { session, isGm } = await getGmSession();

  if (!session?.discordUserId) {
    // A signed-out browser lands here. No account on the page means every
    // stored page snapshot is somebody's old sheet (CHAT.md §5c), so the
    // guard clears them. No bar either — a signed-out visitor gets the page
    // alone, matching the old no-rail behaviour: signed-out /handbook and
    // /analysis lose their header entirely, on purpose.
    return (
      <div className="app-shell">
        <SnapshotGuard userId={null} />
        <main className="app-main">{children}</main>
      </div>
    );
  }

  // The turn used to be a bubble pinned to the corner here too. /handbook
  // wears the universal top bar now (AppBar), which carries it — see (app)'s
  // layout for the same removal.
  return (
    <div className="app-shell">
      <AppBar discordUserId={session.discordUserId} fallback={isGm ? GM_NAV : PLAYER_NAV} />
      <main className="app-main">{children}</main>
    </div>
  );
}
