import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import AppRail from "../components/AppRail";
import { GM_NAV } from "@/lib/navItems";

// Full-viewport route group: workspaces own their whole screen, no
// PageShell/centred max-width (DESIGN-SYSTEM.md's sanctioned deviation). URL
// space is shared with (app): a path lives in one group or the other, never
// both. Gated GM-only here so pages don't repeat the redirect; actions still
// re-check the gate themselves — a layout gate is presentation only.
export default async function DeskLayout({ children }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const { isGm } = await getGmSession();
  if (!isGm) redirect("/character");

  return (
    <div className="app-shell">
      <AppRail discordUserId={session.discordUserId} fallback={GM_NAV} />
      <main className="app-main">{children}</main>
    </div>
  );
}
