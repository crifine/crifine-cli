import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT, codeFor, renderExit } from "../src/index.js";
import type { ExitEstimate } from "@crifine/sdk";

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

test("a healthy book with no threshold exits 0", () => {
  assert.equal(codeFor(estimate(), undefined), EXIT.OK);
});

test("a gap inside the threshold exits 0", () => {
  assert.equal(codeFor(estimate({ exit_gap_pct: -1.5 }), -2), EXIT.OK);
});

test("a gap past the threshold exits 1", () => {
  assert.equal(codeFor(estimate({ exit_gap_pct: -2.5 }), -2), EXIT.GAP_EXCEEDED);
});

test("past the book exits 2, even when a threshold would have caught it", () => {
  // This is the distinction the whole exit-code table exists for: an
  // unmeasured size must not be reported as merely an expensive one.
  const code = codeFor(estimate({ exceeds_book: true, exit_gap_pct: -9 }), -2);
  assert.equal(code, EXIT.PAST_BOOK);
  assert.notEqual(code, EXIT.GAP_EXCEEDED);
});

test("past the book outranks a closed market too", () => {
  assert.equal(
    codeFor(estimate({ exceeds_book: true, market_open: false }), undefined),
    EXIT.PAST_BOOK,
  );
});

test("a closed market exits 3 regardless of how good the gap looks", () => {
  assert.equal(
    codeFor(estimate({ market_open: false, exit_gap_pct: -0.01 }), -2),
    EXIT.MARKET_CLOSED,
  );
});

test("the past-book render says what it means, not just that it is bad", () => {
  const rendered = renderExit(
    estimate({ exceeds_book: true, filled_usd: 3_120_000, exit_size_usd: 5_000_000 }),
    EXIT.PAST_BOOK,
  );
  assert.match(rendered, /past the observed book/);
  assert.match(rendered, /we do not know/);
  assert.match(rendered, /\$3\.1M/);
});

test("every rendered result carries its evidence link", () => {
  assert.match(renderExit(estimate(), EXIT.OK), /crifine\.app\/api\/v1\/exit/);
});
