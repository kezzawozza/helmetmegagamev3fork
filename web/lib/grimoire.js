// The Grimoire's body (docs/systemdocs/THANATI.md), composed on the server
// from the rite catalog and this game's rolled Words of the Circle. The
// Document row in docs/documents.yaml holds only the `{grimoire}` marker, so
// the YAML never carries generated prose and a new game's words need no sync.
//
// One block per rite, in catalog order, in exactly the shape Bascinet gave:
//
//   **Name** | Minimum cultists: N | Ingredients: …
//   description
//   Word of the Circle: {word:…}
//
// The word rides in a {word:} token (RichText / DocumentMarkdown / ChipText)
// so it renders as a chip. Hard breaks (two trailing spaces) keep the three
// lines inside one paragraph.
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

// Swap the marker for the body on the one document that carries it. Every
// other row passes through untouched.
export function expandGrimoire(document, words) {
  if (document?.key !== GRIMOIRE_DOCUMENT_KEY) return document;
  if (document.description.trim() !== GRIMOIRE_MARKER) return document;
  return { ...document, description: grimoireBody(words) };
}
