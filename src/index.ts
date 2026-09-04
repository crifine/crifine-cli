/**
 * Command implementations.
 *
 * Kept separate from `bin.ts` so every command is a pure-ish function returning
 * `{ code, stdout }` — which is what makes the exit-code behaviour testable
 * without spawning a process.
 */

import {
  CrifineClient,
  CrifineError,
  blocks,
  decide,
  maxSizeFor,
  rankRoutes,
  validateLadder,
  verify,
  type Decision,
  type Evidence,
  type ExitEstimate,
  type Policy,
} from "@crifine/sdk";
import { flagBool, flagNumber, flagString, parseArgs, parseSize, type Args } from "./args.js";
import { EXIT, EXIT_MEANING, type ExitCode } from "./exit-codes.js";
import { bold, dim, gapColour, green, pct, price, red, size, table, yellow } from "./format.js";

export { EXIT, EXIT_MEANING } from "./exit-codes.js";
export type { ExitCode } from "./exit-codes.js";

export type Run = { code: ExitCode; stdout: string };

export const VERSION = "0.1.0";

export const HELP = `crifine — what a given order size actually clears at

USAGE
  crifine exit <pool> --size <size> [--max-gap <pct>]
  crifine compare <asset> --size <size> [--max-gap <pct>]
  crifine size <pool> --max-gap <pct>
  crifine ladder <pool>
  crifine decide <pool> --size <size> --max-gap <pct> [--min-days <n>]
  crifine watch <pool> --size <size> --threshold <pct> [--interval <sec>]
  crifine board [--chain <chain>]
  crifine verify <evidence-url>
  crifine pools [--chain <chain>]

FLAGS
  --size <5m|500k|250000>   Size to measure. Required for exit, compare, watch.
  --max-gap <-2>            Threshold in percent. Sets the exit code.
  --threshold <-4>          Threshold for watch. Exits on the first breach.
  --interval <60>           Seconds between polls for watch. Default 60.
  --max-checks <n>          Stop watch after n polls. Default: run forever.
  --min-days <30>           Refuse when the record is shorter than this.
  --allow-closed            Let decide act while the underlying market is shut.
  --min-resize <50000>      Below this, decide holds instead of suggesting a resize.
  --json                    Machine-readable output.
  --api <url>               Override the API base URL.

EXIT CODES
  0  within threshold
  1  gap crossed the threshold
  2  size exceeds the observed book — no price available, not a bad price
  3  underlying market is closed
  4  error

  Codes 1 and 2 are deliberately different. "Expensive" and "unmeasured" are
  not the same fact, and a pipeline should not treat them alike.`;

function clientFrom(args: Args): CrifineClient {
  const base = flagString(args, "api");
  return new CrifineClient(base === undefined ? {} : { baseUrl: base });
}

/** The exit code an estimate implies, before any threshold is applied. */
export function codeFor(estimate: ExitEstimate, maxGap: number | undefined): ExitCode {
  // Order matters. "We do not know" outranks "this is expensive", and a closed
  // market outranks a threshold that was written for an open one.
  if (estimate.exceeds_book) return EXIT.PAST_BOOK;
  if (estimate.market_open === false) return EXIT.MARKET_CLOSED;
  if (maxGap !== undefined && estimate.exit_gap_pct < maxGap) return EXIT.GAP_EXCEEDED;
  return EXIT.OK;
}

export function renderExit(estimate: ExitEstimate, code: ExitCode): string {
  const colour = gapColour(estimate.exit_gap_pct);

  const lines = [
    `${bold(estimate.pool)}  ${dim(`at ${size(estimate.exit_size_usd)}`)}`,
    "",
    table([
      ["oracle", price(estimate.oracle_price)],
      ["realized", price(estimate.realized_price_est)],
      ["exit gap", colour(pct(estimate.exit_gap_pct))],
      ["slippage", `${Math.round(estimate.slippage_bps)} bps`],
      ["days observed", String(estimate.days_observed)],
      ["market open", String(estimate.market_open)],
    ]),
  ];

  if (code === EXIT.PAST_BOOK) {
    lines.push(
      "",
      `  ${colour("past the observed book")} — only ${size(estimate.filled_usd)} clears against`,
      "  recorded depth. Treat this as \"we do not know\", not as a price.",
    );
  }

  lines.push("", `  ${dim("evidence")}  ${estimate.evidence_url}`);
  return lines.join("\n");
}

