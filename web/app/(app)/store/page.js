import { redirect } from "next/navigation";

// Spending Tag Points now happens from a modal on the character sheet (TagRail.js mounting StorePanel.js). This
// stub exists so a bookmark or old link pointing at /store still lands somewhere instead of 404ing.
export default function StoreRedirect() {
  redirect("/character");
}
