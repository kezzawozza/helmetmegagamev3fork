// The Grimoire's body (docs/systemdocs/THANATI.md), composed server-side from the rite catalog and
// this game's rolled Words of the Circle. The `{grimoire}` marker in docs/documents.yaml means the
// YAML never carries generated prose. The word rides in a {word:} token to render as a chip.
import { RITES } from "@lifeweb/db/lib/rites";

export const GRIMOIRE_DOCUMENT_KEY = "grimoire";
const GRIMOIRE_MARKER = "{grimoire}";

export function grimoireBody(words = {}) {
  return RITES.map((rite) => {
    const head = [
      `**${rite.name}**`,
      `Minimum cultists: ${rite.minChanters}`,
      rite.ingredientsText ? `Ingredients: ${rite.ingredientsText}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    const phrase = words[rite.key] ?? "…";
    return `${head}  \n${rite.description}  \n_Word of the Circle:_ {word:${phrase}}`;
  }).join("\n\n");
}

export function expandGrimoire(document, words) {
  if (document?.key !== GRIMOIRE_DOCUMENT_KEY) return document;
  if (document.description.trim() !== GRIMOIRE_MARKER) return document;
  return { ...document, description: grimoireBody(words) };
}
