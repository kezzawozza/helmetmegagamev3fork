"use server";

import { guarded } from "@/lib/actionResult";
import {
  craftRequestImpl,
  continueCraftImpl,
  cancelCraftImpl,
} from "./actions/crafting.js";
import {
  joinBuildSiteImpl,
  cancelBuildSiteImpl,
} from "./actions/structures.js";
import {
  learnRequestImpl,
  teachRequestImpl,
  confessRequestImpl,
  kissRequestImpl,
  searchRequestImpl,
} from "./actions/offers.js";
import { transferRequestImpl } from "./actions/transfer.js";
import { stealRequestImpl } from "./actions/steal.js";
import { pickpocketRequestImpl, pickpocketTakeImpl } from "./actions/pickpocket.js";
import {
  poisonItemRequestImpl,
  poisonCharacterRequestImpl,
} from "./actions/poison.js";
import { healCharacterRequestImpl, performMiracleRequestImpl } from "./actions/medical.js";
import {
  buryCharacterRequestImpl,
  butcherCorpseRequestImpl,
  mutilateRequestImpl,
  engraveHeadstoneRequestImpl,
} from "./actions/corpse.js";
import {
  destroyTagRequestImpl,
  consumeTagRequestImpl,
  researchRequestImpl,
  claimDesireImpl,
  changeNameRequestImpl,
  lootCharacterRequestImpl,
  bindCharacterRequestImpl,
  freeCharacterRequestImpl,
  breakRestraintsRequestImpl,
  crucifyCharacterRequestImpl,
  shackleCharacterRequestImpl,
  tortureCharacterRequestImpl,
  applyCollarRequestImpl,
  unlockCollarRequestImpl,
  detonateCollarRequestImpl,
  disguiseSelfRequestImpl,
  harmCharacterRequestImpl,
  brandCharacterRequestImpl,
  extractGodfleshRequestImpl,
  packageItemsRequestImpl,
} from "./actions/misc.js";
import { farmRequestImpl } from "./actions/soilery.js";
import { breakInArelitzRequestImpl } from "./actions/arelitz.js";
import { refineRequestImpl } from "./actions/refine.js";
import { mineRequestImpl } from "./actions/mine.js";
import {
  birdMessageRequestImpl,
  birdReplyRequestImpl,
  stepstoneRequestImpl,
  readPointerDeviceImpl,
} from "./actions/misc.js";

// --- public surface ---------------------------------------------------

// Each action is wrapped so validation comes back as { ok: false, error }
// instead of being thrown — see web/lib/actionResult.js.

export async function craftRequest(input) {
  return guarded(() => craftRequestImpl(input));
}

export async function continueCraft(input) {
  return guarded(() => continueCraftImpl(input));
}

export async function cancelCraft(input) {
  return guarded(() => cancelCraftImpl(input));
}

// Opening a site has no export of its own: craftRequest() branches into it,
// because to a player raising a palisade is the same act as making a sword.
export async function joinBuildSite(input) {
  return guarded(() => joinBuildSiteImpl(input));
}

export async function cancelBuildSite(input) {
  return guarded(() => cancelBuildSiteImpl(input));
}

export async function destroyTagRequest(input) {
  return guarded(() => destroyTagRequestImpl(input));
}

export async function learnRequest(input) {
  return guarded(() => learnRequestImpl(input));
}

export async function teachRequest(input) {
  return guarded(() => teachRequestImpl(input));
}

export async function confessRequest(input) {
  return guarded(() => confessRequestImpl(input));
}

export async function kissRequest(input) {
  return guarded(() => kissRequestImpl(input));
}

export async function searchRequest(input) {
  return guarded(() => searchRequestImpl(input));
}

export async function transferRequest(input) {
  return guarded(() => transferRequestImpl(input));
}

// Steal and Pickpocket (docs/systemdocs/THEFT.md). Note that `input` is handed
// straight through, which is why transferRequestImpl takes its announce switch
// as a SECOND argument rather than a field on this object.
export async function stealRequest(input) {
  return guarded(() => stealRequestImpl(input));
}

