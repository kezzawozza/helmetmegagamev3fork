"use server";

// The Oracle's settings, and the two buttons beside them. See
// docs/systemdocs/ORACLE.md. Separate from actions.js so the API key stays
// written by exactly one function and read back to no client.
// Every action re-checks with requireDev("super") — a server action is a public endpoint.

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { requireDev } from "@/lib/devAccess";
import { getOpenTurn } from "@/lib/turn";
import { testConnection } from "@lifeweb/db/lib/oracleClient";
import { runOracle } from "@lifeweb/db/lib/oracle";
import { correspondentPrompt, editorPrompt, appendPrompt } from "@lifeweb/db/lib/oraclePrompts";

const MAX_PROMPT = 8000;
const MAX_URL = 300;
const MAX_MODEL = 200;

// Normalises CRLF <textarea> submissions to LF, matching oraclePrompts.js defaults for the NULL-default comparison below.
function clean(raw, max) {
  const text = raw == null ? "" : String(raw).replace(/\r\n/g, "\n").trim();
  return text.slice(0, max);
}

// What the panel may know about the key: that there is one, when, and by
// whom. Never the key — a "write-only" input that still ships its value in
// server-rendered HTML would be readable in View Source.
export async function loadOracleSettings() {
  await requireDev("super");
  const config = await prisma.gameConfig.findFirst({
    select: {
      oracleEnabled: true,
      oraclePlaytest: true,
      oracleProvider: true,
      oracleBaseUrl: true,
      oracleModel: true,
      oracleApiKeySetAt: true,
      oracleApiKeySetBy: true,
      oracleMemoryTurns: true,
      oracleIncludeChat: true,
      oracleCorrespondentPrompt: true,
      oracleEditorPrompt: true,
      oracleAppendPrompt: true,
      // Selected only to derive the boolean below; never leaves this function.
      oracleApiKey: true,
    },
  });
  if (!config) return null;

  const { oracleApiKey, ...rest } = config;
  return {
    ...rest,
    hasApiKey: Boolean(oracleApiKey),
    // Effective prompts, so the textareas show what is actually running.
    correspondentPrompt: correspondentPrompt(config),
    editorPrompt: editorPrompt(config),
    appendPrompt: appendPrompt(config),
  };
}

export async function saveOracleSettings(formData) {
  const session = await requireDev("super");
  const config = await prisma.gameConfig.findFirst({ select: { id: true } });
  if (!config) return { ok: false, error: "No configuration row." };

  const data = {
    oracleEnabled: formData.get("oracleEnabled") === "on",
    // WRITTEN vs. who may READ are different columns. See ORACLE.md §12.
    oraclePlaytest: formData.get("oraclePlaytest") === "on",
    oracleIncludeChat: formData.get("oracleIncludeChat") === "on",
    oracleProvider: clean(formData.get("oracleProvider"), 60) || "openrouter",
    oracleBaseUrl: clean(formData.get("oracleBaseUrl"), MAX_URL) || "https://openrouter.ai/api/v1",
    oracleModel: clean(formData.get("oracleModel"), MAX_MODEL) || "deepseek/deepseek-v4-flash",
    oracleMemoryTurns: Math.min(10, Math.max(0, Number.parseInt(formData.get("oracleMemoryTurns"), 10) || 0)),
  };

  // Stored as NULL when it matches the shipped default, so a later deploy's
  // default edit isn't silently overridden by a saved copy.
  const correspondent = clean(formData.get("correspondentPrompt"), MAX_PROMPT);
  const editor = clean(formData.get("editorPrompt"), MAX_PROMPT);
  const append = clean(formData.get("appendPrompt"), MAX_PROMPT);
  data.oracleCorrespondentPrompt = !correspondent || correspondent === correspondentPrompt({}) ? null : correspondent;
  data.oracleEditorPrompt = !editor || editor === editorPrompt({}) ? null : editor;
  data.oracleAppendPrompt = !append || append === appendPrompt({}) ? null : append;

  // The key is REPLACED, never edited: an empty box means "leave it alone",
  // so a normal save never wipes the credential.
  const key = clean(formData.get("oracleApiKey"), 400);
  if (key) {
    data.oracleApiKey = key;
    data.oracleApiKeySetAt = new Date();
    data.oracleApiKeySetBy = session.discordUserId;
  }

  await prisma.gameConfig.update({ where: { id: config.id }, data });
  revalidatePath("/gm/dev");
  return { ok: true };
}

export async function clearOracleApiKey() {
  await requireDev("super");
  const config = await prisma.gameConfig.findFirst({ select: { id: true } });
  if (!config) return { ok: false, error: "No configuration row." };
  await prisma.gameConfig.update({
    where: { id: config.id },
    data: { oracleApiKey: null, oracleApiKeySetAt: null, oracleApiKeySetBy: null },
  });
  revalidatePath("/gm/dev");
  return { ok: true };
}

// A handful of tokens, to prove key/URL/model together. Only place the key is read outside a run.
export async function testOracleConnection() {
  await requireDev("super");
  const config = await prisma.gameConfig.findFirst();
  if (!config?.oracleApiKey) return { ok: false, error: "No API key is set." };
  return testConnection(config);
}

// Draft the chronicle for a turn on demand. Defaults to the OPEN turn — the
// one a GM is adjudicating — but any turn can be asked for by number. Also
// the recovery path when the automatic run never happened (bot down, provider
// outage): nothing revisits a turn once it has closed.
export async function runOracleNow(turnNumber = null) {
  await requireDev("super");

  let turn;
  if (turnNumber != null) {
    turn = await prisma.turn.findUnique({ where: { number: Number(turnNumber) }, select: { id: true } });
  } else {
    turn =
      (await getOpenTurn()) ??
      (await prisma.turn.findFirst({ orderBy: { number: "desc" }, select: { id: true } }));
  }
  if (!turn) return { ok: false, error: "No turn to write about yet." };

  // No ledger here — a failure is TOLD to the waiting GM, not swallowed. The
  // step below deliberately does not catch, so a provider error surfaces.
  let result;
  try {
    result = await runOracle(prisma, { turnId: turn.id, step: (_key, fn) => fn() });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  revalidatePath("/gm/oracle");
  revalidatePath("/gm/dev");
  return result.ran ? { ok: true, zones: result.zones } : { ok: false, error: result.reason };
}
