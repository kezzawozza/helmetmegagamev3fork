import { redirect } from "next/navigation";

// /gm/dev/threats is not a page — the threat surfaces are two SECTIONS of the
// Dev Panel (Assignments and Antagonists, THREATS.md §1), reached as /gm/dev?s=assignments;
// the folder beside this one holds their tables, which the panel imports; it never held a page.js.
export default function ThreatsRedirect() {
  redirect("/gm/dev?s=assignments");
}
