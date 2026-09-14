// The archive bucket's SigV4 signer. Two hand-rolled signers exist in this
// repo (scripts/db/bucket.py and db/lib/archiveBucket.js); if they drift, S3
// answers with SignatureDoesNotMatch, which reads exactly like a wrong
// secret. The signatures below were produced by bucket.py's own math on
// frozen inputs, pinning the JS to the implementation known to work.
const test = require("node:test");
const assert = require("node:assert/strict");

const FROZEN = "2026-09-09T06:00:00.000Z";
const EXPECTED = {
  "PUT-body": "c510b90b780d68ba1293593d13bbbb35efef021ad26271c8236a99dd79fc33af",
  "GET-obj": "12f5b7c08d970f2a36bce7a8d05367c201e0d78feb3063bbb6fdb70c27d991c4",
  LIST: "595e06500983a1e847165c702ee02c9446147df8257281117a6fa57347921733",
  DELETE: "63b895fa7039f3a26368c7553538a34fd1453cade0423b80a91ff957f1b3ee17",
};

test("archiveBucket signs exactly as bucket.py does", async (t) => {
  const prevEnv = { ...process.env };
  Object.assign(process.env, {
    S3_ENDPOINT: "https://s3.example.com",
    S3_BUCKET: "bascinet-backups",
    AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
    AWS_SECRET_ACCESS_KEY: "SECRETKEY",
    AWS_DEFAULT_REGION: "auto",
  });

  const RealDate = Date;
  const RealFetch = globalThis.fetch;
  globalThis.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(FROZEN); }
    static now() { return new RealDate(FROZEN).getTime(); }
  };

  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push(opts.headers.Authorization.match(/Signature=([0-9a-f]+)/)[1]);
    return {
      ok: true,
      status: 200,
      headers: new Map([["etag", '"deadbeef"']]),
      text: async () => "<ListBucketResult></ListBucketResult>",
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };

  t.after(() => {
    globalThis.Date = RealDate;
    globalThis.fetch = RealFetch;
    process.env = prevEnv;
  });

  const bucket = require("../lib/archiveBucket");

  await bucket.putObject("archives/final/abc.jsonl.gz", Buffer.from("hello packet"));
  assert.equal(seen.pop(), EXPECTED["PUT-body"], "PUT with a body");

  await bucket.getObject("archives/final/abc.jsonl.gz");
  assert.equal(seen.pop(), EXPECTED["GET-obj"], "GET one object");

  await bucket.listObjects("archives/");
  assert.equal(seen.pop(), EXPECTED.LIST, "list a prefix");

  await bucket.deleteObject("archives/live/g/1.jsonl.gz");
  assert.equal(seen.pop(), EXPECTED.DELETE, "delete one object");
});

test("archiveBucket says plainly when it has no credentials", () => {
  const prevEnv = { ...process.env };
  for (const k of ["S3_ENDPOINT", "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
    delete process.env[k];
  }
  const bucket = require("../lib/archiveBucket");
  assert.equal(bucket.bucketConfigured(), false);
  process.env = prevEnv;
});
