// Starts `pnpm dev`, waits for GET /healthz to answer 200, prints `healthz 200`,
// stops the whole process tree and exits 0. Exits 1 on timeout or another status.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const POLL_MS = 500;
const TIMEOUT_MS = 120_000;
const isWindows = process.platform === "win32";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function stopTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (isWindows) {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
        stdio: "ignore",
      });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    // The group is already gone: nothing left to stop.
  }
}

const port = await freePort();
const child = spawn("pnpm", ["dev"], {
  env: { ...process.env, PORT: String(port), PGLITE_DATA_DIR: "memory://" },
  stdio: ["ignore", "inherit", "inherit"],
  detached: !isWindows,
  shell: isWindows,
});

let exited = false;
child.on("exit", () => {
  exited = true;
});

const url = `http://127.0.0.1:${port}/healthz`;
const deadline = Date.now() + TIMEOUT_MS;
let code = 1;
let lastError = "no answer yet";

while (Date.now() < deadline) {
  if (exited) {
    lastError = `pnpm dev exited (code ${child.exitCode}) before /healthz answered`;
    break;
  }
  try {
    const res = await fetch(url);
    if (res.status === 200) {
      console.log("healthz 200");
      code = 0;
    } else {
      lastError = `GET /healthz answered ${res.status}`;
    }
    break;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

if (code !== 0) {
  if (Date.now() >= deadline)
    lastError = `timed out after ${TIMEOUT_MS / 1000} s: ${lastError}`;
  console.error(`dev-smoke failed: ${lastError}`);
}
stopTree(child);
process.exit(code);
