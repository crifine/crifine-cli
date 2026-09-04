import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT, run } from "../src/index.js";

const ladder = {
  pool: "aave-v3 / WETH",
  as_of: "2026-08-29",
  oracle_price: 4820,
  levels: [
    { bps: 5, usd: 612_000 },
    { bps: 10, usd: 548_000 },
    { bps: 25, usd: 471_000 },
    { bps: 50, usd: 402_000 },
  ],
};

function serve() {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(ladder)) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; } };
}

test("simulate without --sizes refuses", async () => {
  const result = await run(["simulate", "aave-v3-weth"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /--sizes is required/);
});

test("an unreadable size list is refused rather than partly parsed", async () => {
  const result = await run(["simulate", "aave-v3-weth", "--sizes", "500k,banana"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /could not read every size/);
});

test("later legs clear worse than earlier ones", async () => {
  const stub = serve();
  try {
    const result = await run([
      "simulate", "aave-v3-weth", "--sizes", "400k,400k,400k", "--json",
    ]);
    const { fills } = JSON.parse(result.stdout);
    assert.equal(fills.length, 3);
    assert.ok(fills[1].exitGapPct < fills[0].exitGapPct);
    assert.ok(fills[2].exitGapPct < fills[1].exitGapPct);
  } finally {
    stub.restore();
  }
});

test("a sequence that outruns the book exits 2, not 0", async () => {
  const stub = serve();
  try {
    const result = await run([
      "simulate", "aave-v3-weth", "--sizes", "1m,1m,1m", "--json",
    ]);
    assert.equal(result.code, EXIT.PAST_BOOK);
    assert.ok(JSON.parse(result.stdout).fills.some((f: { exceedsBook: boolean }) => f.exceedsBook));
  } finally {
    stub.restore();
  }
});

test("a sequence that fits exits 0 and reports a blended gap", async () => {
  const stub = serve();
  try {
    const result = await run(["simulate", "aave-v3-weth", "--sizes", "200k,200k", "--json"]);
    const payload = JSON.parse(result.stdout);
    assert.equal(result.code, EXIT.OK);
    assert.equal(payload.totalUsd, 400_000);
    assert.ok(payload.blendedGapPct < 0);
  } finally {
    stub.restore();
  }
});

test("the human output names the trap it exists to avoid", async () => {
  const stub = serve();
  try {
    const result = await run(["simulate", "aave-v3-weth", "--sizes", "300k,300k"]);
    assert.match(result.stdout, /pays for the ones before it/);
    assert.match(result.stdout, /blended/);
  } finally {
    stub.restore();
  }
});
