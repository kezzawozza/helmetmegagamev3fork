"use client";

import { useState, useTransition } from "react";

// The one shape a button that calls a { ok, error } server action needs: a
// pending flag, the last refusal, and a runner that turns a transport failure
// into a sentence instead of an unhandled rejection. Dozens of surfaces used
// to carry their own copy of these nine lines, and every copy was missing the
// catch — a dropped connection left the button spinning with nothing said.
export default function useActionRunner() {
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // `onFail` is for a caller that cleared something optimistically and has to
  // put it back — the chat composer empties its box the moment Enter lands, so
  // a refusal has to hand the words back rather than leave the player retyping
  // them. It fires for BOTH failure shapes: an { ok: false } answer and a
  // thrown one, which are the same thing from the caller's side.
  function exec(action, args, { onOk, onFail } = {}) {
    setError(null);
    startTransition(async () => {
      let message = null;
      try {
        const res = await action(...args);
        if (!res?.ok) message = res?.error ?? "Something went wrong.";
        else if (onOk) onOk(res);
      } catch {
        message = "Could not reach the server. Nothing was changed.";
      }
      if (message !== null) {
        setError(message);
        if (onFail) onFail(message);
      }
    });
  }

  // The common case: one argument, and somewhere to hang onOk/onFail.
  function run(action, arg, opts) {
    exec(action, [arg], opts);
  }

  // For actions that take several positional arguments — the place editor's
  // (zoneId, id, direction) writers. Six of those files each kept a
  // hand-rolled variadic copy of this whole hook rather than bend to `run`.
  function call(action, ...args) {
    exec(action, args);
  }

  return { run, call, pending, error, setError };
}
