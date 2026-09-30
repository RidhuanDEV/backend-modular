#!/usr/bin/env node
import { runCli } from "../cli.js";

runCli()
  .then(() => {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stdout.write("\x1b[?25h");
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stderr.write(`\nError: ${error instanceof Error ? error.message : "Setup failed"}\n`);
    process.exit(error instanceof Error && error.name === "ExitPromptError" ? 130 : 1);
  });
