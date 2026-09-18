"use client";

// "Why this row matched", in one form.
//
// Three surfaces grew their own: the queue rail printed the bare field name
// (" · role"), the roster printed the same with a different dot, and the
// inspector's lookup printed the VALUE with no dot at all. Same question,
// three answers, none of which told a GM searching "smith" whether the hit
// was a role or a tag.
//
// The form is a muted suffix: `· <what matched>`, the value when the caller
// can supply one, the field's own name when it cannot. A name match says
// nothing — the name is already the biggest thing on the row.
export default function MatchHint({ match, values = null, className = "" }) {
  if (!match) return null;
  const field = match.matchedField;
  if (!field || field === "name") return null;
  const shown = values?.[field] || FIELD_WORDS[field] || field;
  if (!shown) return null;
  return <span className={`text-xs text-muted ${className}`.trim()}> · {shown}</span>;
}

// What to say when the caller has no value to show for the field.
const FIELD_WORDS = {
  username: "handle",
  role: "role",
  zone: "zone",
  tag: "tag",
  preview: "message text",
};
