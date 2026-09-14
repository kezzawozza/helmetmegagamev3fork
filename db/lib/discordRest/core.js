// Low-level Discord REST helpers shared by bot/ and web/ via @lifeweb/db —
// no gateway/discord.js dependency. Single-guild (DISCORD_GUILD_ID), same
// convention as web/lib/discordGuild.js.
//
// This module is the central fetch wrapper: auth header, rate-limit
// handling, and the invalid-response circuit breaker. It is shared MUTABLE
// state (the breaker counters, the per-bucket rate-limit maps) and must stay
// the one module every other discordRest/* module requires — never
// duplicate it.

const { isLocalMode, localDiscordRequest } = require("../localMode");

const DISCORD_API = "https://discord.com/api/v10";

function authHeaders(extra) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");
  return { Authorization: `Bot ${token}`, ...extra };
}

// Cloudflare counts 401/403/429 responses and IP-bans a token that emits
// 10,000 of them in a rolling 10 minutes (~1hr ban). 404 doesn't count. This
// breaker trips at a tenth of that ceiling to stay well clear.
const INVALID_WINDOW_MS = 10 * 60 * 1000;
const INVALID_LIMIT = 1000;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

// A 429's retry_after is honored only up to this cap — a channel name/topic
// edit can hand back ~600s, which would wedge a whole sequential run behind
// one call. Past the cap the call fails and the caller's catch moves on.
const MAX_RETRY_AFTER_MS = 30_000;
const THREAD_CREATE_MAX_RETRY_AFTER_MS = 180_000;

const invalidTimestamps = [];
let breakerOpenUntil = 0;

// Persisted to GameConfig (Cloudflare's count is keyed on egress IP, so a
// restart would otherwise zero it). Loaded once, written only on error.
let persist = null;
let loaded = false;
let sinceLastWrite = 0;
const WRITE_EVERY = 25;

function attachBreakerStore(store) {
  persist = store;
  loaded = false;
}

async function loadBreakerState() {
  if (loaded || !persist) return;
  loaded = true;
  try {
    const saved = await persist.read();
    if (!saved) return;

    const now = Date.now();
    const openUntil = saved.restBreakerOpenUntil ? new Date(saved.restBreakerOpenUntil).getTime() : 0;
    if (openUntil > now) breakerOpenUntil = openUntil;

    // Only a still-live window is worth restoring, as a count rather than
    // individual timestamps (which were never stored).
    const windowStart = saved.restInvalidWindowStart
      ? new Date(saved.restInvalidWindowStart).getTime()
      : 0;
    if (windowStart && now - windowStart < INVALID_WINDOW_MS && saved.restInvalidCount > 0) {
      for (let i = 0; i < saved.restInvalidCount; i++) invalidTimestamps.push(windowStart);
      console.warn(
        `Discord REST: inherited ${saved.restInvalidCount} invalid responses from a previous ` +
          `process in the current 10-minute window. A non-zero count here means the last one ` +
          `died mid-burst.`,
      );
    }
  } catch (err) {
    console.error("Failed to load the persisted Discord breaker state:", err);
  }
}

function saveBreakerState() {
  if (!persist) return;
  persist
    .write({
      restInvalidCount: invalidTimestamps.length,
      restInvalidWindowStart: invalidTimestamps.length > 0 ? new Date(invalidTimestamps[0]) : null,
      restBreakerOpenUntil: breakerOpenUntil > Date.now() ? new Date(breakerOpenUntil) : null,
    })
    .catch((err) => console.error("Failed to persist the Discord breaker state:", err));
}

function pruneInvalid(now) {
  while (invalidTimestamps.length > 0 && now - invalidTimestamps[0] > INVALID_WINDOW_MS) {
    invalidTimestamps.shift();
  }
}

function recordInvalidResponse(status, path) {
  const now = Date.now();
  invalidTimestamps.push(now);
  pruneInvalid(now);

  // Not awaited — sits inside discordRequest and must not add retry latency.
  loadBreakerState();

  if (invalidTimestamps.length >= INVALID_LIMIT && now >= breakerOpenUntil) {
    breakerOpenUntil = now + BREAKER_COOLDOWN_MS;
    console.error(
      `Discord circuit breaker OPEN: ${invalidTimestamps.length} invalid responses ` +
        `(401/403/429) in the last 10 minutes, most recently ${status} on ${path}. ` +
        `Pausing all outbound Discord REST from this process for 10 minutes to stay ` +
        `clear of Cloudflare's 10,000-per-10-minutes IP ban.`,
    );
    invalidTimestamps.length = 0;
    sinceLastWrite = 0;
    saveBreakerState();
    return;
  }

  sinceLastWrite += 1;
  if (sinceLastWrite >= WRITE_EVERY) {
    sinceLastWrite = 0;
    saveBreakerState();
  }
}

