"use client";

// COMMAND MODE reads as a strip across the top of the box — what you are
// running, what it does, and a way out. It used to be a floating accent-tinted
// pill above the textarea, which read as a bubble stuck to the composer rather
// than as a state the box was in. Shared by both composers (Feed.js).
export default function CommandStrip({ entry, onExit }) {
  return (
    <div className="chat-cmd-strip">
      <span className="chat-cmd-strip-name mono">/{entry.name}</span>
      {entry.description && <span className="chat-cmd-strip-hint">{entry.description}</span>}
      <button
        type="button"
        className="chat-cmd-strip-out"
        aria-label="Leave command mode"
        onClick={() => onExit("")}
      >
        ✕
      </button>
    </div>
  );
}