async function cmdExit(args: Args): Promise<Run> {
  const pool = args.positional[0];
  const sizeUsd = parseSize(flagString(args, "size"));

  if (!pool) return { code: EXIT.ERROR, stdout: "error: a pool is required\n\n" + HELP };
  if (sizeUsd === undefined) {
    return {
      code: EXIT.ERROR,
      stdout: "error: --size is required. There is no such thing as the fill price, only a fill price for a size.",
    };
  }

  const estimate = await clientFrom(args).exit(pool, sizeUsd);
  const code = codeFor(estimate, flagNumber(args, "max-gap"));

  return {
    code,
    stdout: flagBool(args, "json") ? JSON.stringify(estimate, null, 2) : renderExit(estimate, code),
  };
}

async function cmdCompare(args: Args): Promise<Run> {
  const asset = args.positional[0];
  const sizeUsd = parseSize(flagString(args, "size"));

  if (!asset) return { code: EXIT.ERROR, stdout: "error: an asset is required" };
  if (sizeUsd === undefined) return { code: EXIT.ERROR, stdout: "error: --size is required" };

  const client = clientFrom(args);
  const { data } = await client.pools({});
  const candidates = data.filter((pool) => pool.asset.toLowerCase() === asset.toLowerCase());

  if (candidates.length === 0) {
    return { code: EXIT.ERROR, stdout: `error: ${asset} is not under recording` };
  }

  const estimates = await Promise.all(
    candidates.map(async (pool) => client.exit(pool.pool, sizeUsd)),
  );
  // Ranking lives in the SDK so the CLI, the app and any third party order
  // routes the same way — and so the refusal to compare across sizes is
  // enforced in one place.
  const routes = rankRoutes(estimates);

  if (flagBool(args, "json")) {
    return { code: EXIT.OK, stdout: JSON.stringify(routes, null, 2) };
  }

  const rows: [string, string][] = routes.map((route, index) => [
    route.estimate.pool,
    `${price(route.estimate.realized_price_est)}  ${gapColour(route.estimate.exit_gap_pct)(pct(route.estimate.exit_gap_pct))}${
      index === 0 ? dim("  best") : dim(`  ${Math.round(route.bpsBehindBest)} bps behind`)
    }`,
  ]);

  return {
    code: codeFor(routes[0]!.estimate, flagNumber(args, "max-gap")),
    stdout: [`${bold(asset)}  ${dim(`at ${size(sizeUsd)}`)}`, "", table(rows)].join("\n"),
  };
}

async function cmdBoard(args: Args): Promise<Run> {
  const board = await clientFrom(args).fragility();
  const chain = flagString(args, "chain");
  const rows = chain ? board.rows.filter((row) => row.pool.includes(chain)) : board.rows;

  if (flagBool(args, "json")) {
    return { code: EXIT.OK, stdout: JSON.stringify({ ...board, rows }, null, 2) };
  }

  return {
    code: EXIT.OK,
    stdout: [
      `${bold("thinnest books")}  ${dim(`as of ${board.as_of}`)}`,
      "",
      table(
        rows.map((row) => [
          row.pool,
          `${gapColour(row.exit_gap_pct)(pct(row.exit_gap_pct))}  ${dim(`at ${size(row.size_usd)}`)}`,
        ]),
      ),
    ].join("\n"),
  };
}

