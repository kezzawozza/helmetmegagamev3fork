// One end of a movement of things or ⬢: a person or Room stash here, as the "character:<id>" / "room:<id>" keys
// resolveParty() parses server-side. Players are flat and alphabetical. `kind: "hood"` writes "hood:<token>" for a concealed person (db/lib/whosHere.js#hoodToken).
// `rooms` — Room stashes at the character's Location (docs/systemdocs/CARRY.md).
import Select from "./Select";

export default function PartySelect({ label, value, onChange, characters, rooms, hint, selfId = null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          {hint}
        </option>
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
