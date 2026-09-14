import "server-only";
import fs from "node:fs";
import { cache } from "react";
import { docsPath } from "@lifeweb/db/lib/repoPaths";

// docs/assets/map-nodes.json — where each Location sits on the drawn plate, in image pixels.
// The plate image itself is duplicated at web/public/assets/map-plate.png (a binary, hand-edited nowhere).
export const PLATE_SRC = "/assets/map-plate.png";

const EMPTY = { width: 0, height: 0, nodes: {} };

const readNodes = cache(() => {
  const p = docsPath("assets/map-nodes.json");
  if (!p) return EMPTY;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      width: parsed.width ?? 0,
      height: parsed.height ?? 0,
      nodes: parsed.nodes ?? {},
    };
  } catch {
    return EMPTY;
  }
});

export function plateSize() {
  const { width, height } = readNodes();
  return { width, height };
}

// null if the table does not place this slug yet.
export function nodeAt(slug) {
  const node = readNodes().nodes[slug];
  if (!node || typeof node.x !== "number" || typeof node.y !== "number") return null;
  return { x: node.x, y: node.y };
}