async function cmdVerify(args: Args): Promise<Run> {
  const url = args.positional[0];
  if (!url) return { code: EXIT.ERROR, stdout: "error: an evidence URL is required" };

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    return { code: EXIT.ERROR, stdout: `error: evidence request failed: ${response.status}` };
  }

  // `json()` is `unknown`; verify() reports a malformed payload rather than
  // trusting the shape, so the assertion here is safe and the check is real.
  const verdict = verify((await response.json()) as Evidence);

  if (flagBool(args, "json")) {
    return { code: verdict.matches ? EXIT.OK : EXIT.GAP_EXCEEDED, stdout: JSON.stringify(verdict, null, 2) };
  }

  if (verdict.matches) {
    return {
      code: EXIT.OK,
      stdout: [
        `${bold("verified")}  the published figure follows from its evidence`,
        "",
        table([
          ["computed", price(verdict.computed.realized_price_est)],
          ["published", price(verdict.published.realized_price_est)],
          ["delta", `${verdict.deltaBps.toFixed(4)} bps`],
        ]),
      ].join("\n"),
    };
  }

  return {
    code: EXIT.GAP_EXCEEDED,
    stdout: [
      `${bold("NOT verified")}  the published figure does not follow from its evidence`,
      "",
      ...verdict.problems.map((problem) => `  - ${problem}`),
    ].join("\n"),
  };
}

async function cmdPools(args: Args): Promise<Run> {
  const { data } = await clientFrom(args).pools(
    flagString(args, "chain") === undefined ? {} : { chain: flagString(args, "chain")! },
  );

  return flagBool(args, "json")
    ? { code: EXIT.OK, stdout: JSON.stringify(data, null, 2) }
    : {
        code: EXIT.OK,
        stdout: table(data.map((pool) => [pool.pool, dim(`${pool.chain} · ${pool.days_observed}d observed`)])),
      };
}


/**
 * Poll until a threshold is crossed, then exit with the code that says why.
 *
 * Written to terminate on its own so it can be used in a script rather than
 * only in a terminal someone is watching: `--max-checks` bounds it, and the
 * first breach ends it. Progress goes to stderr so `--json` on stdout stays a
 * single parseable object.
 */
async function cmdWatch(args: Args, sleep = defaultSleep): Promise<Run> {
  const pool = args.positional[0];
  const sizeUsd = parseSize(flagString(args, "size"));
  const threshold = flagNumber(args, "threshold") ?? flagNumber(args, "max-gap");

  if (!pool) return { code: EXIT.ERROR, stdout: "error: a pool is required" };
  if (sizeUsd === undefined) return { code: EXIT.ERROR, stdout: "error: --size is required" };
  if (threshold === undefined) {
    return { code: EXIT.ERROR, stdout: "error: --threshold is required — watching without one never ends" };
  }

  const client = clientFrom(args);
  const intervalMs = (flagNumber(args, "interval") ?? 60) * 1000;
  const maxChecks = flagNumber(args, "max-checks") ?? Number.POSITIVE_INFINITY;
  const json = flagBool(args, "json");

  for (let check = 1; check <= maxChecks; check++) {
    const estimate = await client.exit(pool, sizeUsd);
    const code = codeFor(estimate, threshold);

    if (code !== EXIT.OK) {
      return {
        code,
        stdout: json
          ? JSON.stringify({ breached_on_check: check, threshold, estimate }, null, 2)
          : renderExit(estimate, code),
      };
    }

    if (!json) {
      process.stderr.write(
        `  ${dim(`check ${check}`)}  ${gapColour(estimate.exit_gap_pct)(pct(estimate.exit_gap_pct))} ${dim(`(threshold ${pct(threshold)})`)}\n`,
      );
    }

    if (check < maxChecks) await sleep(intervalMs);
  }

  return {
    code: EXIT.OK,
    stdout: json
      ? JSON.stringify({ checks: maxChecks, threshold, breached: false }, null, 2)
      : `${bold("no breach")} after ${maxChecks} checks`,
  };
}

/** Injected so tests do not actually wait. */
export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