function getInvalidResponseStats() {
  const now = Date.now();
  pruneInvalid(now);
  return {
    invalidInWindow: invalidTimestamps.length,
    limit: INVALID_LIMIT,
    breakerOpen: now < breakerOpenUntil,
    breakerOpenUntil: breakerOpenUntil > now ? new Date(breakerOpenUntil).toISOString() : null,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Per-bucket rate-limit bookkeeping: a reset is recorded against the bucket
// and paid at the start of the next request on that bucket, not slept on
// immediately, so one exhausted route doesn't stall an unrelated one.
const bucketByRoute = new Map();
const resetAtByBucket = new Map();

// Discord buckets by major parameter (channel/guild/webhook id) plus route
// shape — two channels are two different buckets.
function routeKey(method, path) {
  const [, top, majorId, ...rest] = path.split("?")[0].split("/");
  const hasMajor = ["channels", "guilds", "webhooks"].includes(top);
  const major = hasMajor ? `${top}/${majorId}` : top;
  const tail = (hasMajor ? rest : [majorId, ...rest])
    .filter((segment) => segment !== undefined)
    .join("/")
    .replace(/\d{15,}/g, ":id");
  return `${method} ${major}/${tail}`;
}

// Read by db/lib/messageWipe.js for its report.
let requestCount = 0;
let sleepMsTotal = 0;
let retryCount = 0;

function beginRequestMetrics() {
  return { requests: requestCount, sleepMs: sleepMsTotal, retries: retryCount };
}

function readRequestMetrics(since) {
  return {
    requests: requestCount - since.requests,
    sleepMs: sleepMsTotal - since.sleepMs,
    retries: retryCount - since.retries,
  };
}

async function meteredSleep(ms) {
  sleepMsTotal += ms;
  await sleep(ms);
}

// Failures carry the HTTP status and Discord's own JSON error code — callers
// must tell them apart by code, never by matching message text.
function discordError(message, { status = null, discordCode = null } = {}) {
  const err = new Error(message);
  err.status = status;
  err.discordCode = discordCode;
  return err;
}

// Central fetch wrapper: bounded retry on 429 honoring retry_after, throws
// on any other non-2xx (unless allow404). `auth: false` omits the bot
// header for webhook-token URLs; `formData` is a factory (not a value)
// since a consumed body can't re-send on retry.
async function discordRequest(
  path,
  { method = "GET", body, allow404 = false, auth = true, formData = null, maxRetryAfterMs = MAX_RETRY_AFTER_MS } = {},
) {
  // db/lib/localMode.js — the one place local dev's "no real Discord" toggle
  // lives. Short-circuits before auth headers, rate limiting or the breaker
  // even get involved, since none of that means anything without a network
  // call to protect.
  if (isLocalMode()) return localDiscordRequest(path, { method, body });

  const jsonBody = formData === null && body !== undefined;
  const contentType = jsonBody ? { "Content-Type": "application/json" } : undefined;
  const headers = auth ? authHeaders(contentType) : contentType;

  const route = routeKey(method, path);

  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() < breakerOpenUntil) {
      throw discordError(
        `Discord ${method} ${path} refused: circuit breaker open until ` +
          `${new Date(breakerOpenUntil).toISOString()} (too many 401/403/429 responses).`,
      );
    }

    // Pay the deferred reset, if this route's bucket is the one that ran out.
    const knownBucket = bucketByRoute.get(route);
    const resetAt = knownBucket ? resetAtByBucket.get(knownBucket) : undefined;
    if (resetAt !== undefined) {
      const waitMs = resetAt - Date.now();
      resetAtByBucket.delete(knownBucket);
      if (waitMs > 0) await meteredSleep(Math.min(waitMs, MAX_RETRY_AFTER_MS));
    }

    requestCount += 1;
    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: formData !== null ? formData() : jsonBody ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      recordInvalidResponse(res.status, path);
    }

    if (res.status === 429) {
      // A global 429 is the actual ban-adjacent signal — surface it loudly.
      const payload = await res.json().catch(() => ({}));
      if (payload.global || res.headers.get("X-RateLimit-Global") === "true") {
        console.error(`Discord GLOBAL rate limit hit on ${method} ${path}. This is the ban warning shot.`);
      }
      const retryAfterMs = (Number(payload.retry_after) || 1) * 1000;
      if (retryAfterMs > maxRetryAfterMs) {
        throw discordError(
          `Discord ${method} ${path} failed: 429 with retry_after ${Math.round(retryAfterMs / 1000)}s, ` +
            `over the ${maxRetryAfterMs / 1000}s cap — not waiting.`,
          { status: 429, discordCode: payload.code ?? null },
        );
      }
      retryCount += 1;
      await meteredSleep(retryAfterMs);
      continue;
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      const text = await res.text();
      let discordCode = null;
      try {
        discordCode = JSON.parse(text)?.code ?? null;
      } catch {
        // A non-JSON error body (a Cloudflare HTML page) carries no code.
      }
      throw discordError(`Discord ${method} ${path} failed: ${res.status} ${text}`, {
        status: res.status,
        discordCode,
      });
    }

    // Pre-empt the next 429 by spending the reset window lazily, at the
    // next request on the SAME bucket, rather than stalling here.
    const bucket = res.headers.get("X-RateLimit-Bucket");
    if (bucket) bucketByRoute.set(route, bucket);
    if (res.headers.get("X-RateLimit-Remaining") === "0") {
      const resetAfterMs = (Number(res.headers.get("X-RateLimit-Reset-After")) || 0) * 1000;
      if (resetAfterMs > 0) {
        if (bucket) resetAtByBucket.set(bucket, Date.now() + resetAfterMs);
        else await meteredSleep(Math.min(resetAfterMs, MAX_RETRY_AFTER_MS));
      }
    }

    if (res.status === 204) return null;
    return res.json();
  }
  throw discordError(`Discord ${method} ${path} failed: exhausted retries on 429`, { status: 429 });
}

module.exports = {
  discordRequest,
  discordError,
  getInvalidResponseStats,
  attachBreakerStore,
  loadBreakerState,
  recordInvalidResponse,
  beginRequestMetrics,
  readRequestMetrics,
  MAX_RETRY_AFTER_MS,
  THREAD_CREATE_MAX_RETRY_AFTER_MS,
};
