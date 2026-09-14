import "server-only";
import fs from "node:fs";
import { cache } from "react";
import { docsPath } from "@lifeweb/db/lib/repoPaths";

// Turbopack inlines __dirname as a literal, so use docsPath, not a hand-rolled path.join.
const getHandbookText = cache(() => {
  const p = docsPath("handbook.md");
  if (!p) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
});

export function getHandbookBody() {
  const text = getHandbookText();
  if (!text) return null;
  return text.replace(/^#\s+.*\n+/, "");
}

// Reserved in db/lib/syncDocuments.js#RESERVED_KEYS — a synthesized card's key can never double as a real Document row's key.
export const HANDBOOK_KEY = "handbook";
