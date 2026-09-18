import { redirect } from "next/navigation";
import { getGmSession } from "@/lib/discordGuild";
import AppBar from "../components/AppBar";
import { GM_NAV } from "@/lib/navItems";

// Full-viewport route group: workspaces own their whole screen, no
// PageShell/centred max-width (DESIGN-SYSTEM.md's sanctioned deviation). URL
// space is shared with (app): a path lives in one group or the other, never
// both. Gated GM-only here so pages don't repeat the redirect; actions still
// re-check the gate themselves — a layout gate is presentation only.
export default async function DeskLayout({ children }) {
  // One call for both answers. It used to await auth() first and then
  // getGmSession(), which wraps the same auth() — a second headers() read for
  // a session it already had.
  const { session, isGm, inGuild } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  // Departed the guild: no web access at all, not just the desk (see (app)/layout.js).
  if (!inGuild) redirect("/");
  if (!isGm) redirect("/character");

  return (
    <div className="app-shell">
      <AppBar discordUserId={session.discordUserId} fallback={GM_NAV} />
      <main className="app-main">{children}</main>
    </div>
  );
}
