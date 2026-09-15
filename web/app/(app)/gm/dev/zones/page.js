import { redirect } from "next/navigation";

// Not a page any more — Zones is a SECTION of the Dev Panel, inside the desk
// shell with every other one. The folder stays for the table this section
// renders, its server actions, and the nested editors below it, which are
// still routes of their own.
export default function ZonesRedirect() {
  redirect("/gm/dev?s=zones");
}
