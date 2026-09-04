#!/usr/bin/env node
import { run } from "./index.js";

const { code, stdout } = await run(process.argv.slice(2));

// Errors go to stderr so `crifine exit … --json | jq` never receives a
// diagnostic where a caller expects JSON.
(code === 4 ? process.stderr : process.stdout).write(`${stdout}\n`);
process.exit(code);
