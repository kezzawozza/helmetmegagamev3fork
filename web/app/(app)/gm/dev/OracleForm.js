"use client";

// The Oracle's settings, at /gm/dev?s=oracle. See docs/systemdocs/ORACLE.md.
//
// A client component rather than the plain <form action> the other sections
// use, because two of its controls answer back: Test connection and Run now
// both report a result in place, and a GM pressing either wants to know what
// happened without hunting for it in a log.

import { useState, useTransition } from "react";
import Switch from "@/app/components/Switch";
import InfoIcon from "@/app/components/InfoIcon";
import { saveOracleSettings, clearOracleApiKey, testOracleConnection, runOracleNow } from "./oracleActions";
import { useConfirm } from "@/app/components/ConfirmProvider";

export default function OracleForm({ settings }) {
  const confirm = useConfirm();
  const [saving, startSave] = useTransition();
  const [busy, startBusy] = useTransition();
  const [note, setNote] = useState(null);
  const [replacingKey, setReplacingKey] = useState(!settings?.hasApiKey);

  if (!settings) return <p className="text-sm text-muted">No configuration row yet.</p>;

  function onSave(formData) {
    startSave(async () => {
      const res = await saveOracleSettings(formData);
      setNote(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
      if (res.ok) setReplacingKey(false);
    });
  }

  function onTest() {
    startBusy(async () => {
      setNote({ ok: true, text: "Testing…" });
      const res = await testOracleConnection();
      setNote(
        res.ok
          ? { ok: true, text: `Answered in ${res.ms}ms.` }
          : { ok: false, text: res.error ?? "The provider did not answer." },
      );
    });
  }

  function onRun() {
    startBusy(async () => {
      // Real money and a few minutes of wall clock, so it asks first.
      if (!(await confirm({ title: "Draft this turn?" }))) return;
      setNote({ ok: true, text: "Drafting…" });
      const res = await runOracleNow();
      setNote(
        res.ok ? { ok: true, text: `Wrote ${res.zones} zones and a front page.` } : { ok: false, text: res.error },
      );
    });
  }

  return (
    <form action={onSave} className="flex flex-col gap-4">
      {/* Two separate questions, so two separate switches: whether a chronicle
          gets written at the Move cutoff, and who is allowed to read one. */}
      <div className="ops-toggle">
        <Switch name="oracleEnabled" defaultChecked={settings.oracleEnabled}>
          Enable
        </Switch>
      </div>

      <div className="ops-toggle">
        <Switch name="oraclePlaytest" defaultChecked={settings.oraclePlaytest}>
          Playtest
          <InfoIcon text="Makes it only visible to superadmins." />
        </Switch>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="oracle-provider">
          Provider
        </label>
        <input id="oracle-provider" name="oracleProvider" defaultValue={settings.oracleProvider} maxLength={60} />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="oracle-base-url">
          Base URL
        </label>
        <input id="oracle-base-url" name="oracleBaseUrl" defaultValue={settings.oracleBaseUrl} maxLength={300} />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="oracle-model">
          Model
        </label>
        <input id="oracle-model" name="oracleModel" defaultValue={settings.oracleModel} maxLength={200} />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="oracle-key">
          API key
        </label>
        {replacingKey ? (
          <input
            id="oracle-key"
            name="oracleApiKey"
            type="password"
            autoComplete="off"
            placeholder="Paste the key"
            maxLength={400}
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="mono text-sm">••••••••••••••••</span>
            <button type="button" className="btn-quiet" onClick={() => setReplacingKey(true)}>
              Replace
            </button>
            <button
              type="button"
              className="btn-quiet"
              onClick={async () => {
                if (await confirm({ title: "Remove the API key?" })) {
                  await clearOracleApiKey();
                  setReplacingKey(true);
                }
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="field">
        <label className="field-label flex items-center gap-1.5" htmlFor="oracle-memory">
          Turns of memory
          <InfoIcon text="Production rows are not rewritten by the migration. An existing install still reads 3 until somebody sets it to 1 here." />
        </label>
        <input
          id="oracle-memory"
          name="oracleMemoryTurns"
          type="number"
          min={0}
          max={10}
          defaultValue={settings.oracleMemoryTurns}
        />
      </div>

      <div className="ops-toggle">
        <Switch name="oracleIncludeChat" defaultChecked={settings.oracleIncludeChat}>
          Include the chat transcript
        </Switch>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="oracle-correspondent">
          Zone writer
        </label>
        <textarea
          id="oracle-correspondent"
          name="correspondentPrompt"
          rows={12}
          maxLength={8000}
          defaultValue={settings.correspondentPrompt}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="oracle-editor">
          Editor
        </label>
        <textarea
          id="oracle-editor"
          name="editorPrompt"
          rows={12}
          maxLength={8000}
          defaultValue={settings.editorPrompt}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="oracle-append">
          Phase two (Declared this turn / Needs a ruling)
        </label>
        <textarea
          id="oracle-append"
          name="appendPrompt"
          rows={12}
          maxLength={8000}
          defaultValue={settings.appendPrompt}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-quiet" onClick={onTest} disabled={busy || !settings.hasApiKey}>
          Test connection
        </button>
        <button type="button" className="btn-quiet" onClick={onRun} disabled={busy || !settings.hasApiKey}>
          Draft this turn
        </button>
        {note ? <span className={note.ok ? "text-sm text-muted" : "text-sm text-danger"}>{note.text}</span> : null}
      </div>
    </form>
  );
}
