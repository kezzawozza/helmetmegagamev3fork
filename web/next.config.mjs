/** @type {import('next').NextConfig} */
const nextConfig = {
  // Version skew. Every push redeploys, and a page left open across one calls
  // server actions and prefetched routes the new build no longer has — the
  // logs were full of "Failed to find Server Action", and a player claiming a
  // Desire got the error screen. With a deployment id, Next spots the mismatch
  // and does a full reload instead. Railway sets the commit sha at build time;
  // unset locally, which leaves this off in dev.
  deploymentId: process.env.RAILWAY_GIT_COMMIT_SHA,

  // sharp is a native/binary module used only inside "use server" actions
  // (avatar resizing). Without this, Turbopack tries to trace its
  // platform-detection code (which touches node:fs) into client bundles
  // that reference those actions, crashing with "Cannot find module
  // 'node:fs'" at runtime in the browser.
  serverExternalPackages: ["sharp"],

  // Avatar uploads (AvatarField -> updateCharacterProfile) post a whole image
  // through a Server Action, and Next's default action body limit is 1 MB.
  // Without this, a normal phone photo was killed by the framework BEFORE the
  // action ran: our own 5 MB check never spoke, useActionState never got an
  // { error } to render, and the player watched Save come back having done
  // nothing at all. Two uploads in the game's whole history got through.
  //
  // The number is deliberately ABOVE the 5 MB file cap in
  // app/(app)/character/actions.js. Multipart framing plus the other Bio
  // fields ride along in the same body, so a file just under 5 MB makes a body
  // just over it — and a body over this limit is the silent 413 again. The
  // headroom keeps OUR message ("It has to be under 5MB.") the one that fires.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },

  // /gm/messages and the old /gm/players table merged into one desk at
  // /gm/players. Both old URLs are in GMs' history, in audit-log links and in
  // Discord scrollback, so they redirect rather than 404.
  //
  // permanent: false (307) on purpose: a 308 is cached by the browser more or
  // less forever, and this is an internal tool with no SEO to protect and a
  // real chance of another reshuffle.
  // The frozen page snapshots under public/ux (scripts/dev/snapshot-site.mjs)
  // are plain files, so /ux/<dir>/ normalizes to /ux/<dir> and then 404s —
  // there is no such file. Design tools get handed the bare directory, so
  // serve its index. The snapshot's own <base> tag keeps the sibling links
  // resolving from either form of the URL.
  async rewrites() {
    return [{ source: "/ux/:dir", destination: "/ux/:dir/index.html" }];
  },

  async redirects() {
    return [
      { source: "/gm/messages", destination: "/gm/players", permanent: false },
      {
        source: "/gm/messages/:discordUserId",
        destination: "/gm/players/:discordUserId",
        permanent: false,
      },
      // The Chat page was /play until 2026-09-09. This redirect is not
      // housekeeping -- it is load-bearing. Push notifications ALREADY
      // DELIVERED to players' phones carry /play#<placeKey> URLs
      // (db/lib/webPush.js, bot/src/lib/mentions.js, feedOutbox.js), and
      // there is no reaching back into a notification to rewrite it. Drop
      // this and every one of those taps 404s.
      //
      // The hash survives on its own: a fragment is never sent to the
      // server, so the browser reattaches it to the destination and the
      // place still opens.
      { source: "/play", destination: "/chat", permanent: false },
    ];
  },
};

export default nextConfig;
