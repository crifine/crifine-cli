/** Terminal formatting. Kept apart from logic so `--json` shares no code path. */

const supportsColour = () =>
  process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const wrap = (code: string, text: string) =>
  supportsColour() ? `\u001b[${code}m${text}\u001b[0m` : text;

export const dim = (text: string) => wrap("2", text);
export const bold = (text: string) => wrap("1", text);
export const green = (text: string) => wrap("32", text);
export const yellow = (text: string) => wrap("33", text);
export const red = (text: string) => wrap("31", text);

export function size(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function price(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  })}`;
}

/** Always signed — an unsigned execution gap has lost the part that matters. */
export function pct(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** Colour by magnitude, matching the bands the docs describe. */
export function gapColour(value: number): (text: string) => string {
  const magnitude = Math.abs(value);
  if (magnitude < 1) return green;
  if (magnitude < 4) return yellow;
  return red;
}

export function table(rows: [string, string][]): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${dim(label.padEnd(width))}  ${value}`).join("\n");
}
