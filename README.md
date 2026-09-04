# @crifine/cli

What a given order size actually clears at — from the terminal, and from CI.

```bash
npm install -g @crifine/cli
```

---

## Use

```bash
crifine exit aave-v3-weth --size 5m
crifine compare WETH --size 1m
crifine board --chain ethereum
crifine verify https://crifine.app/api/v1/exit/aave-v3-weth
crifine pools
crifine watch uniswap-v3-zec --size 500k --threshold -4 --interval 30
```

Every command takes `--json`.

## Exit codes — the reason this is more than a curl wrapper

| Code | Meaning |
|---|---|
| `0` | Gap inside the threshold |
| `1` | Gap crossed the threshold |
| `2` | Size exceeds the observed book — **no price available** |
| `3` | Underlying market is closed |
| `4` | Network, API or usage error |

**Codes 1 and 2 are deliberately different.** "This trade is expensive" and
"the size you asked about is past the edge of the recorded data" are not the
same fact. A pipeline that treats them alike will proceed on a number nobody
measured — which is the failure this whole product exists to prevent.

Ordering is also deliberate: `2` outranks `3`, which outranks `1`. An unmeasured
size is not made safe by a threshold written for a measured one.

### Gate a pipeline on it

```yaml
- name: Do not rebalance into a thin book
  run: crifine exit aave-v3-weth --size 5m --max-gap -2
```

```bash
crifine exit aave-v3-weth --size 5m --max-gap -2
case $? in
  0) place_order ;;
  1) echo "book too thin — resizing"; place_smaller_order ;;
  2) echo "past the observed book — not proceeding on an unmeasured price"; exit 1 ;;
  3) echo "market closed — deferring to next session" ;;
  *) echo "check failed"; exit 1 ;;
esac
```

## Watch until something breaks

```bash
crifine watch uniswap-v3-zec --size 500k --threshold -4 --max-checks 20
```

Polls until the threshold is crossed, then exits with the code that says why.
`--max-checks` bounds it so it can live in a script rather than only in a
terminal someone is staring at. Progress goes to stderr, so `--json` on stdout
stays a single parseable object.

## Verify someone else's number

```bash
crifine verify https://crifine.app/api/v1/exit/aave-v3-weth
```

Recomputes the published estimate from its own evidence and tells you whether
it holds up. Free, keyless, and able to say **no** — see
[`@crifine/sdk`](https://github.com/crifine/crifine-sdk).

## Output

Errors go to **stderr**, results to **stdout**, so `crifine exit … --json | jq`
never receives a diagnostic where JSON is expected.

Colour follows `NO_COLOR` and is disabled when stdout is not a TTY.

## Status

The CLI, its parsing and its exit codes are **live and tested**. The API it
calls is **not serving yet** — `crifine verify` works today against any evidence
payload; the rest is published so you can build against it. See the
[changelog](https://crifine-docs.crifine.workers.dev/changelog).

## Installing before the first release

`@crifine/sdk` is not on npm yet, so `pnpm install` here will fail until it is.
For local development, link the sibling checkout — but **never commit** a
`file:` dependency:

```bash
pnpm add ../crifine-sdk   # local only
pnpm test
git checkout package.json # before committing
```

## Development

```bash
pnpm install
pnpm test    # 26 tests
pnpm build
node dist/bin.js help
```

MIT.
