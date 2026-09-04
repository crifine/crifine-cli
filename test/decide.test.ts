import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT, codeForDecision, run } from "../src/index.js";
import type { Decision, ExitEstimate } from "@crifine/sdk";

const estimate = (overrides: Partial<ExitEstimate> = {}): ExitEstimate => ({
  pool: "aave-v3 / WETH",
  as_of: "2026-08-29",
  oracle_price: 4820,
  exit_size_usd: 1_000_000,
  realized_price_est: 4815,
  exit_gap_pct: -0.1,
  slippage_bps: 10,
  exceeds_book: false,
  filled_usd: 1_000_000,
  days_observed: 7,
  market_open: true,
  method_version: "v1",
  evidence_url: "https://crifine.app/api/v1/exit/aave-v3-weth",
  ...overrides,
});

const decision = (action: Decision["action"], est = estimate()): Decision => ({
  action,
  reason: "",
  estimate: est,
});

/** Serve one estimate, so decide can be driven end to end. */
function server(overrides: Partial<ExitEstimate> = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(estimate(overrides))) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; } };
}

test("proceed exits 0, resize and hold exit 1", () => {
  assert.equal(codeForDecision(decision("proceed")), EXIT.OK);
  assert.equal(codeForDecision(decision("resize")), EXIT.GAP_EXCEEDED);
  assert.equal(codeForDecision(decision("hold")), EXIT.GAP_EXCEEDED);
});

test("defer exits 3", () => {
  assert.equal(codeForDecision(decision("defer")), EXIT.MARKET_CLOSED);
});

test("a refusal for past-the-book exits 2, but a refusal on policy exits 1", () => {
  // The distinction survives into the decision layer: unmeasured is code 2,
  // a policy judgement about a measured number is code 1.
  assert.equal(
    codeForDecision(decision("refuse", estimate({ exceeds_book: true }))),
    EXIT.PAST_BOOK,
  );
  assert.equal(
    codeForDecision(decision("refuse", estimate({ days_observed: 1 }))),
    EXIT.GAP_EXCEEDED,
  );
});

test("decide without --max-gap refuses, and says why", async () => {
  const result = await run(["decide", "aave-v3-weth", "--size", "1m"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /not a policy/);
});

test("decide without a size refuses", async () => {
  assert.equal(
    (await run(["decide", "aave-v3-weth", "--max-gap=-2"])).code,
    EXIT.ERROR,
  );
});

test("a positive --max-gap is refused rather than silently accepted", async () => {
  const result = await run(["decide", "aave-v3-weth", "--size", "1m", "--max-gap", "2"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /not a policy/);
});

test("a healthy book proceeds and exits 0", async () => {
  const stub = server();
  try {
    const result = await run(["decide", "aave-v3-weth", "--size", "1m", "--max-gap=-2", "--json"]);
    assert.equal(result.code, EXIT.OK);
    assert.equal(JSON.parse(result.stdout).action, "proceed");
  } finally {
    stub.restore();
  }
});

test("past the book refuses with code 2, not a resize", async () => {
  const stub = server({ exceeds_book: true, filled_usd: 300_000, exit_gap_pct: -9 });
  try {
    const result = await run(["decide", "aave-v3-weth", "--size", "1m", "--max-gap=-2", "--json"]);
    assert.equal(result.code, EXIT.PAST_BOOK);
    assert.equal(JSON.parse(result.stdout).action, "refuse");
  } finally {
    stub.restore();
  }
});

test("a short record refuses under --min-days even when the gap is fine", async () => {
  const stub = server({ days_observed: 3, exit_gap_pct: -0.05 });
  try {
    const result = await run([
      "decide", "aave-v3-weth", "--size", "1m", "--max-gap=-2", "--min-days", "30", "--json",
    ]);
    assert.equal(JSON.parse(result.stdout).action, "refuse");
    assert.equal(result.code, EXIT.GAP_EXCEEDED);
  } finally {
    stub.restore();
  }
});

test("a closed market defers, and --allow-closed opts out", async () => {
  const stub = server({ market_open: false });
  try {
    const deferred = await run(["decide", "rh-nvda", "--size", "500k", "--max-gap=-2", "--json"]);
    assert.equal(deferred.code, EXIT.MARKET_CLOSED);

    const allowed = await run([
      "decide", "rh-nvda", "--size", "500k", "--max-gap=-2", "--allow-closed", "--json",
    ]);
    assert.equal(allowed.code, EXIT.OK);
  } finally {
    stub.restore();
  }
});

test("a thin book with headroom suggests a size to retry at", async () => {
  const stub = server({ exit_gap_pct: -6, filled_usd: 400_000 });
  try {
    const result = await run(["decide", "aave-v3-weth", "--size", "1m", "--max-gap=-2", "--json"]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.action, "resize");
    assert.equal(payload.suggestedSizeUsd, 400_000);
  } finally {
    stub.restore();
  }
});

test("every decision carries its evidence link", async () => {
  const stub = server();
  try {
    const result = await run(["decide", "aave-v3-weth", "--size", "1m", "--max-gap=-2"]);
    assert.match(result.stdout, /crifine\.app\/api\/v1\/exit/);
  } finally {
    stub.restore();
  }
});
