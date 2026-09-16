import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import Credentials from "next-auth/providers/credentials";
import { NextRequest } from "next/server";
import { isLocalMode } from "@lifeweb/db/lib/localMode";
import { SUPERADMIN_DISCORD_IDS } from "./superadmin";

// Behind Railway's proxy, Next.js builds `request.url` from the container's
// own listener and ignores the Host header, so the /api/auth/* route handler
// would hand Discord a bad OAuth redirect_uri and break sign-in on every
// domain. Rebuild the origin from the forwarded headers before Auth.js sees
// the request. `signIn()`/`signOut()` already read x-forwarded-host and need
// no help. An origin taken from a client-controllable header is an
// open-redirect vector in an OAuth flow, so hosts are allowlisted rather
// than trusted — anything unrecognised falls back to the canonical origin.
// Adding a domain means adding it here AND registering its callback URL in
// the Discord Developer Portal.
export const CANONICAL_ORIGIN = "https://ravenheart.quest";

const ALLOWED_HOSTS = new Set([
  "ravenheart.quest",
  "web-production-38d02.up.railway.app",
]);

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function resolveOrigin(request) {
  // x-forwarded-host can be a comma-separated chain; the first entry is the originating host.
  const forwarded =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = forwarded?.split(",")[0].trim();
  if (!host) return CANONICAL_ORIGIN;

  if (LOCAL_HOST.test(host)) {
    return `${request.headers.get("x-forwarded-proto") ?? "http"}://${host}`;
  }
  if (!ALLOWED_HOSTS.has(host)) return CANONICAL_ORIGIN;

  return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
}

// Mirrors how next-auth itself rewrites a request origin, so method/headers/body survive the swap.
function withPublicOrigin(request) {
  const origin = resolveOrigin(request);
  const { href, origin: current } = request.nextUrl;
  if (current === origin) return request;
  return new NextRequest(href.replace(current, origin), request);
}

const nextAuth = NextAuth({
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      // Don't ask players for email — Auth.js defaults to `identify email` and nothing here reads one.
      authorization: { params: { scope: "identify" } },
    }),
    // Registered only under LOCAL_MODE (db/lib/localMode.js). Signs in as the first superadmin id
    // by default (LOCAL_MODE's member-lookup stub treats that as holding every local role).
    // `playerId` is the other door in (web/app/actions.js#startAsLocalPlayer) — a freshly rolled
    // discordUserId for a throwaway character, so a page that decides player-vs-GM by "does this
    // discordUserId own a living character" reads as a player once one exists.
    ...(isLocalMode()
      ? [
          Credentials({
            id: "local",
            name: "Local (dev only)",
            credentials: { playerId: { type: "text" } },
            async authorize(credentials) {
              return { id: credentials?.playerId || SUPERADMIN_DISCORD_IDS[0] };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, profile, user }) {
      // `profile` is Discord's OAuth profile; `user` is the local Credentials authorize() result. Never both at once.
      const discordUserId = profile?.id ?? user?.id;
      if (discordUserId) {
        token.discordUserId = discordUserId;
      }
      // Cache the handle behind the account while Discord is handing it to us —
      // this is the one moment the web sees it, and there is no name-to-id
      // lookup to recover it later (db/lib/discordAccounts.js). Only on a real
      // OAuth sign-in: the Credentials provider (local dev) carries no profile.
      // Awaited but never allowed to throw — a cache write must not cost
      // somebody their sign-in.
      if (discordUserId && profile?.username) {
        try {
          const { prisma } = await import("@lifeweb/db");
          const { rememberDiscordAccount } = await import("@lifeweb/db/lib/discordAccounts");
          await rememberDiscordAccount(prisma, {
            discordUserId,
            username: profile.username,
            globalName: profile.global_name ?? null,
          });
        } catch (err) {
          console.error("Failed to remember Discord handle on sign-in:", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.discordUserId) {
        session.discordUserId = token.discordUserId;
      }
      return session;
    },
  },
});

export const { auth, signIn, signOut } = nextAuth;

export const handlers = {
  GET: (request) => nextAuth.handlers.GET(withPublicOrigin(request)),
  POST: (request) => nextAuth.handlers.POST(withPublicOrigin(request)),
};
