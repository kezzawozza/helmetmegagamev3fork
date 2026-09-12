// The routing tables for player actions: which verbs run on the click with
// no dialog, and (as the dialogs migrate here) which component draws each
// mode. RequestActionsProvider.js reads both.

import { recallComrades, recoverEquipment } from "@/app/(app)/character/thanatiActions";
import { readPointer, armNuke, disarmNuke } from "@/app/(app)/character/nukeActions";
import { checkWanted } from "@/app/(app)/character/cerberonActions";
import { extractGodfleshRequest, healCharacterRequest } from "@/app/(app)/character/requestActions";
import { formatMoveFraction } from "@/lib/craftBudget";
import BindDialog, { BIND_VERBS } from "./BindDialog";
import HarmDialog from "./HarmDialog";
import MutilateDialog from "./MutilateDialog";
import BodyDialog from "./BodyDialog";
import EngraveDialog from "./EngraveDialog";
import WarrantDialog from "./WarrantDialog";
import InterceptDialog from "./InterceptDialog";
import AttackDialog from "./AttackDialog";
import DisguiseDialog from "./DisguiseDialog";
import ConsumeDialog from "./ConsumeDialog";
import PoisonDialog from "./PoisonDialog";
import HideoutDialog from "./HideoutDialog";
import MoveThingsDialog from "./MoveThingsDialog";
import DestroyDialog from "./DestroyDialog";
import PackageDialog from "./PackageDialog";
import PurchaseDialog from "./PurchaseDialog";
import HealDialog from "./HealDialog";
import LessonDialog from "./LessonDialog";
import KissDialog from "./KissDialog";
import TaxDialog from "./TaxDialog";
import WriteDialog from "./WriteDialog";
import SealDialog from "./SealDialog";
import BirdDialog from "./BirdDialog";
import WhisperDialog from "./WhisperDialog";
import StepstoneDialog from "./StepstoneDialog";
import ExamineAction from "./ExamineAction";
import CraftAction from "./CraftAction";
import ResearchAction from "./ResearchAction";

// Instant verbs. Each is `{ run, confirm }`: `run()` is the server action,
// `confirm(pools)` is the one-line question to ask first, or null for none.
// The rule for which get a question: anything that spends the Move or is
// destructive asks; a free read (Recall, the pointer) or an undo (Disarm)
// does not. The result comes back as a notice (NoticeProvider.js), never a
// dialog — these used to open an empty RequestDialog whose only field was
// the Confirm button.
const RECOVER_NAMES = { "black-robes": "the robes", "thanati-mask": "the mask" };

export const INSTANT = {
  recall: { run: () => recallComrades(), confirm: () => null },
  // A free read, like Recall and the pointer — nothing to ask first.
  wantedlist: { run: () => checkWanted(), confirm: () => null },
  recover: {
    run: () => recoverEquipment(),
    confirm: (pools) => {
      const missing = (pools?.recoverMissing ?? []).map((s) => RECOVER_NAMES[s]).filter(Boolean);
      return {
        title: "Recover your things?",
        message: `${missing.length ? `You get ${missing.join(" and ")} back.` : "You get them back."} It takes your Move for the turn.`,
        confirmLabel: "Recover",
      };
    },
  },
  pointer: { run: () => readPointer(), confirm: () => null },
  arm: {
    run: () => armNuke(),
    confirm: () => ({
      title: "Arm the device?",
      message:
        "The card goes in and the count begins. It detonates at the close of the turn after next, and everyone who is not underground when it does will die — you included, unless you are. You can still take the card out before then.",
      confirmLabel: "Arm it",
    }),
  },
  disarm: { run: () => disarmNuke(), confirm: () => null },
  extract: {
    run: () => extractGodfleshRequest(),
    confirm: () => ({
      title: "Cut Godflesh?",
      message:
        "You wade out and cut. Once a day, and it costs you no turn. It rolls 1d6: a 6 pays extra, and a 1 means it grabbed hold of you first.",
      confirmLabel: "Cut",
    }),
  },
};

