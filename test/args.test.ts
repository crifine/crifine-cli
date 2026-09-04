import assert from "node:assert/strict";
import { test } from "node:test";
import { flagBool, flagNumber, parseArgs, parseSize } from "../src/args.js";

test("flags parse with a space or an equals sign", () => {
  const a = parseArgs(["exit", "aave-v3-weth", "--size", "5m"]);
  const b = parseArgs(["exit", "aave-v3-weth", "--size=5m"]);
  assert.equal(a.flags.get("size"), "5m");
  assert.equal(b.flags.get("size"), "5m");
  assert.equal(a.command, "exit");
  assert.deepEqual(a.positional, ["aave-v3-weth"]);
});

test("a flag followed by another flag is a boolean, not a value", () => {
  const args = parseArgs(["exit", "p", "--json", "--size", "5m"]);
  assert.equal(flagBool(args, "json"), true);
  assert.equal(args.flags.get("size"), "5m");
});

test("negative numbers survive as flag values", () => {
  // --max-gap -2 must not be read as a boolean followed by a positional.
  const args = parseArgs(["exit", "p", "--max-gap=-2"]);
  assert.equal(flagNumber(args, "max-gap"), -2);
});

test("sizes parse in the shapes people actually type", () => {
  assert.equal(parseSize("5m"), 5_000_000);
  assert.equal(parseSize("5M"), 5_000_000);
  assert.equal(parseSize("$5m"), 5_000_000);
  assert.equal(parseSize("500k"), 500_000);
  assert.equal(parseSize("2.5m"), 2_500_000);
  assert.equal(parseSize("250,000"), 250_000);
  assert.equal(parseSize("250000"), 250_000);
});

test("nonsense sizes are rejected rather than guessed at", () => {
  for (const bad of ["", "abc", "-5m", "0", "5x", undefined]) {
    assert.equal(parseSize(bad), undefined, `expected ${bad} to be rejected`);
  }
});
