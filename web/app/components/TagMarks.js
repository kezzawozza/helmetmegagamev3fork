"use client";

import { Shirt, TriangleAlert, Lock } from "lucide-react";
import { lucide } from "./icons";

// The mechanical states a tag can be in, drawn one way everywhere a tag is
// drawn — the chip face, a sheet row, an item card.
//
// This exists because each surface used to improvise its own. The chat
// drawer appended a bare " ·" for equipped, the sheet row wrote " · worn",
// the item nobody could take yet simply did not appear, and none of the three
// agreed. A player learning one surface learned nothing about the next.
//
// These are MARKS ON THE FACE, not tones. DESIGN-SYSTEM.md's rule holds: a
// chip is a label and a StatusPill is a state, so a chip never recolours
// itself to say "worn" — it wears a small mark instead, and `danger` stays
// the only tone a chip may take.
//
// `compact` is the density switch, and the only difference between contexts:
// a chip has no room for words and gets glyphs, a sheet row has a whole line
// and gets the word as well. Same component either way, so the vocabulary
// cannot drift apart again.

const WornIcon = lucide(Shirt, "WornIcon");
const PoisonIcon = lucide(TriangleAlert, "PoisonIcon");
const LockedIcon = lucide(Lock, "LockedIcon");

const MARKS = [
  { key: "worn", Icon: WornIcon, word: "worn", title: "Worn" },
  // Already a stripped, gated boolean by the time it reaches any caller: it
  // is present only when the row really is poisoned AND this viewer holds
  // poison-sense or a poison-snooper (character/page.js).
  { key: "poison", Icon: PoisonIcon, word: "smells wrong", title: "Smells wrong" },
  { key: "locked", Icon: LockedIcon, word: "locked", title: "You cannot take this yet" },
];

export default function TagMarks({ worn = false, poison = false, locked = false, compact = false }) {
  const on = { worn, poison, locked };
  const shown = MARKS.filter((m) => on[m.key]);
  if (!shown.length) return null;

  return (
    <>
      {shown.map(({ key, Icon, word, title }) =>
        compact ? (
          <Icon key={key} className="tag-mark" data-mark={key} size={11} aria-label={title} />
        ) : (
          <span key={key} className="tag-mark" data-mark={key}>
            {" "}
            &middot; {word}
          </span>
        ),
      )}
    </>
  );
}