/**
 * `decide` is `exit` with the branch already taken.
 *
 * The ordering that matters — unmeasured outranks expensive, a closed market
 * outranks a threshold written for an open one — lives in the SDK, so the CLI,
 * the app and any third party reach the same verdict from the same numbers.
 */
async function cmdDecide(args: Args): Promise<Run> {
  const pool = args.positional[0];
  const sizeUsd = parseSize(flagString(args, "size"));
  const maxGapPct = flagNumber(args, "max-gap");

  if (!pool) return { code: EXIT.ERROR, stdout: "error: a pool is required" };
  if (sizeUsd === undefined) return { code: EXIT.ERROR, stdout: "error: --size is required" };
  // Validated before the request, not after: the API call is priced per
  // request, and a policy that cannot be satisfied should never cost anything.
  if (maxGapPct === undefined || !(maxGapPct < 0)) {
    return {
      code: EXIT.ERROR,
      stdout: "error: --max-gap is required and must be negative — a policy that accepts any gap is not a policy",
    };
  }

  const policy: Policy = {
    maxGapPct,
    ...(flagNumber(args, "min-days") === undefined ? {} : { minDaysObserved: flagNumber(args, "min-days")! }),
    ...(flagBool(args, "allow-closed") ? { allowClosedMarket: true } : {}),
    ...(flagNumber(args, "min-resize") === undefined ? {} : { minResizeUsd: flagNumber(args, "min-resize")! }),
  };

  let decision: Decision;
  try {
    decision = decide(await clientFrom(args).exit(pool, sizeUsd), policy);
  } catch (error) {
    if (error instanceof RangeError) return { code: EXIT.ERROR, stdout: `error: ${error.message}` };
    throw error;
  }

  const code = codeForDecision(decision);

  if (flagBool(args, "json")) {
    return { code, stdout: JSON.stringify(decision, null, 2) };
  }

  const colour = decision.action === "proceed" ? green : decision.action === "resize" ? yellow : red;
  const lines = [
    `${bold(decision.estimate.pool)}  ${dim(`at ${size(decision.estimate.exit_size_usd)}`)}`,
    "",
    `  ${colour(bold(decision.action.toUpperCase()))}  ${decision.reason}`,
  ];

  if (decision.suggestedSizeUsd !== undefined) {
    lines.push("", `  ${dim("try")}  ${size(decision.suggestedSizeUsd)}`);
  }

  lines.push("", `  ${dim("evidence")}  ${decision.estimate.evidence_url}`);
  return { code, stdout: lines.join("\n") };
}

/** Map a decision onto the same exit-code table the other commands use. */
export function codeForDecision(decision: Decision): ExitCode {
  switch (decision.action) {
    case "refuse":
      // Only past-the-book is code 2; a refusal for a short record is a policy
      // decision about a measured number, which is code 1.
      return decision.estimate.exceeds_book ? EXIT.PAST_BOOK : EXIT.GAP_EXCEEDED;
    case "defer":
      return EXIT.MARKET_CLOSED;
    case "resize":
    case "hold":
      return EXIT.GAP_EXCEEDED;
    default:
      return EXIT.OK;
  }
}


/**
 * The question people ask before they ask about a price: how much fits?
 *
 * Computed locally from the ladder rather than by probing the API at a dozen
 * sizes — on a per-request API that would be a dozen charges for one answer.
 */