// Mode → dialog component. Filled in as the dialogs move out of the provider;
// a mode not listed here is still drawn by the provider's own inline block.
export const DIALOGS = {
  bind: BindDialog,
  free: BindDialog,
  crucify: BindDialog,
  torture: BindDialog,
  harm: HarmDialog,
  mutilate: MutilateDialog,
  bury: BodyDialog,
  butcher: BodyDialog,
  engrave: EngraveDialog,
  warrant: WarrantDialog,
  intercept: InterceptDialog,
  attack: AttackDialog,
  disguise: DisguiseDialog,
  consume: ConsumeDialog,
  poison: PoisonDialog,
  hideout: HideoutDialog,
  transfer: MoveThingsDialog,
  loot: MoveThingsDialog,
  destroy: DestroyDialog,
  package: PackageDialog,
  purchase: PurchaseDialog,
  heal: HealDialog,
  learn: LessonDialog,
  teach: LessonDialog,
  confess: LessonDialog,
  kiss: KissDialog,
  tax: TaxDialog,
  write: WriteDialog,
  seal: SealDialog,
  bird: BirdDialog,
  whisper: WhisperDialog,
  stepstone: StepstoneDialog,
  examine: ExamineAction,
  craft: CraftAction,
  research: ResearchAction,
};

// The shortcut past the picker. When a dialog is opened with the one thing it
// would have asked for already decided — Bind from Ada's own row in the HERE
// list — there is nothing left to pick, so the one question is asked straight
// away and the verb runs. Each returns `{ ask, run, ctx }` or null to fall
// through to the dialog. The name comes off the page's own roster; a preset
// for someone not on it (a stale page) falls through rather than guessing.
function bindShortcut(mode) {
  return (seed, bag) => {
    if (!seed?.targetId) return null;
    const target = (bag?.bindTargets ?? []).find((t) => t.id === seed.targetId);
    if (!target || !BIND_VERBS[mode].fit(target)) return null;
    const verb = BIND_VERBS[mode];
    return { ask: verb.confirm(target.name), run: () => verb.run(target.id), ctx: { name: target.name } };
  };
}

export const FAST_PATHS = {
  bind: bindShortcut("bind"),
  free: bindShortcut("free"),
  torture: bindShortcut("torture"),
  crucify: bindShortcut("crucify"),
  // Heal, when the patient has exactly one thing wrong and you are paying:
  // the dialog would have had one chip lit and one payer, which is no dialog.
  heal: (seed, bag) => {
    if (!seed?.patientId || !bag?.selfId) return null;
    const patient = (bag.healTargets ?? []).find((t) => t.id === seed.patientId);
    if (!patient || (patient.healable ?? []).length !== 1) return null;
    const affliction = patient.healable[0];
    const self = patient.id === bag.selfId;
    // What this confirm is about to quote as costing the Move — the same
    // reading HealDialog.js makes, off `moveCost` (web/lib/peoplePools.js).
    // It has to be BOTH the sentence below and `billedSeen`: the server
    // refuses outright when it would bill a Move the player was not shown
    // paying (requestActions.js#healCharacterRequestImpl, review fix M2),
    // so a shortcut that quotes a price without acknowledging it can never
    // succeed for anything above the free rung.
    const billed = !affliction.gambit && affliction.moveCost?.kind !== "free";
    return {
      ask: {
        title: self ? `Treat your ${affliction.tagName}?` : `Treat ${patient.name}'s ${affliction.tagName}?`,
        message: `Costs ${affliction.cost ?? 0} ⬢, paid by you.${
          affliction.gambit
            ? " This is a Gambit."
            : billed
              ? ` This costs ${affliction.moveCost?.num === affliction.moveCost?.den ? "your whole Move" : `${formatMoveFraction(affliction.moveCost?.num, affliction.moveCost?.den)} of your Move`}${affliction.moveCost?.kind === "spill" ? ", past this turn's free first aid" : ""}.`
              : ` First aid doesn't cost a Move — ${bag.healsLeft === 1 ? "1 free treatment" : `${bag.healsLeft ?? "a few"} free treatments`} left this turn.`
        }`,
        confirmLabel: "Treat",
      },
      run: () =>
        healCharacterRequest({
          targetCharacterId: patient.id,
          tagId: affliction.tagId,
          payerKey: `character:${bag.selfId}`,
          billedSeen: String(billed ? 1 : 0),
        }),
      ctx: { name: self ? "You" : patient.name, self },
    };
  },
};
