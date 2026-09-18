// The Oracle's one outbound call. See docs/systemdocs/ORACLE.md.
// OpenAI-shaped chat completions (what OpenRouter and most other providers
// speak). `baseUrl` is configured, not hardcoded, so switching provider is a
// settings change, not a deploy. Deliberately NOT db/lib/discordRest.js's
// treatment (circuit breaker, bounded 429 retries, metrics) — this runs seven
// times a day, so: a timeout, one retry, an honest error otherwise. The
// caller (db/lib/oracleCutoff.js) logs and swallows per zone; the pages
// already written are what make a retry cheap.

// Ceiling on patience, not on page length (the length cap is in oracle.js);
// must be the looser of the two or long pages die as timeouts. Five minutes
// covers a page at oracle.js's caps even on a slow provider, and still fits
// inside the run's three-hour window with the bot's minute tick refusing a
// second run while one is in flight (bot/src/events/ready.js).
const DEFAULT_TIMEOUT_MS = 300_000;

class OracleError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = "OracleError";
    this.status = status;
    this.retryable = retryable;
  }
}

// A 4xx that is not 429 is a bad key/model/request — retrying just spends
// money twice, so only 429 and 5xx come back.
function retryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function once({ baseUrl, apiKey, model, system, user, timeoutMs, maxTokens }) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (err) {
    const aborted = err?.name === "AbortError";
    throw new OracleError(aborted ? `Timed out after ${timeoutMs}ms` : `Network error: ${err?.message ?? err}`, {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Never let a huge error page become the thrown string.
    const detail = await response.text().catch(() => "");
    throw new OracleError(`HTTP ${response.status}: ${detail.slice(0, 300)}`, {
      status: response.status,
      retryable: retryableStatus(response.status),
    });
  }

  const json = await response.json().catch(() => null);
  const choice = json?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    // A 200 with no content is a provider problem, the shape an overloaded
    // gateway most often returns.
    throw new OracleError("The provider returned no text.", { retryable: true });
  }

  return {
    text: text.trim(),
    // A model that hit max_tokens stops mid-sentence; without this a cut-off
    // page is indistinguishable from a finished one. complete() decides what
    // this means; this only reports it.
    truncated: choice?.finish_reason === "length",
    inputTokens: Number(json?.usage?.prompt_tokens) || null,
    outputTokens: Number(json?.usage?.completion_tokens) || null,
    // How long THIS request took, provider round-trip only. oracle.js's
    // logCall pairs it with the time spent building the input, so a slow
    // turn's log line says whose time it was.
    ms: Date.now() - started,
  };
}

// One completion. Throws OracleError; the caller decides what a failure means.
// `config` is a GameConfig row — the API key never travels any other way.
async function complete(config, {
  system,
  user,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTokens = 2048,
  allowTruncated = false,
}) {
  const apiKey = config?.oracleApiKey;
  if (!apiKey) throw new OracleError("No API key is set for the Oracle.");
  if (!config?.oracleModel) throw new OracleError("No model is set for the Oracle.");

  const args = {
    baseUrl: config.oracleBaseUrl,
    apiKey,
    model: config.oracleModel,
    system,
    user,
    timeoutMs,
    maxTokens,
  };

  try {
    const result = await once(args);
    // A page cut off at the cap looks like a success but would be fed to the
    // next turns' writers as fact, so it's an error and NOT a retryable one —
    // the same request produces the same truncation.
    if (result.truncated && !allowTruncated) {
      throw new OracleError(`The model stopped at the ${maxTokens}-token cap, mid-page.`);
    }
    return result;
  } catch (err) {
    if (!(err instanceof OracleError) || !err.retryable) throw err;
    // One retry after a pause to outlast a brief rate limit — no schedule
    // beyond this.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return once(args);
  }
}

// The panel's Test connection button. Deliberately tiny — a handful of tokens
// proves the key, URL and model name all at once.
async function testConnection(config) {
  const started = Date.now();
  try {
    const res = await complete(config, {
      system: "Reply with the single word OK.",
      user: "Reply with the single word OK.",
      timeoutMs: 30_000,
      maxTokens: 16,
      // A chatty model runs past 16 tokens every time; fine, any reply length
      // already answers whether the key/URL/model work.
      allowTruncated: true,
    });
    return { ok: true, ms: Date.now() - started, reply: res.text.slice(0, 40) };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err?.message ?? String(err) };
  }
}

module.exports = { complete, testConnection, OracleError, DEFAULT_TIMEOUT_MS };
