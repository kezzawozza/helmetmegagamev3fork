const cron = require("node-cron");
const { ActivityType, Events } = require("discord.js");
const { prisma, resumeTurnSideEffects } = require("@lifeweb/db");
const {
  getInvalidResponseStats,
  loadBreakerState,
  recordInvalidResponse,
} = require("@lifeweb/db/lib/discordRest");
const { syncDiscordAccountsForGuild } = require("../lib/discordAccountSync");
const { tickTurnClock, tickSessionClock } = require("../lib/sessionClock");
const { ensureTurnsConsole } = require("../lib/turnsConsole");
const { refreshLocationChannels } = require("../lib/channels");
const { startFeedOutbox } = require("../lib/feedOutbox");
const { runWhisperPoll } = require("../lib/whisperPoll");
const { runLobbySweep } = require("@lifeweb/db/lib/lobbySweep");
const { runRiteSweep } = require("@lifeweb/db/lib/riteSweep");
const { runOracleAtCutoff } = require("@lifeweb/db/lib/oracleCutoff");
const { runGambitCutoff } = require("@lifeweb/db/lib/gambitCutoff");
const { runStagePlay } = require("../lib/stagePlay");
const { getGameState } = require("@lifeweb/db/lib/gameState");
const { startDeathSmell } = require("../lib/deathSmell");
const { registerCommands } = require("../lib/commands");
const { catchUpMissedMessages } = require("../lib/messageCatchUp");

// Vars this process reads behind a truthiness guard — a missing one is a feature silently OFF,
// with nothing in the log to say so. DATABASE_URL and DISCORD_TOKEN are absent on purpose: without
// either, this line is never reached at all.
const REQUIRED_ENV = [
  ["DISCORD_GUILD_ID", "every REST call"],
  ["DISCORD_CLIENT_ID", "the doctor's check that no zone role outranks the bot"],
  ["DISCORD_GM_ROLE_ID", "the standing GM seat — the gate narrows to Trial GMs"],
  ["DISCORD_TURN_PING_ROLE_ID", "the turn ping"],
  ["WEB_BASE_URL", "every link the bot writes into a DM"],
  ["AUTH_SECRET", "the hood tokens behind Who's here?"],
  ["VAPID_PUBLIC_KEY", "web push from the bot"],
  ["VAPID_PRIVATE_KEY", "web push from the bot"],
  ["VAPID_SUBJECT", "web push from the bot"],
];

