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
// `detail` is the sentence, and it is passed in rather than written twice:
// LedgerBand.js's Mood tile opens the same paragraph, which is Bascinet's own
// words. There is no per-character mood explanation in the data — nothing
// records why somebody's mood is where it is — so this is the closest real
// thing to the mockup's written-out reason.
export default function MoodPanel({ mood = 0, detail = null }) {
  const here = bandOf(mood);
  const signed = `${mood > 0 ? "+" : mood < 0 ? "−" : "±"}${Math.abs(mood)}`;

  return (
    <section className="panel p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-header">Mood</h2>
        <span className="status-pill" data-tone={here?.tone ?? "muted"}>
          {here?.label ?? "Fine"} · {signed}
        </span>
      </div>

      {/* Decoration for the words below it, so it says nothing to a screen
          reader — the run of band names carries the same information in text. */}
      <div className="mood-scale" aria-hidden="true">
        {MOOD_BANDS.map((band) => (
          <i
            key={band.key}
            data-tone={band.tone === "muted" ? undefined : band.tone}
            data-here={band.key === here?.key ? "true" : undefined}
          />
        ))}
      </div>

      <p className="mood-names m-0">
        {MOOD_BANDS.map((band, i) => (
          <span key={band.key}>
            {i > 0 && " · "}
            {band.key === here?.key ? (
              <b data-tone={band.tone === "muted" ? undefined : band.tone}>{band.label}</b>
            ) : (
              band.label
            )}
          </span>
        ))}
      </p>

      {detail && <p className="text-muted m-0 mt-2 text-sm">{detail}</p>}
    </section>
  );
}
