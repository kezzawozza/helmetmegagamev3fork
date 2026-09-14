import { SkeletonPage } from "@/app/components/PageShell";

// First visit paints this; later visits paint the last snapshot and refresh underneath. Each panel is a list of bar
// widths: the controls bar, then transcript lines at the ragged lengths speech actually has.
export default function Loading() {
  return <SkeletonPage width="wide" title="Archive" panels={[[60, 30], [95, 80, 90, 70, 88, 60, 92, 75]]} />;
}
