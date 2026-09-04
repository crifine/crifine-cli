import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT, run } from "../src/index.js";

/**
 * A stub API whose gap worsens on each call, so watch can be driven to a
 * breach deterministically. Sleep is injected, so none of this waits.
 */
function server(gaps: number[], extra: Record<string, unknown> = {}) {
  let call = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const gap = gaps[Math.min(call++, gaps.length - 1)]!;
    return Response.json({
      pool: "aave-v3 / WETH",
      as_of: "2026-08-29",
      oracle_price: 4820,
      exit_size_usd: 1_000_000,
      realized_price_est: 4820 * (1 + gap / 100),
      exit_gap_pct: gap,
      slippage_bps: Math.abs(gap) * 100,
      exceeds_book: false,
      filled_usd: 1_000_000,
      days_observed: 7,
      market_open: true,
      method_version: "v1",
      evidence_url: "https://crifine.app/api/v1/exit/aave-v3-weth",
      ...extra,
    });
  }) as typeof fetch;

  return {
    calls: () => call,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const noSleep = async () => {};

test("watch polls until the threshold is crossed, then exits 1", async () => {
  const stub = server([-1, -2, -5]);
  try {
    const result = await run(
      ["watch", "aave-v3-weth", "--size", "1m", "--threshold=-4", "--json"],
      noSleep,
    );
    assert.equal(result.code, EXIT.GAP_EXCEEDED);
    assert.equal(JSON.parse(result.stdout).breached_on_check, 3);
  } finally {
    stub.restore();
  }
});

test("watch stops at --max-checks and exits 0 when nothing breached", async () => {
  const stub = server([-0.5]);
  try {
    const result = await run(
      ["watch", "aave-v3-weth", "--size", "1m", "--threshold=-4", "--max-checks", "3", "--json"],
      noSleep,
    );
    assert.equal(result.code, EXIT.OK);
    assert.equal(JSON.parse(result.stdout).breached, false);
    assert.equal(stub.calls(), 3);
  } finally {
    stub.restore();
  }
});

test("watch exits 2 on past-the-book, not 1 — even with a threshold set", async () => {
  const stub = server([-9], { exceeds_book: true, filled_usd: 400_000 });
  try {
    const result = await run(
      ["watch", "aave-v3-weth", "--size", "1m", "--threshold=-4", "--json"],
      noSleep,
    );
    assert.equal(result.code, EXIT.PAST_BOOK);
  } finally {
    stub.restore();
  }
});

test("watch exits 3 when the market closes under it", async () => {
  const stub = server([-0.2], { market_open: false });
  try {
    const result = await run(
      ["watch", "rh-nvda", "--size", "500k", "--threshold=-4", "--json"],
      noSleep,
    );
    assert.equal(result.code, EXIT.MARKET_CLOSED);
  } finally {
    stub.restore();
  }
});
