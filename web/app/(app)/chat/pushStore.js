"use client";

import { useSyncExternalStore } from "react";

// Whether this BROWSER is subscribed to Web Push, held in a module store like feedStore.js
// and seenStore.js: react-hooks/set-state-in-effect is an error in this repo, and these are
// async questions about the browser asked outside a render. Nothing here is a permission
// check — the routes it posts to resolve the account from the session (web/app/api/push/subscribe/route.js).

let state = { ready: false, supported: false, key: null, on: false, busy: false };
const listeners = new Set();

function emit(next) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

const SERVER = { ready: false, supported: false, key: null, on: false, busy: false };

function getServerSnapshot() {
  return SERVER;
}

export function usePushState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// The VAPID public key arrives base64url; PushManager wants the raw bytes.
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

let started = false;

// Asked once per tab. The toggle needs: a PushManager (iOS home-screen app yes, Safari tab
// no), the deployment's keys (the key route 404s without them), and the ON state.
export async function initPush() {
  if (started) return;
  started = true;
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    emit({ ready: true, supported: false });
    return;
  }

  let key = null;
  try {
    const res = await fetch("/api/push/key");
    if (res.ok) key = (await res.json())?.key ?? null;
  } catch {
    // Offline, or the route is down. No toggle rather than a toggle that cannot work.
  }
  if (!key) {
    emit({ ready: true, supported: false });
    return;
  }

  let on = false;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const existing = registration ? await registration.pushManager.getSubscription() : null;
    on = Boolean(existing);
  } catch {
    // A browser that refuses to say is treated as not subscribed; pressing the button asks it properly.
  }
  emit({ ready: true, supported: true, key, on });
}

// The toggle. Unsubscribing tells the browser and then the server, in that order, so a
// half-done unsubscribe leaves a row that the first 410 from the push service cleans up (db/lib/webPush.js).
export async function togglePush() {
  if (state.busy || !state.supported || !state.key) return;
  emit({ busy: true });
  try {
    if (state.on) {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const existing = registration ? await registration.pushManager.getSubscription() : null;
      const endpoint = existing?.endpoint ?? null;
      if (existing) await existing.unsubscribe().catch(() => {});
      if (endpoint) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      emit({ on: false });
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      // Denied is sticky in every browser: the button goes back to off.
      emit({ on: false });
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.key),
    });
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    emit({ on: res.ok });
  } catch {
    // Every failure here is the browser refusing something.
    emit({ on: false });
  } finally {
    emit({ busy: false });
  }
}
