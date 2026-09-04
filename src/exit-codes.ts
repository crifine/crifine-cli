/**
 * Exit codes, chosen so a pipeline can branch on them.
 *
 * The distinction that matters is `GAP_EXCEEDED` versus `PAST_BOOK`. The first
 * says "this trade is expensive"; the second says "the size you asked about is
 * past the edge of the recorded data, so there is no price to give you". A
 * pipeline that treats those the same will happily proceed on a number nobody
 * measured — the exact failure this product exists to prevent.
 */
export const EXIT = {
  /** Gap is inside the threshold, or no threshold was set. */
  OK: 0,
  /** Gap crossed the threshold. The book is thin, but it is measured. */
  GAP_EXCEEDED: 1,
  /** Size exceeds the observed book. Not a price — an absence of one. */
  PAST_BOOK: 2,
  /** The underlying market is closed. Separate risk, separate code. */
  MARKET_CLOSED: 3,
  /** Network, API or usage error. */
  ERROR: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const EXIT_MEANING: Record<ExitCode, string> = {
  [EXIT.OK]: "within threshold",
  [EXIT.GAP_EXCEEDED]: "gap crossed the threshold",
  [EXIT.PAST_BOOK]: "size exceeds the observed book — no price available",
  [EXIT.MARKET_CLOSED]: "underlying market is closed",
  [EXIT.ERROR]: "error",
};
