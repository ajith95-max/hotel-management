import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import EmbeddedPostgres from "embedded-postgres";

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("the API works with a native PostgreSQL server", { timeout: 90000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stayfinder-postgres-"));
  const postgresPort = await availablePort();
  const apiPort = await availablePort();
  const password = randomBytes(24).toString("hex");
  const postgres = new EmbeddedPostgres({
    databaseDir: path.join(directory, "database"),
    user: "hotel_test",
    password,
    port: postgresPort,
    persistent: true,
    onLog: () => {},
    onError: (message) => console.error(message),
  });
  let postgresStarted = false;
  let api;
  let output = "";
  try {
    await postgres.initialise();
    await postgres.start();
    postgresStarted = true;
    await postgres.createDatabase("hotel_test");
    const connection = `postgresql://hotel_test:${password}@127.0.0.1:${postgresPort}/hotel_test`;
    api = spawn(process.execPath, ["server/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: connection,
        PORT: String(apiPort),
        UPLOADS_DIR: path.join(directory, "uploads"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    api.stdout.on("data", (chunk) => { output += chunk; });
    api.stderr.on("data", (chunk) => { output += chunk; });
    const base = `http://127.0.0.1:${apiPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (api.exitCode !== null) throw new Error(`API exited: ${output}`);
      try {
        ready = (await fetch(`${base}/api/health`)).ok;
        if (ready) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(ready, `API failed to start: ${output}`);

    const response = await fetch(`${base}/api/hotels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Native PostgreSQL Test", description: "Test record", latitude: 13, longitude: 80, price: 2500 }),
    });
    assert.equal(response.status, 201);
    const { hotel } = await response.json();
    const client = postgres.getPgClient("hotel_test", "127.0.0.1");
    await client.connect();
    try {
      const version = await client.query("SELECT version() AS version");
      assert.match(version.rows[0].version, /^PostgreSQL /);
      const record = await client.query("SELECT title FROM hotels WHERE id = $1", [hotel.id]);
      assert.equal(record.rows[0].title, "Native PostgreSQL Test");
    } finally {
      await client.end();
    }
    const filtered = await fetch(`${base}/api/hotels?search=Native&limit=1&offset=0`);
    assert.equal((await filtered.json()).pagination.total, 1);
    assert.equal((await fetch(`${base}/api/hotels/${hotel.id}`, { method: "DELETE" })).status, 200);
  } finally {
    if (api && api.exitCode === null) {
      api.kill("SIGTERM");
      const [code] = await once(api, "exit");
      assert.equal(code, 0, `API did not shut down cleanly: ${output}`);
    }
    if (postgresStarted) await postgres.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
