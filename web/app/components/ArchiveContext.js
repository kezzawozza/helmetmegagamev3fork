"use client";

import { useEffect, useRef, useState } from "react";
import FormError from "@/app/components/FormError";
import MarkdownContent from "@/app/components/MarkdownContent";
import TranscriptLine from "@/app/components/TranscriptLine";
import { getArchiveContext } from "@/app/(desk)/gm/turns/actions";

// "In context": the ~30 messages before and after one archived line, in the
// same Discord channel or thread, so a GM looking at a single row gets the
// scene instead of the sentence.
//
// This is the VIEW only. It was the whole of ArchiveContextModal until the OOC
// lens needed the same thing in the middle of the desk rather than over the
// top of it — the modal is a thin wrapper around this now, and there is still
// exactly one renderer, one fetch and one anchor rule between the two.
//
// `maxHeight` is the one thing they disagree about: inside a modal the list
// has a viewport to be a fraction of, and inside a desk pane it should simply
// fill what it was given.
//
// `onLoaded` MUST BE STABLE — it is in the fetch's deps, so an inline arrow
// would re-fetch on every render, forever. Callers wrap it in useCallback.
export default function ArchiveContext({ archiveEntryId, maxHeight = null, onLoaded = null }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const anchorRef = useRef(null);

  useEffect(() => {
    if (!archiveEntryId) return undefined;
    let cancelled = false;
    (async () => {
      const res = await getArchiveContext({ archiveEntryId });
      if (cancelled) return;
      if (res?.ok) {
        setState({ loading: false, data: res, error: null });
        onLoaded?.(res);
      } else {
        setState({ loading: false, data: null, error: res?.error ?? "Couldn't load that." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [archiveEntryId, onLoaded]);

  // Centred rather than scrolled-to-top: the line a GM clicked is the middle
  // of the thing they want, not the start of it.
  useEffect(() => {
    if (state.data) anchorRef.current?.scrollIntoView({ block: "center" });
  }, [state.data]);

  if (state.loading) return <p className="p-3 text-sm text-muted">Loading the scene…</p>;
  if (state.error) {
    return (
      <div className="p-3">
        <FormError>{state.error}</FormError>
      </div>
    );
  }
  if (!state.data) return null;

  return (
    <div className="p-3">
      <p className="mb-2 text-xs text-muted">{state.data.channelLabel}</p>
      <div
        className="flex flex-col gap-3"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
      >
        {state.data.entries.map((e) => (
          /* The anchor needs a plain element to hold the ref and the marker
             class, so the line renderer sits inside it rather than being it. */
          <div
            key={e.id}
            ref={e.id === state.data.anchorId ? anchorRef : undefined}
            data-anchor={e.id === state.data.anchorId || undefined}
            className={e.id === state.data.anchorId ? "desk-archive-anchor" : undefined}
          >
            <TranscriptLine
              as="div"
              density="thread-compact"
              gutter={false}
              startsRun
              name={e.concealedAlias ? `${e.concealedAlias} (${e.characterName})` : e.characterName}
              alias={Boolean(e.concealedAlias)}
              meta={e.turnNumber != null ? <span className="tline-place">turn {e.turnNumber}</span> : null}
              time={e.sentAt.slice(0, 16).replace("T", " ")}
            >
              <MarkdownContent content={e.content} />
            </TranscriptLine>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Old messages may already be wiped from Discord; the transcript is the record.
      </p>
    </div>
  );
}
