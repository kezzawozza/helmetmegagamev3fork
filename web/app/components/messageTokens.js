"use client";

import InfoIcon from "./InfoIcon";
import CharacterAvatar from "./CharacterAvatar";
import { useCharacterMentions } from "./CharacterMentionsProvider";

// The short token vocabulary a MESSAGE is allowed to resolve, shared by every renderer that draws one (feed, DM,
// starred line, transcript, journal entry) — one copy so they cannot drift again. Deliberately short: the catalog
// tokens ({tag:…}, {resource:…}, {document:…}) are authored reference syntax, and resolving them here would let
// anyone mint a live chip mid-scene; RichText.js is still the full-fat renderer for authored prose.

// A {char:…} payload is `<id>` or `<id>|<name it was sent under>`. Split on the
// FIRST bar only: an id never contains one, and a name might.
export function splitCharPayload(payload) {
  const raw = (payload ?? "").trim();
  const bar = raw.indexOf("|");
  if (bar === -1) return { id: raw, frozenName: null };
  return { id: raw.slice(0, bar).trim(), frozenName: raw.slice(bar + 1).trim() || null };
}

// A {char:<id>} in a message. The map comes from CharacterMentionsProvider (web/lib/mentionDirectory.js). The
// NAME is frozen in the token itself, same rule as ArchiveEntry.characterName/.concealedAlias/.presentedAvatarPath,
// so a later rename or hood can't rewrite what a past line said. The FACE is gated on that same frozen name — only
// drawn when the directory still resolves that id to it — so a renamed character loses the face rather than gaining the wrong one; a miss with no frozen name draws a person-shaped blank rather than a raw cuid.
//
// The face is gated a SECOND time, on `hidden`. The frozen-name gate only ever caught a rename: pulling a hood
// up never touches Character.name, so a chip went on drawing the true portrait beside the correctly-hooded
// name. And the face is drawn from the PRESENTED path the directory hands over, never from `characterId`
// alone — that builds /api/avatar/<id>, which is identity-blind (CharacterAvatar.js) and is exactly the
// branch a concealed character must never reach.
export function CharMention({ payload }) {
  const mentionsById = useCharacterMentions();
  const { id, frozenName } = splitCharPayload(payload);
  const character = mentionsById.get(id);
  const name = frozenName ?? character?.name ?? null;
  if (!name) return <span className="chat-mention chat-mention--unknown">someone</span>;

  const faced = character && !character.hidden && (!frozenName || character.name === frozenName);
  return (
    <span className="chat-mention">
      {faced ? (
        <CharacterAvatar
          src={character.avatarPath ?? undefined}
          characterId={character.id}
          name={character.name}
          version={character.updatedAt}
          size={16}
          zoomable
        />
      ) : (
        <CharacterAvatar name={name} unknown size={16} />
      )}
      <span>{name}</span>
    </span>
  );
}

// The `richtoken` element remarkTokens.js emits, for a message body.
export default function MessageToken({ kind, payload, raw }) {
  if (kind === "char") return <CharMention payload={payload} />;
  if (kind === "info") return <InfoIcon text={payload.trim()} />;
  if (kind === "cmd") return <code className="cmd-chip">/{payload.trim()}</code>;
  return raw;
}