// Printed, never thrown: guard() in bot/src/index.js would abort the whole ready chain over a missing turn-ping role.
function reportMissingEnv() {
  const missing = REQUIRED_ENV.filter(([name]) => !process.env[name]);
  if (missing.length === 0) return;
  console.error(
    `Missing env on the bot — these are silently OFF:\n` +
      missing.map(([name, what]) => `  ${name} — ${what}`).join("\n"),
  );
}

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    // Awaited before the listener below: recordInvalidResponse's fire-and-forget load marks itself
    // done the moment it starts, so a response arriving first would leave this returning empty-handed.
    await loadBreakerState();

    reportMissingEnv();

    // discord.js runs its own REST manager, invisible to the breaker, which only ever saw
    // db/lib/discordRest.js's traffic — both share one egress IP and Cloudflare counter.
    // discord.js clones the Response when anything listens on this event (a real per-request cost,
    // paid deliberately) — only the status is read, never the body.
    client.rest.on("response", (request, response) => {
      const status = response?.status;
      if (status === 401 || status === 403 || status === 429) {
        recordInvalidResponse(status, request?.path ?? request?.route ?? "unknown");
      }
    });

    // Printed on every connect so a climbing count is visible before it becomes a Cloudflare IP
    // ban. Non-zero right after startup means the previous process died mid-burst (db/lib/discordRest.js).
    const restStats = getInvalidResponseStats();
    console.log(
      `Discord REST health: ${restStats.invalidInWindow}/${restStats.limit} invalid responses in the last 10m` +
        (restStats.breakerOpen ? ` — BREAKER OPEN until ${restStats.breakerOpenUntil}` : ""),
    );

    client.user.setPresence({
      // No markdown, no links in a custom status, so the Handbook is a bare URL players can type.
      activities: [
        {
          name: "status",
          type: ActivityType.Custom,
          state: "#questions | ravenheart.quest/handbook",
        },
      ],
      status: "online",
    });

    await prisma.gameConfig
      .upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
      })
      .catch((err) => console.error("Failed to upsert GameConfig:", err));
    await getGameState(prisma).catch((err) => console.error("Failed to upsert GameState:", err)); // brand-new DB starts CLOSED, Game 1

    await refreshLocationChannels().catch((err) => console.error("Failed to refresh location channels:", err));

    // Web feed's Discord half: /chat messages -> Location channel, plus a catch-up sweep for
    // downtime. After refreshLocationChannels so channel ids are current. Never throws.
    await startFeedOutbox().catch((err) => console.error("Failed to start the feed outbox:", err));

    // Cheap reconciliation pass: role membership and structural drift repaired against the DB,
    // safe on every restart (db/lib/channelDoctor.js).
    {
      const { runChannelDoctor } = require("@lifeweb/db/lib/channelDoctor");
      await runChannelDoctor(prisma, { apply: true, scope: "cheap" })
        .then((r) => {
          if (r.findings.length > 0) {
            console.log(`Channel doctor: ${r.findings.length} finding(s), ${r.repaired} repaired.`);
          }
        })
        .catch((err) => console.error("Channel doctor pass failed:", err));
    }

    // Anything the web app enqueued and never drained — an edit saved while
    // Discord was down, or while this process was. The web `after()` is the
    // primary trigger (db/lib/discordMirror/queue.js); this is the backstop.
    {
      const { drainMirrorQueue } = require("@lifeweb/db/lib/discordMirror/queue");
      await drainMirrorQueue(prisma)
        .then((r) => {
          if (r.jobs > 0) console.log(`Mirror queue: ${r.drained}/${r.jobs} job(s) drained.`);
        })
        .catch((err) => console.error("Mirror queue drain failed:", err));
    }

    // The outbox drained once above, before the doctor and the mirror ran. A
    // channel either of them just created (Deadchat on its first day) had no
    // target then, so every web row bound for it was skipped; now it has one.
    // One indexed query when nothing is pending.
    {
      const { drainFeedOutbox } = require("../lib/feedOutbox");
      await drainFeedOutbox().catch((err) => console.error("Feed outbox re-drain failed:", err));
    }

    // Every GM's zone view, materialized as "GM: <Zone>" roles — seats a brand new GM (no rows
    // means every zone) and repairs a failed grant or a rejoin (db/lib/gmZoneRoles.js).
    {
      const { syncAllGmZoneRoles } = require("@lifeweb/db/lib/gmZoneRoles");
      const { hasGmRole } = require("@lifeweb/db/lib/roleIds");
      const { listGuildMembers } = require("@lifeweb/db/lib/discordRest");
      await listGuildMembers()
        .then((members) =>
          syncAllGmZoneRoles(
            prisma,
            members.filter((m) => hasGmRole(m.roles)).map((m) => m.user.id),
          ),
        )
        .then((touched) => {
          if (touched > 0) console.log(`GM zone views: ${touched} gamemaster(s) re-seated.`);
        })
        .catch((err) => console.error("GM zone view pass failed:", err));
    }

    for (const guild of client.guilds.cache.values()) {
      await syncDiscordAccountsForGuild(guild);
      // guildMemberRemove only fires while the gateway is up, so this diff against live membership
      // is the only thing that catches a player who left during a restart. See leaveReconcile.js
      // for the mass-flag safety rail.
      {
        const { reconcileDepartures } = require("../lib/leaveReconcile");
        await reconcileDepartures(client, guild).catch((err) =>
          console.error("Leave reconcile failed:", err),
        );
      }
      await ensureTurnsConsole(guild).catch((err) => console.error("Failed to ensure turns console:", err));
      // Warms client.channels.cache with every active thread, private ones included — GUILD_CREATE
      // only ships threads the bot already belongs to, so without this a reaction on one never
      // fires messageReactionAdd. A thread created after boot still needs its per-reaction fallback.
      await guild.channels.fetchActiveThreads().catch((err) => console.error("Failed to warm thread cache:", err));
    }

    await registerCommands(client).catch((err) => console.error("Failed to register slash commands:", err)); // bot/src/lib/commands.js

    // Anything typed while we were not listening. Backgrounded — walks every active thread, and a
    // slow sweep must never hold up an interaction. Resolved here since the for-of `guild` above is out of scope.
    const homeGuild =
      client.guilds.cache.get(process.env.DISCORD_GUILD_ID) ?? client.guilds.cache.first() ?? null;
    if (homeGuild) {
      void catchUpMissedMessages(client, homeGuild, { reason: "startup" }).catch((err) =>
        console.error("Message catch-up failed:", err),
      );

      // And again on every FRESH session. shardReady fires before ready on the first connect, so
      // every one seen here is a RE-identify — the case that loses messages (a RESUME replays
      // dispatches; an IDENTIFY's are gone for good). Just this pass, not the whole burst above —
      // catchUpMissedMessages holds its own single-flight guard.
      client.on(Events.ShardReady, (shardId) => {
        console.log(`Shard ${shardId} re-identified; checking for messages missed while it was away.`);
        void catchUpMissedMessages(client, homeGuild, { reason: "reconnect" }).catch((err) =>
          console.error("Message catch-up failed after reconnect:", err),
        );
      });
    }

    // The web app closes a turn and fans out to Discord from a deferred after() callback, which a
    // redeploy can kill halfway. The bot coming back up is the earliest signal a process just
    // died, so finishing an unsaid turn is a catch-up pass — idempotent and leased.
    void resumeTurnSideEffects(prisma).catch((err) =>
      console.error("Resuming an unfinished turn's side effects failed:", err),
    );

    // THE TURN CLOCK, and the session clock beside it. Both per-minute polls rather than a schedule, because there is no
    // single schedule left to write: a turn is 6, 8, 12 or 24 hours (GameConfig.turnLengthHours), a GM may change that
    // mid-game, and a session opens on whatever minute one was scheduled for. `cron.schedule("0 0 * * *")` could say none
    // of that. Polling also heals a missed tick within a minute instead of at the next midnight.
    //
    // Both are cheap when idle — one indexed read each — and both refuse to do anything while the clock is frozen, so a
    // game in the lobby, paused, or between sittings costs two queries a minute and nothing else. The advance itself is
    // still claimed by the conditional updateMany in db/index.js, which is what arbitrates this poll against a GM's End
    // turn; a 60-second tick makes that race ordinary rather than rare, which is why the claim was built first.
    let turnClockRunning = false;
    cron.schedule("* * * * *", () => {
      if (turnClockRunning) return;
      turnClockRunning = true;
      tickTurnClock()
        .then((turn) => {
          if (turn) console.log(`Turn advanced to #${turn.number} (day ${turn.dayNumber})`);
        })
        .catch((err) => console.error("Failed to advance turn:", err))
        .finally(() => {
          turnClockRunning = false;
        });
    });

    let sessionClockRunning = false;
    cron.schedule("* * * * *", () => {
      if (sessionClockRunning) return;
      sessionClockRunning = true;
      tickSessionClock()
        .then((change) => {
          if (change) console.log(`Session ${change === "OPEN" ? "opened" : "closed"} on schedule.`);
        })
        .catch((err) => console.error("Session clock failed:", err))
        .finally(() => {
          sessionClockRunning = false;
        });
    });

    // Every Room hears who's been whispering nearby, aliased, on a stateless 15-minute lookback
    // (bot/src/lib/whisperPoll.js).
    // A rotten body nags its Location on a randomized 4-10 hour timer — unpredictability is the
    // feature, self-rescheduling (bot/src/lib/deathSmell.js).
    startDeathSmell(prisma);

    // Thanati rites fire two minutes after their last requirement lands, expire twelve hours after
    // their first chant (db/lib/riteSweep.js). Every minute so "two minutes" stays close to true.
    // One sweep in flight at a time: Summoning walks every cultist through Discord.
    let riteSweepRunning = false;
    cron.schedule("* * * * *", () => {
      if (riteSweepRunning) return;
      riteSweepRunning = true;
      runRiteSweep(prisma)
        .then(({ expired, fired }) => {
          if (expired || fired) console.log(`Rite sweep: ${fired} fired, ${expired} expired.`);
        })
        .catch((err) => console.error("Rite sweep failed:", err))
        .finally(() => {
          riteSweepRunning = false;
        });
    });

    // The Oracle, once a turn, a couple minutes after the Move cutoff (db/lib/oracleCutoff.js).
    // Every minute, not a fixed hour: the cutoff derives from the turn's own startedAt, and ticking
    // makes it self-healing if the bot was down at cutoff. Cheap on every tick but one a day.
    // One run in flight at a time — seven model calls can outlast a minute several times over.
    let oracleRunning = false;
    cron.schedule("* * * * *", () => {
      if (oracleRunning) return;
      oracleRunning = true;
      runOracleAtCutoff(prisma)
        .then(({ ran, phase, turnNumber, zones }) => {
          if (ran) console.log(`Oracle: turn #${turnNumber} phase ${phase} across ${zones} zones.`);
        })
        .catch((err) => console.error("Oracle cutoff check failed:", err))
        .finally(() => {
          oracleRunning = false;
        });
    });

    // Every player Gambit gets its Hunger/mood modifier the moment Moves lock
    // (db/lib/gambitCutoff.js) — the die itself was thrown back at submit. Every minute for the same
    // reason as the Oracle above: the cutoff derives from the turn's own startedAt, and ticking makes
    // it self-healing if the bot was down when the window shut. Settling is what makes a Gambit
    // final, so until this fires a player may still rewrite or withdraw one — which costs them
    // nothing and gains them nothing, since the die does not change. Cheap on every tick but one a
    // day, and the staged push settles anything this missed.
    let gambitCutoffRunning = false;
    cron.schedule("* * * * *", () => {
      if (gambitCutoffRunning) return;
      gambitCutoffRunning = true;
      runGambitCutoff(prisma)
        .then(({ ran, settled, turnNumber }) => {
          if (ran && settled) console.log(`Gambit cutoff: settled ${settled} Moves for turn #${turnNumber}.`);
        })
        .catch((err) => console.error("Gambit cutoff check failed:", err))
        .finally(() => {
          gambitCutoffRunning = false;
        });
    });

    // Makeshift Stage, four times a day (bot/src/lib/stagePlay.js). Hours offset off midnight, and off 6/8/12/24's other
    // boundaries as far as any four hours can be, so it does not land on the same minute as a turn advance. One sweep in
    // flight at a time.
    let stagePlayRunning = false;
    cron.schedule(
      "0 3,9,15,21 * * *",
      () => {
        if (stagePlayRunning) return;
        stagePlayRunning = true;
        runStagePlay(prisma)
          .then(({ played, soothed }) => {
            if (played || soothed) console.log(`Stage sweep: ${played} playing, ${soothed} cheered.`);
          })
          .catch((err) => console.error("Stage sweep failed:", err))
          .finally(() => {
            stagePlayRunning = false;
          });
      },
      { timezone: "America/Chicago" },
    );

    cron.schedule("*/15 * * * *", () => {
      runWhisperPoll(prisma)
        .then((posted) => {
          if (posted > 0) console.log(`Whisper poll: ${posted} room(s) told.`);
        })
        .catch((err) => console.error("Whisper poll failed:", err));
      runLobbySweep(prisma) // creation window's reminders and expiries (db/lib/lobbySweep.js)
        .then(({ resent, reminded, expired }) => {
          if (resent || reminded || expired) console.log(`Lobby sweep: ${resent} resent, ${reminded} reminded, ${expired} expired.`);
        })
        .catch((err) => console.error("Lobby sweep failed:", err));
    });
  },
};
