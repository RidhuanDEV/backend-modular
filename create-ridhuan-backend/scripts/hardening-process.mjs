import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { command } from "../dist/process.js";

export async function collectProcessCase(
  item,
  log,
  env,
  timeoutMs = 45 * 60 * 1000,
) {
  const output = createWriteStream(log);
  const result = await new Promise((finish) => {
    const child = spawn(item.executable, item.args, {
      cwd: item.cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      if (!child.pid) return;
      if (process.platform === "win32")
        command("taskkill", ["/PID", String(child.pid), "/T", "/F"], item.cwd);
      else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH")
            output.write("Failed to terminate timed-out test process\n");
        }
      }
    }, timeoutMs);
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    child.on("error", (error) => {
      clearTimeout(timeout);
      finish({ exitCode: null, signal: null, error: error.message });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      finish({ exitCode, signal });
    });
  });
  await new Promise((finish) => output.end(finish));
  return result;
}