async function cmdSize(args: Args): Promise<Run> {
  const pool = args.positional[0];
  const maxGapPct = flagNumber(args, "max-gap");

  if (!pool) return { code: EXIT.ERROR, stdout: "error: a pool is required" };
  if (maxGapPct === undefined || !(maxGapPct < 0)) {
    return {
      code: EXIT.ERROR,
      stdout: "error: --max-gap is required and must be negative — every size clears at some cost",
    };
  }

  const ladder = await clientFrom(args).ladder(pool);
  const step = flagNumber(args, "step");
  const affordable = maxSizeFor(ladder.levels, ladder.oracle_price, maxGapPct, {
    ...(step === undefined ? {} : { step }),
  });

  if (flagBool(args, "json")) {
    return {
      code: affordable > 0 ? EXIT.OK : EXIT.GAP_EXCEEDED,
      stdout: JSON.stringify(
        { pool: ladder.pool, as_of: ladder.as_of, max_gap_pct: maxGapPct, max_size_usd: affordable },
        null,
        2,
      ),
    };
  }

  if (affordable === 0) {
    return {
      code: EXIT.GAP_EXCEEDED,
      stdout: `${bold(ladder.pool)}\n\n  ${red("nothing")} clears within ${pct(maxGapPct)} — even the first band costs more.`,
    };
  }

  return {
    code: EXIT.OK,
    stdout: [
      `${bold(ladder.pool)}  ${dim(`as of ${ladder.as_of}`)}`,
      "",
      table([
        [`within ${pct(maxGapPct)}`, green(size(affordable))],
        ["whole book", dim(size(ladder.levels.reduce((sum, l) => sum + l.usd, 0)))],
      ]),
    ].join("\n"),
  };
}

/** Print the ladder, and say so loudly if it looks unusable. */
async function cmdLadder(args: Args): Promise<Run> {
  const pool = args.positional[0];
  if (!pool) return { code: EXIT.ERROR, stdout: "error: a pool is required" };

  const ladder = await clientFrom(args).ladder(pool);
  const problems = validateLadder(ladder.levels);

  if (flagBool(args, "json")) {
    return {
      code: problems.length > 0 ? EXIT.ERROR : EXIT.OK,
      stdout: JSON.stringify({ ...ladder, problems }, null, 2),
    };
  }

  const total = ladder.levels.reduce((sum, level) => sum + level.usd, 0);
  const widest = Math.max(...ladder.levels.map((level) => level.usd), 1);

  const lines = [
    `${bold(ladder.pool)}  ${dim(`as of ${ladder.as_of} · oracle ${price(ladder.oracle_price)}`)}`,
    "",
    ...ladder.levels.map((level) => {
      const bar = "█".repeat(Math.max(1, Math.round((level.usd / widest) * 24)));
      return `  ${dim(`−${String(level.bps).padStart(3)}bp`)}  ${bar.padEnd(24)}  ${size(level.usd)}`;
    }),
    "",
    `  ${dim("book total")}  ${size(total)}`,
  ];

  if (problems.length > 0) {
    lines.push(
      "",
      `  ${red("this ladder looks unusable:")}`,
      ...problems.map((problem) => `    - ${problem.message}`),
    );
  }

  return { code: problems.length > 0 ? EXIT.ERROR : EXIT.OK, stdout: lines.join("\n") };
}

export async function run(
  argv: readonly string[],
  sleep: Sleep = defaultSleep,
): Promise<Run> {
  const args = parseArgs(argv);

  // Checked before the help branch: `--version` carries no command, and the
  // help branch would otherwise swallow it.
  if (flagBool(args, "version")) return { code: EXIT.OK, stdout: VERSION };
  if (!args.command || flagBool(args, "help")) return { code: EXIT.OK, stdout: HELP };

  try {
    switch (args.command) {
      case "exit": return await cmdExit(args);
      case "compare": return await cmdCompare(args);
      case "size": return await cmdSize(args);
      case "ladder": return await cmdLadder(args);
      case "decide": return await cmdDecide(args);
      case "watch": return await cmdWatch(args, sleep);
      case "board": return await cmdBoard(args);
      case "verify": return await cmdVerify(args);
      case "pools": return await cmdPools(args);
      case "help": return { code: EXIT.OK, stdout: HELP };
      default:
        return { code: EXIT.ERROR, stdout: `error: unknown command "${args.command}"\n\n${HELP}` };
    }
  } catch (error) {
    const message =
      error instanceof CrifineError
        ? `error: ${error.message}${error.code ? ` (${error.code})` : ""}`
        : `error: ${error instanceof Error ? error.message : String(error)}`;
    return { code: EXIT.ERROR, stdout: message };
  }
}
