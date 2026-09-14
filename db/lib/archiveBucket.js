// The archive packets' side of the backup bucket, in JavaScript — the PROGRAMMATIC path, shared by
// the web action and the export script. Not scripts/db/bucket.py (which signs SigV4 by hand too):
// the GM's Archive button is a Next.js server action, and reaching bucket.py from there would assume
// python3, scripts/, and the backup service's S3_* credentials are all on the web deployment, which
// they aren't. bucket.py keeps its own verbs (`archives`, `getkey`, `rm`) for the terminal. No SDK —
// SigV4 is about forty lines of hmac and Node has crypto.

const crypto = require("crypto");

function env() {
  const endpoint = process.env.S3_ENDPOINT || "";
  const bucket = process.env.S3_BUCKET || "";
  const ak = process.env.AWS_ACCESS_KEY_ID || "";
  const sk = process.env.AWS_SECRET_ACCESS_KEY || "";
  const region = process.env.AWS_DEFAULT_REGION || "auto";
  return { endpoint, bucket, ak, sk, region, ok: Boolean(endpoint && bucket && ak && sk) };
}

// Whether this process can reach the bucket at all — the web app asks before offering to archive, so
// a GM gets "no bucket credentials" instead of a signature error five minutes in.
function bucketConfigured() {
  return env().ok;
}

const ARCHIVE_PREFIX = () => process.env.S3_ARCHIVE_PREFIX || "archives";

const hmac = (key, msg) => crypto.createHmac("sha256", key).update(msg).digest();
const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// SigV4 wants the query sorted by key and percent-encoded; encodeURIComponent leaves !'()* alone
// where S3 does not.
function encode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join("&");
}

async function call(method, key = "", params = null, body = null) {
  const { endpoint, bucket, ak, sk, region, ok } = env();
  if (!ok) throw new Error("archiveBucket: S3_ENDPOINT / S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY must all be set");
  const host = `${bucket}.${endpoint.replace(/^https?:\/\//, "")}`;
  const now = new Date();
  const amzdate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const datestamp = amzdate.slice(0, 8);

  // Payload is hashed into BOTH the canonical request and x-amz-content-sha256 — a body sent but not
  // hashed fails as SignatureDoesNotMatch, which looks exactly like a wrong secret.
  const payload = body ?? Buffer.alloc(0);
  const sha = sha256hex(payload);

  // Each path segment encoded, separators not.
  const uri = "/" + key.split("/").map(encode).join("/");
  const query = params ? canonicalQuery(params) : "";
  const headers = `host:${host}\nx-amz-content-sha256:${sha}\nx-amz-date:${amzdate}\n`;
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const creq = `${method}\n${key ? uri : "/"}\n${query}\n${headers}\n${signed}\n${sha}`;
  const scope = `${datestamp}/${region}/s3/aws4_request`;
  const sts = `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${sha256hex(Buffer.from(creq))}`;
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${sk}`, datestamp), region), "s3"), "aws4_request");
  const sig = crypto.createHmac("sha256", kSigning).update(sts).digest("hex");

  const res = await fetch(`https://${host}${key ? uri : "/"}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed}, Signature=${sig}`,
      "x-amz-date": amzdate,
      "x-amz-content-sha256": sha,
      ...(body ? { "Content-Type": "application/octet-stream", "Content-Length": String(body.length) } : {}),
    },
    ...(body ? { body } : {}),
  });
  return res;
}

async function putObject(key, body) {
  const res = await call("PUT", key, null, body);
  if (!res.ok) {
    throw new Error(`archiveBucket: PUT ${key} failed (${res.status}) ${(await res.text()).slice(0, 300)}`);
  }
  // A single-part PUT returns the body's MD5 as the ETag, checkable without downloading it again.
  return (res.headers.get("etag") || "").replace(/"/g, "");
}

async function getObject(key) {
  const res = await call("GET", key);
  if (!res.ok) {
    throw new Error(`archiveBucket: GET ${key} failed (${res.status}) ${(await res.text()).slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function deleteObject(key) {
  const res = await call("DELETE", key);
  if (!res.ok && res.status !== 404) {
    throw new Error(`archiveBucket: DELETE ${key} failed (${res.status})`);
  }
}

// Every object under a prefix, as { key, size, modified }. Paged — a year-old bucket holds more than one page.
async function listObjects(prefix) {
  const out = [];
  let token = null;
  for (;;) {
    const params = { "list-type": "2", prefix };
    if (token) params["continuation-token"] = token;
    const res = await call("GET", "", params);
    if (!res.ok) throw new Error(`archiveBucket: list failed (${res.status})`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const pick = (tag) => (m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] ?? "";
      out.push({ key: pick("Key"), size: Number(pick("Size") || 0), modified: pick("LastModified") });
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    token = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1];
    if (!token) break;
  }
  return out;
}

const finalKey = (gameId) => `${ARCHIVE_PREFIX()}/final/${gameId}.jsonl.gz`;
const liveKey = (gameId, stamp) => `${ARCHIVE_PREFIX()}/live/${gameId}/${stamp}.jsonl.gz`;
const livePrefix = (gameId) => `${ARCHIVE_PREFIX()}/live/${gameId}/`;

module.exports = {
  bucketConfigured,
  putObject,
  getObject,
  deleteObject,
  listObjects,
  finalKey,
  liveKey,
  livePrefix,
  ARCHIVE_PREFIX,
};
