// One end of a movement of things or ⬢: a person or Room stash here, as the "character:<id>" / "room:<id>" keys
// resolveParty() parses server-side. Players are flat/alphabetical, deliberately NOT nested under faction — that
// would leak allegiances. `kind: "hood"` writes "hood:<token>" for a concealed person (db/lib/whosHere.js#hoodToken).
// `rooms` — Room stashes at the character's Location (docs/systemdocs/CARRY.md). `silo` — the character's own
// faction silo when "Rooms here" can't carry it, e.g. the locked mail slot (FACTIONS.md §4a); only ever passed as a
// DESTINATION, since you deposit from across the zone but take things out only by standing in the room.
import Select from "./Select";

export default function PartySelect({ label, value, onChange, characters, rooms, hint, selfId = null, silo = null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          {hint}
        </option>
        {silo ? (
          <optgroup label="Your silo">
            <option value={`room:${silo.id}`}>
              ★ {silo.name}
              {silo.here ? " — locked to you" : ` — ${silo.locationName}`}
            </option>
          </optgroup>
        ) : null}
        {rooms?.length ? (
          <optgroup label="Rooms here">
            {rooms.map((r) => (
              <option key={r.id} value={`room:${r.id}`}>
                {r.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {characters?.length ? (
          <optgroup label="People here">
            {characters.map((c) => (
              <option key={c.id} value={`${c.kind ?? "character"}:${c.id}`}>
                {c.name}
                {selfId && c.id === selfId ? " (you)" : ""}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
    </label>
  );
}
