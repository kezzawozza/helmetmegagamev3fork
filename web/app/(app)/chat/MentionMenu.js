"use client";

import { memo } from "react";
import CharacterAvatar from "@/app/components/CharacterAvatar";

// The composer's @ list: the people standing where you stand, nobody else. Roster is whosHere().named, the same
// list CharacterMentionsProvider resolves a {char:…} against on the way back — a mention stays honest both ways.
// Concealed people are deliberately absent: a hood is choosing not to be addressable.

const MentionMenu = memo(function MentionMenu({ matches, active, onPick, onHover }) {
  if (matches.length === 0) return null;
  return (
    <div className="chat-mentions" role="listbox" aria-label="Mention somebody">
      {matches.map((person, i) => (
        <button
          key={person.id}
          type="button"
          role="option"
          aria-selected={i === active}
          data-active={i === active ? "true" : "false"}
          className="menu-item"
          // Mousedown rather than click: the textarea must not lose focus before the pick lands.
          onMouseEnter={() => onHover?.(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(person);
          }}
        >
          <CharacterAvatar
          characterId={person.id}
          name={person.name}
          version={person.updatedAt}
          src={person.avatarPath ?? undefined}
          size={16}
        />
          <span className="truncate">{person.name}</span>
        </button>
      ))}
    </div>
  );
});

export default MentionMenu;

// What the composer is looking at, given the text and where the caret is.
//
// Returns `{ at, query }` for a live `@word` the caret sits at the end of, or
// null. The `@` has to open a word — mid-word it is an email address or a
// Discord handle somebody pasted, neither of which is a mention here.
export function mentionQueryAt(text, caret) {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  // A space ends it.
  if (/\s/.test(query)) return null;
  return { at, query };
}

// Case-insensitive prefix on the whole name or any word in it, capped (the popover is twelve rems tall). `limit`
// is a parameter since Feed.js#CommandArgs wants a wider row and the UNCAPPED count (asks for Infinity, slices itself).
// A hood has `alias` where a named person has `name`; matching whichever it has works for both lists.
export function matchRoster(roster, query, limit = 6) {
  const q = query.trim().toLowerCase();
  const hits = roster.filter((person) => {
    if (!q) return true;
    const name = (person.name ?? person.alias ?? "").toLowerCase();
    return name.startsWith(q) || name.split(/\s+/).some((word) => word.startsWith(q));
  });
  return limit === Infinity ? hits : hits.slice(0, limit);
}
