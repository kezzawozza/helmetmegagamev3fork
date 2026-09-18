import { signInWithDiscord, signInLocally, startAsLocalPlayer } from "../actions";
import { isLocalMode } from "@lifeweb/db/lib/localMode";

export default function HomeScreen({ turnLabel, leftGuild = false }) {
  // Under LOCAL_MODE there's no real DISCORD_CLIENT_ID/SECRET for the
  // Discord button to hand off to, so the one button IS the local sign-in
  // here rather than sitting beside a second one — nobody testing locally
  // needs the option to hit real (broken) Discord OAuth by mistake.
  const local = isLocalMode();

  return (
    <main className="relative z-10 flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex flex-col items-center">
        <h1 className="wordmark text-5xl tracking-widest sm:text-6xl">Bascinet</h1>
        <div className="wordmark-rule my-3" />
        <p className="text-sm tracking-[0.2em] uppercase text-muted">
          {turnLabel}
        </p>
      </div>

      {/* Signed in, but the Discord side no longer recognizes them (left,
          kicked, banned). A plain "sign in" prompt would be confusing here —
          they already are signed in, they just have nothing to sign into. */}
      {leftGuild && (
        <p className="max-w-sm text-sm text-muted">
          You&apos;ve left the Discord server. Rejoin to keep using the site.
        </p>
      )}

      <form action={local ? signInLocally : signInWithDiscord}>
        <button type="submit" className="btn">
          {local ? "Sign in (LOCAL_MODE, no Discord)" : "Sign in with Discord"}
        </button>
      </form>

      {/* A second door, only under LOCAL_MODE: the button above always signs
          in as the superadmin id with no character, which is the wrong shape
          for testing anything a player sees. This one rolls a fresh identity
          and a stock Migrant to go with it. */}
      {local && (
        <form action={startAsLocalPlayer}>
          <button type="submit" className="btn-secondary">
            Start as a player (LOCAL_MODE)
          </button>
        </form>
      )}
    </main>
  );
}
