/**
 * A small argument parser.
 *
 * Deliberately not a dependency: the whole surface is a handful of long flags,
 * and a CLI meant to run inside other people's pipelines is better off with
 * nothing to audit.
 */

export type Args = {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string | boolean>;
};

export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const [name, inline] = token.slice(2).split("=", 2);
    if (!name) continue;

    if (inline !== undefined) {
      flags.set(name, inline);
      continue;
    }

    const next = argv[i + 1];
    // A flag followed by another flag is a boolean, not a flag with a value.
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, true);
    } else {
      flags.set(name, next);
      i++;
    }
  }

  return { command: positional[0], positional: positional.slice(1), flags };
}

/** "5m", "500k", "2.5M", "250000" → dollars. */
export function parseSize(input: string | undefined): number | undefined {
  if (input === undefined) return undefined;

  const match = String(input).trim().toLowerCase().match(/^\$?([\d,.]+)\s*([kmb])?$/);
  if (!match) return undefined;

  const base = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(base) || base <= 0) return undefined;

  const scale = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "b" ? 1_000_000_000 : 1;
  return base * scale;
}

export function flagString(args: Args, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function flagNumber(args: Args, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function flagBool(args: Args, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === "true";
}
