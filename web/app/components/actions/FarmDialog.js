"use client";

import { useState } from "react";
import StackPicker from "../StackRow";
import ActionDialog from "./ActionDialog";
import useRoster from "./useRoster";
import useSubmit from "./useSubmit";
import { useActionPools } from "./poolsContext";
import { farmRequest } from "@/app/(app)/character/requestActions";
// Safe from a client component: db/lib/soilery.js is a leaf module with zero
// Prisma requires, the same posture PackageDialog.js relies on for
// db/lib/constants.js.
import { sowableCrops, FARM_MAX_CROPS } from "@lifeweb/db/lib/soilery";

// The Farms placeholder's Sow button (db/lib/soilery.js — read its header
// first, it's the whole rulebook this dialog fills out). Modeled on
// PackageDialog.js rather than the single/double-slot IngredientSlots.js:
// up to seven crop rows, each 0-FARM_MAX_CROPS, summing to the same cap.
//
// db/lib/soilery.js#CROPS carries no display name for a crop (only the
// sowing-ticket slug and the crop slug) — a crop tag itself is never
// craftable/purchasable, so it never reaches the client tag catalog either.
// Its name is derived from the slug instead, the same "slug is the name,
// slugified" rule docs/tags.yaml already leans on for these exact tags
// (see the Soilery comment there): "plump-helmet" -> "Plump Helmet".
function cropName(slug) {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function FarmDialog({ onDone, onClose }) {
  const pools = useActionPools();
  // GM-tunable on /gm/dev (GameConfig.farmMaxCrops), resolved server-side in
  // character/page.js. FARM_MAX_CROPS is only the client-side fallback if
  // that prop is somehow absent, same posture as db/lib/carry.js's `?? 71`.
  const maxCrops = pools.farmMaxCrops ?? FARM_MAX_CROPS;
  // Fresh pockets rather than the page's own snapshot, the same posture every
  // sibling dialog takes (PackageDialog.js, ConsumeDialog.js, ...): the seed
  // paints instantly, the request re-reads the moment the dialog opens.
  const { roster } = useRoster(["self"], { seed: { self: { characterTags: pools.characterTags ?? [] } } });
  const licensed = sowableCrops(roster?.self?.characterTags ?? []);
  const [picks, setPicks] = useState({});
  const { submit, busy, error } = useSubmit();

  const rows = licensed.map((entry) => ({
    id: entry.crop,
    name: cropName(entry.crop),
    // `held: 1` keeps StackRow's ×N suffix off the name — there is no "how
    // many you're holding" here, only the per-crop sowing cap.
    held: 1,
    max: maxCrops,
  }));

  const lines = Object.entries(picks)
    .map(([crop, value]) => ({ crop, planted: Number(value) || 0 }))
    .filter((line) => line.planted > 0);
  const total = lines.reduce((sum, line) => sum + line.planted, 0);
  const overCap = total > maxCrops;

  return (
    <ActionDialog
      title="Farm"
      submitLabel="Sow"
      width="wide"
      busy={busy}
      error={error}
      empty={rows.length === 0 ? "You have no seed to sow. Open a seed bag first." : null}
      canSubmit={total > 0 && !overCap}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => farmRequest({ lines }),
          (res) => onDone(res?.line ?? "You sowed the fields."),
        )
      }
    >
      <span className="field-label">What do you sow?</span>
      <StackPicker rows={rows} picks={picks} onChange={setPicks} />
      <p className={overCap ? "text-sm text-accent" : "text-xs text-muted"}>
        {`${total} / ${maxCrops} seeds. `}
        {overCap ? `A farm holds at most ${maxCrops} crops at once.` : null}
      </p>
      <p className="text-xs text-muted">
        Sowing takes the whole day, and the crop comes in when the day turns.
      </p>
    </ActionDialog>
  );
}
