import { GROUPS, fieldsInGroup } from "@lifeweb/db/lib/gameConfigFields";
import { updateGameConfig } from "@/app/(app)/gm/dev/actions";
import SubmitButton from "@/app/components/SubmitButton";
import Switch from "@/app/components/Switch";
import InfoIcon from "@/app/components/InfoIcon";
import Select from "@/app/components/Select";

// The Configuration section, rendered from the registry rather than written
// by hand — see db/lib/gameConfigFields.js for why. A plain server component:
// one <form action>, batch submit, same posture as the Turn and Depot
// sections.
function NumberField({ field, value }) {
  const id = `config-${field.key}`;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {field.label}
      </label>
      <input
        type="number"
        id={id}
        name={field.key}
        min={field.min}
        max={field.max}
        step={field.step ?? (field.type === "float" ? "any" : 1)}
        defaultValue={value}
      />
    </div>
  );
}

function StringField({ field, value }) {
  const id = `config-${field.key}`;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {field.label}
        {field.info ? <InfoIcon text={field.info} /> : null}
      </label>
      <input type="text" id={id} name={field.key} defaultValue={value ?? field.default} />
    </div>
  );
}

// Inside `.field`, never a bare <select> — one outside it visibly breaks the theme (DESIGN-SYSTEM.md).
function SelectField({ field, value }) {
  const id = `config-${field.key}`;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {field.label}
        {field.info ? <InfoIcon text={field.info} /> : null}
      </label>
      <Select id={id} name={field.key} defaultValue={String(value ?? field.default)}>
        {field.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function BoolField({ field, value }) {
  return (
    <div className="ops-toggle">
      <div className="flex flex-1 min-w-0 flex-col gap-1">
        <Switch name={field.key} defaultChecked={Boolean(value)}>
          {field.label}
          {field.info ? <InfoIcon text={field.info} /> : null}
        </Switch>
      </div>
    </div>
  );
}

// `only` / `exclude` scope which registry groups this form renders — the Turn
// clock group is shown in the Turn section, the rest in Configuration. The
// rendered groups are posted as `__configGroups` so the parser reads only these
// fields and leaves every other column alone. No props = every group, unchanged.
export default function ConfigForm({ config, only = null, exclude = [], groupHeadings = true }) {
  const groups = GROUPS.filter((g) => {
    if (only && !only.includes(g.key)) return false;
    if (exclude.includes(g.key)) return false;
    return fieldsInGroup(g.key).length > 0;
  });
  return (
    <form action={updateGameConfig} className="flex flex-col gap-6">
      <input type="hidden" name="__configGroups" value={groups.map((g) => g.key).join(",")} />
      {groups.map((group) => {
        const fields = fieldsInGroup(group.key);
        if (fields.length === 0) return null;
        const numbers = fields.filter(
          (f) => f.type !== "bool" && f.type !== "string" && f.type !== "select",
        );
        const strings = fields.filter((f) => f.type === "string");
        const selects = fields.filter((f) => f.type === "select");
        const bools = fields.filter((f) => f.type === "bool");
        return (
          <section key={group.key} className="flex flex-col gap-3">
            {groupHeadings ? <h3 className="panel-header">{group.name}</h3> : null}
            {numbers.length ? (
              <div className="ops-grid">
                {numbers.map((field) => (
                  <NumberField key={field.key} field={field} value={config[field.key]} />
                ))}
              </div>
            ) : null}
            {strings.length ? (
              <div className="ops-grid">
                {strings.map((field) => (
                  <StringField key={field.key} field={field} value={config[field.key]} />
                ))}
              </div>
            ) : null}
            {selects.length ? (
              <div className="ops-grid">
                {selects.map((field) => (
                  <SelectField key={field.key} field={field} value={config[field.key]} />
                ))}
              </div>
            ) : null}
            {bools.length ? (
              <div className="ops-toggles">
                {bools.map((field) => (
                  <BoolField key={field.key} field={field} value={config[field.key]} />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      <div className="ops-actions">
        <SubmitButton pendingLabel="Saving…">Save config</SubmitButton>
      </div>
    </form>
  );
}
