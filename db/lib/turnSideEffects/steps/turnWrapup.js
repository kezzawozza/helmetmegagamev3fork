const { postTurnsAnnouncement } = require("../../turnAnnouncement");
const { runMessageWipe } = require("../../messageWipe");

async function wrapUpTurn({ prisma, p, step }, sideEffectsStartedAt) {
  // The banner. The row is re-read rather than carried, so a resumed run in a
  // fresh process announces the turn that actually exists.
  const newTurn = p.newTurnId
    ? await prisma.turn.findUnique({ where: { id: p.newTurnId } }).catch(() => null)
    : null;
  if (newTurn) {
    await step("turnAnnouncement", () =>
      postTurnsAnnouncement(prisma, newTurn, p.note ?? null).catch((err) =>
        console.error("Failed to post turn announcement:", err),
      ),
    );
  }

  // The wipe runs on EVERY turn now. A turn is one real day, and Dawn/Dusk
  // alternate, so the old Dawn gate meant a Room scene ran for 48 hours.
  // Only the zone summaries keep that slower life — CHANNELS.md §8.
  // `messageWipeEnabled` is no longer a GM knob; the column stays as a
  // hand-flippable escape hatch if Discord starts rate-limiting. Read now
  // rather than carried in the payload, so a resume honours the switch as it
  // stands rather than as it stood when the turn closed.
  const config = await prisma.gameConfig
    .findFirst({ select: { messageWipeEnabled: true } })
    .catch(() => null);
  if (config?.messageWipeEnabled && newTurn) {
    const wipeSummaries = newTurn.phase === "DAWN";
    // The web's half of the same wipe, and it goes FIRST: the watermark is
    // the newest row as the pass begins, which is the same instant
    // `cutoffMs` names on the Discord side. Taking it afterwards would put
    // everything said during the wipe below the floor — deleted from
    // Discord's view and hidden from the Hall's, for no reason but that the
    // sweep was slow. See db/lib/feedWipe.js and HALL.md §7.
    const { markFeedWiped } = require("../../feedWipe");
    await step("feedWatermark", () => markFeedWiped(prisma, { summaries: wipeSummaries }));
    await step("messageWipe", () =>
      runMessageWipe(prisma, {
        cutoffMs: sideEffectsStartedAt,
        wipeSummaries,
      }).catch((err) => console.error("Message wipe failed:", err)),
    );
  }

  // The channel doctor's cheap reconcile — roles and membership only, a
  // handful of requests. It used to sit behind autoReconcileEnabled, a
  // switch nobody ever turned on; keeping Discord in step with the database
  // after a turn moves people around is not a thing to opt into.
  const { runChannelDoctor } = require("../../channelDoctor");
  await step("channelDoctor", () =>
    runChannelDoctor(prisma, { apply: true, scope: "cheap" }).catch((err) =>
      console.error("Post-turn channel doctor failed:", err),
    ),
  );

  // Whatever is still queued for Discord — the backstop behind the web app's
  // own drain, so nothing sits pending for longer than a turn.
  const { drainMirrorQueue } = require("../../discordMirror/queue");
  await step("mirrorQueue", () =>
    drainMirrorQueue(prisma).catch((err) => console.error("Post-turn mirror drain failed:", err)),
  );

  // The Oracle is NOT here any more (docs/systemdocs/ORACLE.md). It used to be
  // this thunk's last step, on the argument that a synopsis arriving late costs
  // nothing. True, and beside the point: it is written FOR the gamemasters
  // adjudicating, and they do that in the three hours between the Move cutoff
  // and this push. A chronicle drafted here arrived after the rulings it was
  // meant to inform. It fires at the cutoff now — db/lib/oracleCutoff.js, off
  // the bot's minute cron — so nothing below should call it.
}

module.exports = { wrapUpTurn };
