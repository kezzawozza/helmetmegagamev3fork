import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { touchLastSeen } from "@lifeweb/db/lib/characterActivity";
import { getGmSession } from "@/lib/discordGuild";
import AppBar from "../components/AppBar";
import { GM_NAV, PLAYER_NAV } from "@/lib/navItems";

// The nav item lists and loadNavItems moved to web/lib/navItems.js when (desk)
// grew a bar of its own — see the note at the top of that file.

export default async function AppLayout({ children }) {
  // getGmSession() rather than auth(): it wraps the same (React-cached) auth()
  // call and adds the guild-member lookup, which is itself cached for five
  // minutes with in-flight dedup (web/lib/discordGuild.js). That buys the
  // fallback below its SHAPE — without it every GM navigation into this group
  // painted a player rail first and then dropped the GM section in on top,
  // shoving the whole list down. (desk) never had that tell because it has
  // always passed a fallback matching its user; this is the same rule, and
  // /documents already awaited this exact call for its own GM-only entries.
  const { session, isGm, inGuild } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  // Departed the Discord guild: the session is still valid, but web access
  // isn't (root CLAUDE.md "Web app auth"). page.js knows not to bounce them
  // straight back here.
  if (!inGuild) redirect("/");

  // The "online" badge's clock (db/lib/whosHere.js) — any page view in this
  // group counts as "used the website," Bascinet's call. After the response,
  // not before it: a page render should never wait on this. touchLastSeen
  // is itself debounced and swallows its own errors, so a hiccup here can
  // never surface as a broken page.
  after(() => touchLastSeen(prisma, session.discordUserId));

  // No turn chip here any more. It used to be a bubble pinned to the corner of
  // the viewport for every route in this group, hidden by CSS on Chat because
  // Chat drew its own in its header. Every page wears the universal top bar
  // now, so the turn is stated once, in it — see components/AppBar.js.
  return (
    <div className="app-shell">
      <AppBar discordUserId={session.discordUserId} fallback={isGm ? GM_NAV : PLAYER_NAV} />
      <main className="app-main">{children}</main>
    </div>
  );
}
