import { redirect, notFound } from "next/navigation";
import { Suspense } from "react";
import SnapshotPage from "@/lib/snapshot/SnapshotPage";
import SnapshotFresh from "@/lib/snapshot/SnapshotFresh";
import DevPanelView from "./DevPanelView";
import Loading from "./Skeleton";
import { getGmSession } from "@/lib/discordGuild";
import { loadDevPanelProps } from "@/lib/devPanelData";

// The GM's one-stop character editor. Gated on GM membership rather than
// superadmin, because it is where every CharacterLink in the app points and
// an in-game GM is meant to use it — only the Delete microaction narrows to
// superadmin, and it does that in the action itself.
//
// The data assembly lives in web/lib/devPanelData.js, shared with the modal
// mount over /gm/turns (web/app/(desk)/gm/turns/devPanelActions.js) — this
// page is just the auth gate and the shell around <DevPanel/>.
// Snapshotted (web/lib/snapshot, CHAT.md §5c): the page reads the session,
// mounts the shell, and streams FreshDevCharacterPanel in behind it. A browser that has
// been here before paints its last data in the first frame.
export default async function DevCharacterPanelPage({ params }) {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  const { characterId } = await params;
  return (
    <SnapshotPage scope={`gm-dev-character:${characterId}`} userId={session.discordUserId} render={DevPanelView} fallback={<Loading />}>
      <Suspense fallback={null}>
        <FreshDevCharacterPanel params={params} userId={session.discordUserId} />
      </Suspense>
    </SnapshotPage>
  );
}

async function FreshDevCharacterPanel({ params, userId }) {
  const { characterId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const props = await loadDevPanelProps(characterId, session.discordUserId);
  if (!props) notFound();

  return (
    <SnapshotFresh
      scope={`gm-dev-character:${characterId}`}
      userId={userId}
      data={{
        ...props,
      }}
    />
  );
}
