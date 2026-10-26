import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

const source = process.env.KUMA_TEST_SERVER_DIR;
if (!source) throw new Error("Set KUMA_TEST_SERVER_DIR to an installed Uptime Kuma 2.5.7 source checkout.");
const cwd = resolve(source);
const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
if (pkg.name !== "uptime-kuma" || pkg.version !== "2.5.7") throw new Error("This live test targets uptime-kuma 2.5.7.");
const dataDir = await mkdtemp(join(tmpdir(), "kuma-mcp-live-"));
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const url = `http://127.0.0.1:${port}`;
const kuma = spawn(process.execPath, ["server/server.js"], {
  cwd,
  env: { ...process.env, NODE_ENV: "development", DATA_DIR: dataDir, UPTIME_KUMA_DB_TYPE: "sqlite", UPTIME_KUMA_HOST: "127.0.0.1", UPTIME_KUMA_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
for (const output of [kuma.stdout, kuma.stderr]) output.on("data", (data) => { logs = (logs + data).slice(-12000); });
try {
  let ready = false;
  for (let i = 0; i < 240 && kuma.exitCode === null; i++) {
    try {
      const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Kuma startup failed:\n${logs}`);
  const password = `Test-${randomBytes(18).toString("hex")}!`;
  for (const transport of ["stdio", "http"]) {
    const demo = spawn(process.execPath, ["scripts/live-demo.mjs"], {
      env: { ...process.env, KUMA_TEST_URL: url, KUMA_TEST_PASSWORD: password, KUMA_MCP_TRANSPORT: transport },
      stdio: "inherit",
    });
    const [code] = await once(demo, "exit");
    if (code !== 0) throw new Error(`Live ${transport} demo failed; isolated data is in ${dataDir}`);
  }
  const twoFactor = spawn(process.execPath, ["scripts/two-factor-demo.mjs"], {
    env: { ...process.env, KUMA_TEST_URL: url, KUMA_TEST_PASSWORD: password }, stdio: "inherit",
  });
  const [twoFactorCode] = await once(twoFactor, "exit");
  if (twoFactorCode !== 0) throw new Error(`2FA demo failed; isolated data is in ${dataDir}`);
} finally {
  if (kuma.exitCode === null) {
    const exited = once(kuma, "exit");
    kuma.kill();
    await exited;
  }
}
