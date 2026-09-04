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

function serve(body: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(body)) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; } };
}

/* ── size ───────────────────────────────────────────────────────────────── */

test("size without --max-gap refuses, and says why", async () => {
  const result = await run(["size", "aave-v3-weth"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /every size clears at some cost/);
});

test("a positive --max-gap is refused", async () => {
  assert.equal((await run(["size", "aave-v3-weth", "--max-gap", "1"])).code, EXIT.ERROR);
});

test("size reports the largest amount that clears within the limit", async () => {
  const stub = serve(ladder);
  try {
    const result = await run(["size", "aave-v3-weth", "--max-gap=-0.1", "--json"]);
    const payload = JSON.parse(result.stdout);
    assert.equal(result.code, EXIT.OK);
    assert.ok(payload.max_size_usd > 0);
    // Everything inside the first band costs 5bp = 0.05%, so a 0.1% budget
    // must reach past it but not swallow the whole book.
    assert.ok(payload.max_size_usd > 612_000);
    assert.ok(payload.max_size_usd < 2_033_000);
  } finally {
    stub.restore();
  }
});

test("size exits 1 and says nothing fits when even the first band is too dear", async () => {
  const stub = serve(ladder);
  try {
    const result = await run(["size", "aave-v3-weth", "--max-gap=-0.01"]);
    assert.equal(result.code, EXIT.GAP_EXCEEDED);
    assert.match(result.stdout, /nothing/);
  } finally {
    stub.restore();
  }
});

test("a looser limit never allows less size", async () => {
  const stub = serve(ladder);
  try {
    const tight = JSON.parse((await run(["size", "aave-v3-weth", "--max-gap=-0.1", "--json"])).stdout);
    const loose = JSON.parse((await run(["size", "aave-v3-weth", "--max-gap=-1", "--json"])).stdout);
    assert.ok(loose.max_size_usd >= tight.max_size_usd);
  } finally {
    stub.restore();
  }
});

/* ── ladder ─────────────────────────────────────────────────────────────── */

test("ladder prints every band and the book total", async () => {
  const stub = serve(ladder);
  try {
    const result = await run(["ladder", "aave-v3-weth"]);
    assert.equal(result.code, EXIT.OK);
    for (const bps of [5, 10, 25, 50]) {
      assert.match(result.stdout, new RegExp(`−\\s*${bps}bp`));
    }
    assert.match(result.stdout, /book total/);
  } finally {
    stub.restore();
  }
});

test("ladder exits 4 and names the problem when the data looks unusable", async () => {
  // Cumulative figures passed as incremental: the quiet failure that makes a
  // thin book look several times deeper than it is.
  const stub = serve({
    ...ladder,
    levels: [
      { bps: 5, usd: 612_000 },
      { bps: 10, usd: 1_160_000 },
      { bps: 25, usd: 1_631_000 },
      { bps: 50, usd: 2_033_000 },
    ],
  });
  try {
    const result = await run(["ladder", "aave-v3-weth"]);
    assert.equal(result.code, EXIT.ERROR);
    assert.match(result.stdout, /unusable/);
    assert.match(result.stdout, /cumulative/);
  } finally {
    stub.restore();
  }
});

test("ladder --json carries the problems alongside the data", async () => {
  const stub = serve(ladder);
  try {
    const payload = JSON.parse((await run(["ladder", "aave-v3-weth", "--json"])).stdout);
    assert.deepEqual(payload.problems, []);
    assert.equal(payload.levels.length, 4);
  } finally {
    stub.restore();
  }
});

test("both commands require a pool", async () => {
  assert.equal((await run(["size", "--max-gap=-1"])).code, EXIT.ERROR);
  assert.equal((await run(["ladder"])).code, EXIT.ERROR);
});
