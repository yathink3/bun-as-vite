#!/usr/bin/env bun
import { runCLI } from '../dist/cli.js';
await runCLI(process.argv.slice(2));
