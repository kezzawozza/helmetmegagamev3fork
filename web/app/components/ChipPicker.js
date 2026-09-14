"use client";

// A single choice from a short list, drawn as chips rather than a <select>. Only for SHORT,
// LOCAL lists — two hundred chips is worse than a dropdown. `options` is [{ id, label,
// note?, disabled?, reason?, active? }]. `active` overrides the usual "is this THE value"
// test, letting a caller with more than one live answer borrow this row (IngredientSlots.js).

export default function ChipPicker({
  label = null,
  options,
  value,
  onChange,
  emptyLabel = "Nothing to choose from.",
  disabled = false,
}) {
  return (
    <div className="field">
      {label ? <span className="field-label">{label}</span> : null}
      {options.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="chip-row" role="group" aria-label={typeof label === "string" ? label : undefined}>
          {options.map((o) => {
            const active = o.active ?? o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                className="chip"
                data-active={active ? "true" : undefined}
                aria-pressed={active}
                disabled={disabled || o.disabled}
                title={o.disabled && o.reason ? o.reason : undefined}
                onClick={() => onChange(active ? "" : o.id)}
              >
                {o.label}
                {o.note ? <span className="chip-note">{o.note}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