export async function pickpocketRequest(input) {
  return guarded(() => pickpocketRequestImpl(input));
}

export async function pickpocketTakeRequest(input) {
  return guarded(() => pickpocketTakeImpl(input));
}

export async function consumeTagRequest(input) {
  return guarded(() => consumeTagRequestImpl(input));
}

export async function poisonItemRequest(input) {
  return guarded(() => poisonItemRequestImpl(input));
}

export async function poisonCharacterRequest(input) {
  return guarded(() => poisonCharacterRequestImpl(input));
}

export async function healCharacterRequest(input) {
  return guarded(() => healCharacterRequestImpl(input));
}
export async function performMiracleRequest(input) {
  return guarded(() => performMiracleRequestImpl(input));
}
export async function researchRequest(input) {
  return guarded(() => researchRequestImpl(input));
}

export async function claimDesire(input) {
  return guarded(() => claimDesireImpl(input));
}

export async function changeNameRequest(input) {
  return guarded(() => changeNameRequestImpl(input));
}

export async function lootCharacterRequest(input) {
  return guarded(() => lootCharacterRequestImpl(input));
}

export async function bindCharacterRequest(input) {
  return guarded(() => bindCharacterRequestImpl(input));
}
export async function freeCharacterRequest(input) {
  return guarded(() => freeCharacterRequestImpl(input));
}
export async function breakRestraintsRequest() {
  return guarded(() => breakRestraintsRequestImpl());
}
export async function crucifyCharacterRequest(input) {
  return guarded(() => crucifyCharacterRequestImpl(input));
}
export async function shackleCharacterRequest(input) {
  return guarded(() => shackleCharacterRequestImpl(input));
}
export async function tortureCharacterRequest(input) {
  return guarded(() => tortureCharacterRequestImpl(input));
}
export async function applyCollarRequest(input) {
  return guarded(() => applyCollarRequestImpl(input));
}
export async function unlockCollarRequest(input) {
  return guarded(() => unlockCollarRequestImpl(input));
}
export async function detonateCollarRequest(input) {
  return guarded(() => detonateCollarRequestImpl(input));
}
export async function disguiseSelfRequest(input) {
  return guarded(() => disguiseSelfRequestImpl(input));
}
export async function harmCharacterRequest(input) {
  return guarded(() => harmCharacterRequestImpl(input));
}

export async function brandCharacterRequest(input) {
  return guarded(() => brandCharacterRequestImpl(input));
}

export async function buryCharacterRequest(input) {
  return guarded(() => buryCharacterRequestImpl(input));
}

export async function butcherCorpseRequest(input) {
  return guarded(() => butcherCorpseRequestImpl(input));
}

export async function mutilateRequest(input) {
  return guarded(() => mutilateRequestImpl(input));
}

export async function engraveHeadstoneRequest(input) {
  return guarded(() => engraveHeadstoneRequestImpl(input));
}

export async function extractGodfleshRequest(input) {
  return guarded(() => extractGodfleshRequestImpl(input));
}

export async function farmRequest(input) {
  return guarded(() => farmRequestImpl(input));
}

export async function breakInArelitzRequest(input) {
  return guarded(() => breakInArelitzRequestImpl(input));
}

export async function refineRequest() {
  return guarded(() => refineRequestImpl());
}

export async function mineRequest() {
  return guarded(() => mineRequestImpl());
}

export async function packageItemsRequest(input) {
  return guarded(() => packageItemsRequestImpl(input));
}

export async function birdMessageRequest(input) {
  return guarded(() => birdMessageRequestImpl(input));
}


export async function birdReplyRequest(input) {
  return guarded(() => birdReplyRequestImpl(input));
}

export async function stepstoneRequest(input) {
  return guarded(() => stepstoneRequestImpl(input));
}

export async function readPointerDevice() {
  return guarded(() => readPointerDeviceImpl());
}
