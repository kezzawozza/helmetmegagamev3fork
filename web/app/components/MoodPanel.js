"use client";

// A leaf module — tables and pure functions, no prisma require — so naming it
// from a client component does not drag PrismaClient into the browser bundle.
import { MOOD_BANDS, bandOf } from "@lifeweb/db/lib/mood";

// What moves a mood. Bascinet's words, verbatim. Exported because two surfaces
// say it — this panel and the Mood tile in the band — and it was written down
// twice once already.
export const MOOD_DETAIL =
  "Certain things, like spending time in the wilderness without the Rough Camper trait or receiving wounds harm " +
  "your mood. Other things, like listening to music, fulfilling desires, or eating meals boost your mood. Your " +
  "Mood impacts your Gambit rolls.";

// The mood dial as the whole ladder, on the right column of the sheet: one cell
// per band from Panicking to Ecstatic with the one you are in lit, every band's
// word under it with yours picked out, and then the sentence saying what moves
// it.
//
// The band's tile in the band above (LedgerBand.js) says the one word and the
// figure. This says where that word sits among the others, which is the thing a
// player cannot work out from a single word: "Uncomfortable" means nothing until
// you can see there are four worse states below it and five better ones above.
//
// The count comes from MOOD_BANDS, not from a number written here — the table in
// db/lib/mood.js is the only thing that says how many bands there are, and it
// currently says ten (REDESIGN.md and the mockup both say nine; the table wins,
// and drawing it from the table means it keeps winning).
//
// No narrative paragraph here (Bascinet, 2026-09-18: "Mood narrative: cut").
// There is no per-character mood explanation in the data — nothing records
// why somebody's mood is where it is — so printing Bascinet's own generic
// paragraph here read as though it were the mockup's per-character reason.
// That paragraph still exists, one press away, as the band's Mood tile's
// on-demand detail ("press for why", LedgerBand.js) — a different affordance,
// shown only when asked for — under the same MOOD_DETAIL export below.
//
// The run of ten band names under the bar is gone too, same day, same voice
// ("the bar is good but we don't need to show all the text"): the segmented
// bar with the current band lit, plus the word and score already in the
// header pill, is the whole panel now.
export default function MoodPanel({ mood = 0 }) {
  const here = bandOf(mood);
  const signed = `${mood > 0 ? "+" : mood < 0 ? "−" : "±"}${Math.abs(mood)}`;

  return (
    <section className="panel p-3">
      <h2 className="panel-header">
        Mood
        <span className="note status-pill" data-tone={here?.tone ?? "muted"}>
          {here?.label ?? "Fine"} · {signed}
        </span>
      </h2>

      {/* Decoration — the current band's own word and score are already in
          the header pill above, so this carries no accessible name of its
          own; it is the lit position among the others that matters. */}
      <div className="mood-scale" aria-hidden="true">
        {MOOD_BANDS.map((band) => (
          <i
            key={band.key}
            data-tone={band.tone === "muted" ? undefined : band.tone}
            data-here={band.key === here?.key ? "true" : undefined}
          />
        ))}
      </div>
    </section>
  );
}
