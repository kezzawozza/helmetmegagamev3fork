"use client";

import { useCallback, useMemo, useState } from "react";
import useActionRunner from "@/app/components/useActionRunner";
import {
  commandsFor,
  exactCommand,
  matchCommands,
  pendingArg,
  slashQueryAt,
  textArgOf,
} from "./commands";

// THE COMMAND LINE, once, for both composers.
//
// The player's composer and the GM's (Feed.js) are different boxes — one has a
// voice picker, paperwork, mentions and slowmode; the other posts as Bascinet
// into a place nobody stands in — but `/` behaves identically in each, and it
// used to exist only in the first. A GM opening a place they may not speak in
// got a bare textarea and no way to run anything at all.
//
// Everything about command mode lives here: the `/` popover's state, the
// picked command, what it answered, and the three keystrokes that drive it.
// The two composers keep their own draft and their own send.
//
//   slash    { query, active } while the `/` popover is open. Null the rest of
//            the time, including all of command mode — once a command is
//            picked there is nothing left to autocomplete.
//   command  { entry, values } — command MODE. Never set for a `dialog`
//            command (commands.js): picking one runs it immediately instead,
//            since it has nothing for the box to hold.
//   cmdLine  what the command answered, cleared on the next keystroke so it
//            never outlives the thing it explains.
export default function useComposerCommands({
  placeKind,
  gm = false,
  hasCharacter = true,
  draft,
  setDraft,
  textareaRef,
  ctx,
  // A phone keyboard's Enter is a newline, so it never runs a command either.
  coarse = false,
  onTyping = null,
}) {
  const [slash, setSlash] = useState(null);
  const [command, setCommand] = useState(null);
  const [cmdLine, setCmdLine] = useState(null);
  const {
    run: runCommand,
    pending: cmdPending,
    error: cmdError,
    setError: setCmdError,
  } = useActionRunner();

  // Which commands the open place allows (./commands.js). Recomputed per
  // place rather than filtered at use: a /roll offered in the street and
  // refused on Enter is a control that lied.
  const available = useMemo(
    () => commandsFor(placeKind, { gm, hasCharacter }),
    [placeKind, gm, hasCharacter],
  );

  const cmdMatches = useMemo(
    () => (slash ? matchCommands(available, slash.query) : []),
    [slash, available],
  );

  const focus = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [textareaRef]);

  // Leaving command mode. The typed text comes BACK into the box rather than
  // being thrown away — Escape on a half-written /report should not cost
  // somebody the paragraph they had written into it.
  const exitCommand = useCallback(
    (keepText = "") => {
      setCommand(null);
      setSlash(null);
      setCmdError(null);
      setDraft(keepText);
      focus();
    },
    [setCmdError, setDraft, focus],
  );

  // `keepText` is for the speech-mode control, which is a change of VOICE
  // rather than a change of subject — somebody who typed a sentence and then
  // decided it was out of character should not have to type it again. The `/`
  // popover still clears, since there the text WAS the command name.
  //
  // A `dialog` command (commands.js) never enters command mode at all: it has
  // nothing for the box to hold — no text argument, no chips to fill in — so
  // there is nothing to press Enter on. Picking it runs it immediately,
  // exactly the way clicking an ordinary button would, and the box is left
  // untouched.
  const pickCommand = useCallback(
    (entry, keepText = "") => {
      setSlash(null);
      setCmdLine(null);
      if (entry.dialog) {
        setDraft(keepText);
        entry.run({}, ctx);
        focus();
        return;
      }
      setDraft(keepText);
      setCommand({ entry, values: {} });
      focus();
    },
    [setDraft, focus, ctx],
  );

  const setArg = useCallback((name, value) => {
    setCommand((cur) => (cur ? { ...cur, values: { ...cur.values, [name]: value } } : cur));
  }, []);

  // Enter, in command mode. Every gate here is a hint — each command's `run`
  // lands on a server action that re-resolves the actor and re-checks
  // everything, so a missing argument caught here only spares a round trip.
  const runCurrent = useCallback(() => {
    if (!command) return;
    const { entry, values } = command;
    const textArg = textArgOf(entry);
    const body = draft.trim();
    if (textArg && !body) {
      setCmdError("Write something first.");
      return;
    }
    if (textArg?.maxLength && body.length > textArg.maxLength) {
      setCmdError(`That is ${body.length} characters, and the most is ${textArg.maxLength}.`);
      return;
    }
    if (pendingArg(entry, values)) {
      setCmdError("Pick one first.");
      return;
    }
    const filled = textArg ? { ...values, [textArg.name]: body } : values;
    // Cleared HERE, not in onOk. /shout fans out to every place that heard it
    // and only then resolves, so the line was visible in the feed for seconds
    // while the words still sat in the box — and if anything downstream threw,
    // onOk never ran and they sat there for good. The plain send clears
    // optimistically too; this is the same rule for the command half, with
    // onFail handing the words back on a refusal.
    setCommand(null);
    setDraft("");
    runCommand(
      // `run` may answer with nothing at all — /look and /converse only open
      // something — and useActionRunner reads a missing `ok` as a failure.
      async () => (await entry.run(filled, ctx)) ?? { ok: true },
      undefined,
      {
        onOk: (res) => setCmdLine(res?.line ?? null),
        // Back exactly as it was: the chip, the arguments already picked, and
        // the sentence. Retyping a refused shout is the one thing worse than
        // watching it sit there.
        onFail: () => {
          setCommand({ entry, values });
          setDraft(body);
          focus();
        },
      },
    );
  }, [command, draft, runCommand, ctx, setCmdError, setDraft, focus]);

  // The edit half, called before anything else the box does with a keystroke.
  // Answers whether the command layer TOOK the change — a composer that gets
  // `true` has nothing further to do with it.
  const onDraftChange = useCallback(
    (value) => {
      // The last command's answer explains the box as it was a moment ago, so
      // it goes the instant the box changes.
      setCmdLine(null);
      setCmdError(null);

      // Already in command mode: the box is the command's text argument, so the
      // SLASH list never belongs in it — you are inside a command already. The
      // @ list does, for the two commands whose argument is a line somebody
      // SAYS (./commands.js `mentions`). The composer reads `mentionsHere` and
      // runs its own @ menu over the same keystroke; this branch still takes
      // the change, because the slash half must stay shut either way.
      if (command) {
        setDraft(value);
        onTyping?.();
        return true;
      }

      // `/shout ` — the whole name and a space. Discord's composer does this,
      // and it is how anybody who knows the command avoids the menu entirely.
      // Routed through pickCommand so a `dialog` entry opens the same way
      // here as it does from the popover, rather than this branch
      // re-deciding command-mode-vs-immediate on its own.
      const exact = exactCommand(available, value);
      if (exact) {
        pickCommand(exact);
        return true;
      }
      return false;
    },
    [command, available, pickCommand, setCmdError, setDraft, onTyping],
  );

  // The `/word` under the caret. Separate from the above because the caller
  // decides the order it competes with its own @ list in.
  const readSlash = useCallback((value, caret) => {
    const found = slashQueryAt(value, caret);
    setSlash(found ? { ...found, active: 0 } : null);
    return Boolean(found);
  }, []);

  // The keys command mode owns. `true` means the keystroke is spent.
  const onKeyDown = useCallback(
    (event) => {
      // The `/` list owns the keys while it is open, the same way the @ list
      // does — and it is checked first, because the two are never open at once
      // and this one is the more recently opened when they compete.
      if (slash && cmdMatches.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : cmdMatches.length - 1;
          setSlash((cur) => (cur ? { ...cur, active: (cur.active + step) % cmdMatches.length } : cur));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          pickCommand(cmdMatches[slash.active] ?? cmdMatches[0]);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlash(null);
          return true;
        }
      }
      // In command mode the box belongs to the command. Escape drops the chip;
      // so does Backspace on an empty box, which is how Discord's composer
      // lets go of one.
      if (command) {
        if (event.key === "Escape") {
          event.preventDefault();
          exitCommand(`/${command.entry.name} `);
          return true;
        }
        if (event.key === "Backspace" && draft.length === 0) {
          event.preventDefault();
          exitCommand(`/${command.entry.name}`);
          return true;
        }
        if (!coarse && event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          runCurrent();
          return true;
        }
        // Everything else in command mode is typing into the argument.
        return true;
      }
      return false;
    },
    [slash, cmdMatches, command, draft, coarse, exitCommand, pickCommand, runCurrent],
  );

  return {
    available,
    slash,
    setSlash,
    command,
    setCommand,
    cmdLine,
    setCmdLine,
    cmdMatches,
    cmdPending,
    cmdError,
    setCmdError,
    exitCommand,
    pickCommand,
    setArg,
    runCurrent,
    onDraftChange,
    // Whether the command currently in the box is one the @ menu may open
    // inside. Read by ./Feed.js — the hook itself owns no mention state.
    mentionsHere: Boolean(command?.entry?.mentions),
    readSlash,
    onKeyDown,
    // The word on the send button. A command DOES something, so it runs by
    // default — but /ooc and /shout only put words in the room, and "Run" read
    // like a program was about to start rather than a line about to be said.
    verb: command ? (command.entry.verb ?? "Run") : null,
  };
}
