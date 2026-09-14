// Both callers must build it the same way or the tag checks silently miss.
export function readerFromCharacter(characterRow) {
  if (!characterRow) return null;
  return {
    ...characterRow,
    tagSlugs: new Set(characterRow.tags.map((ct) => ct.tag.slug)),
    tagNameBySlug: new Map(characterRow.tags.map((ct) => [ct.tag.slug, ct.tag.name])),
  };
}

export function assignedTo(document, character) {
  if (!character) return null;
  if (character.role?.docElements?.includes(document.key)) return character.role.name;
  const tagHit = document.tagSlugs.find((slug) => character.tagSlugs.has(slug));
  if (tagHit) return character.tagNameBySlug.get(tagHit) ?? tagHit;
  if (document.roleSlugs.includes(character.role?.slug)) return character.role.name;
  if (document.factionSlugs.includes(character.faction?.slug)) return character.faction.name;
  if (document.flags.includes("leader") && character.isLeader) return "Leader";
  if (document.flags.includes("treasurer") && character.isTreasurer) return "Treasurer";
  return null;
}

export function documentSource(document, { character, isGm, isMasterGm }) {
  if (document.isPublic) return "Public";
  const assigned = assignedTo(document, character);
  if (assigned) return assigned;
  if (isGm && document.flags.includes("gamemaster")) return "Gamemaster";
  if (isMasterGm && document.isSecret) return "Secret";
  return null;
}

// Never show a player an empty page.
export function isWritten(document) {
  return document.description.trim().length > 0;
}
