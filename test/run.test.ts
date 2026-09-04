import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT, run } from "../src/index.js";

test("no command prints help and exits 0", async () => {
  const result = await run([]);
  assert.equal(result.code, EXIT.OK);
  assert.match(result.stdout, /USAGE/);
});

test("an unknown command exits 4 and still shows usage", async () => {
  const result = await run(["frobnicate"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /unknown command/);
});

test("exit without --size refuses, and says why", async () => {
  const result = await run(["exit", "aave-v3-weth"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /no such thing as the fill price/);
});

test("exit without a pool refuses", async () => {
  assert.equal((await run(["exit", "--size", "5m"])).code, EXIT.ERROR);
});

test("help lists the exit codes, including why 1 and 2 differ", async () => {
  const { stdout } = await run(["help"]);
  assert.match(stdout, /EXIT CODES/);
  assert.match(stdout, /not the same fact/);
});

test("a network failure exits 4 rather than crashing", async () => {
  const result = await run(["board", "--api", "https://127.0.0.1:1/nowhere"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /^error:/);
});

test("--version reports the version, not the help text", async () => {
  const result = await run(["--version"]);
  assert.equal(result.code, EXIT.OK);
  assert.equal(result.stdout, "0.1.0");
  assert.doesNotMatch(result.stdout, /USAGE/);
});

/* ── watch ──────────────────────────────────────────────────────────────── */

test("watch without a threshold refuses — it would never end", async () => {
  const result = await run(["watch", "aave-v3-weth", "--size", "1m"]);
  assert.equal(result.code, EXIT.ERROR);
  assert.match(result.stdout, /never ends/);
});

test("watch without a size refuses", async () => {
  assert.equal(
    (await run(["watch", "aave-v3-weth", "--threshold=-4"])).code,
    EXIT.ERROR,
  );
});
