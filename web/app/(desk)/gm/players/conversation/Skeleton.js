import { SkeletonBar } from "@/app/components/PageShell";

// Renders inside the desk shell layout.js already painted — neither rail nor
// inspector re-suspends on picking a different person — so this fills only the conversation.
export default function Loading() {
  return (
    <div className="desk-person">
      <div className="desk-convo">
        <div className="desk-convo-thread animate-pulse flex flex-col gap-3">
          <SkeletonBar width="40%" />
          <SkeletonBar width="80%" />
          <SkeletonBar width="55%" />
          <SkeletonBar width="90%" />
          <SkeletonBar width="45%" />
        </div>
      </div>
    </div>
  );
}
