# Chat, phase by phase

The per-phase build specs for `/chat` (design in [CHAT.md](CHAT.md)). Phases 0–5 shipped 2026-09-06; a phase is deleted from here once CHAT.md describes it. Internal reference, not game text.

## Phases 1–6: the rest (approved 2026-09-06, "just finish the rest")

Sequential Opus workers, one at a time in the main tree (another session holds
uncommitted edits in `db/lib/roomAccess.js`, `channelDoctor.js`, `locationMove.js`
and `bot/src/events/interactionCreate.js`; workers touch those only where a phase
says so, and the orchestrator stages by hunk). Every phase ends with lint, build,
`node --check` on bot/db files, a report, then the orchestrator's review, a
production check, commit, push. Migrations are hand-written SQL; folder names follow
`20260911070000_…` upward. `docs/systemdocs/CHAT.md` is updated by the phase that
changes what it describes. Every player-visible string ends in.

Every phase shipped, 2026-09-06. `CHAT.md` describes the whole of it: the one
write path and the record (§2), conversation membership as a row (§2a),
realtime including presence and typing (§3), the outbox (§4), the page and its
access rules (§5, §5a–c), the "web only" switch (§6a), the Dawn watermark (§7)
and the GM's Scene tab (§8, since removed).

Three things were deferred on purpose rather than dropped. **Web Push** for
mentions needs VAPID keys, a service worker and iOS install guidance, which is
its own change and not a phase of this one. **Attachments** on a web send are
unbuilt — the Discord proxy still carries them, and the row records
placeholders. And a Discord-side "is typing" echo for somebody typing on the
web is not possible: Discord has no API for a bot to type as somebody else.
