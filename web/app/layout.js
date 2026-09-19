import { UnifrakturMaguntia } from "next/font/google";
import "./globals.css";
import "./chat.css";
// The rebuild, scoped under [data-chat-next] so it cannot reach the live
// chat (docs/systemdocs/CHAT-REBUILD.md). Deleted with chat.css at cutover.
import "./chat-next.css";
import "./sheet.css";
import "./shell.css";
import { getMoveWindow } from "@/lib/turn";
import {
  getVisibleTags,
  getProductionRates,
  getDocumentIndex,
  getCarryReference,
} from "@/lib/referenceData";
import TagsProvider from "./components/TagsProvider";
import ProductionRatesProvider from "./components/ProductionRatesProvider";
import CarryProvider from "./components/CarryProvider";
import DocumentsProvider from "./components/DocumentsProvider";
import MoveWindowProvider from "./components/MoveWindowProvider";
import ConfirmProvider from "./components/ConfirmProvider";
import NoticeProvider from "./components/NoticeProvider";
import { RefreshProvider } from "./components/useRefresh";

// The one download (REDESIGN.md §3). Body, headings and mono are plain system
// stacks declared on :root in globals.css; Source Sans 3, Source Serif 4 and
// IBM Plex Mono are gone.
const display = UnifrakturMaguntia({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata = {
  title: "Bascinet",
  description: "bascinet megagame",
};

// `interactiveWidget: resizes-content` is for Chat on a phone. Chrome on
// Android's default (resizes-visual) leaves the layout viewport alone when
// the keyboard comes up, so a 100dvh shell keeps its full height and the
// composer at its foot sits UNDER the keys. With this the viewport shrinks
// and the composer rides up above them, the way it already does on iOS.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

// Turn state is live game state fetched per-request, not something that
// should be statically prerendered — and prerendering would try to hit the
// database at build time, when it isn't reachable.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }) {
  // The three reference datasets behind {tag:…}/{resource:…}/{document:…}
  // chips. Created un-awaited so they don't block first paint — React
  // streams each promise into its provider, which used to cost three
  // client fetches after hydration. The .catch means a failed query degrades
  // to empty chips instead of crashing the stream with an unhandled
  // rejection.
  const tagsPromise = getVisibleTags().catch(() => []);
  const ratesPromise = getProductionRates().catch(() => null);
  const docsPromise = getDocumentIndex().catch(() => []);
  const carryPromise = getCarryReference().catch(() => null);
  // When Moves lock, for the chip every header wears (LockChip.js). Streamed
  // like the four above so no page has to fetch it and no header has to be
  // handed it as a prop.
  const moveWindowPromise = getMoveWindow().catch(() => null);

  return (
    <html lang="en" className={`${display.variable} h-full`}>
      <body className="h-full">
        {/* One fixed, non-interactive atmosphere layer behind everything. It
            replaces the old .scanlines, which sat at 0.06 opacity and was
            effectively invisible. It composites once and never animates —
            CLAUDE.md is explicit that this must not feel like a laggy bot
            dashboard. */}
        <div className="grain" />
        {/* RefreshProvider sits above every loading.js boundary on purpose —
            it owns the one transition router.refresh() runs in, so a modal or
            a staged row that removes itself in the same handler can't orphan
            it and drop a desk to its skeleton. See useRefresh.js. */}
        <RefreshProvider>
          <ConfirmProvider>
            {/* Inside ConfirmProvider so a notice can be raised from a
                confirm's continuation; see NoticeProvider.js. */}
            <NoticeProvider>
            <TagsProvider tagsPromise={tagsPromise}>
              <ProductionRatesProvider ratesPromise={ratesPromise}>
                <CarryProvider carryPromise={carryPromise}>
                  <DocumentsProvider docsPromise={docsPromise}>
                    <MoveWindowProvider moveWindowPromise={moveWindowPromise}>
                      {children}
                    </MoveWindowProvider>
                  </DocumentsProvider>
                </CarryProvider>
              </ProductionRatesProvider>
            </TagsProvider>
            </NoticeProvider>
          </ConfirmProvider>
        </RefreshProvider>
      </body>
    </html>
  );
}
