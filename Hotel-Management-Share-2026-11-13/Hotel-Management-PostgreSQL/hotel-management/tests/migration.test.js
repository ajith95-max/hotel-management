import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

for (const withOptionalFields of [false, true]) {
test(`existing embedded hotel records migrate once ${withOptionalFields ? "with" : "without"} optional fields`, { timeout: 90000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stayfinder-migration-"));
  const legacyDir = path.join(directory, "legacy");
  const legacy = new PGlite(legacyDir);
  let server;
  let output = "";
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;

  async function start() {
    server = spawn(process.execPath, ["server/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "",
        DATABASE_MODE: "",
        PORT: String(port),
        PGLITE_DATA_DIR: legacyDir,
        LOCAL_POSTGRES_DIR: path.join(directory, "postgres"),
        UPLOADS_DIR: path.join(directory, "uploads"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => { output += chunk; });
    server.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`API exited: ${output}`);
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`API did not start: ${output}`);
  }

  async function stop() {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      const [code] = await once(server, "exit");
      assert.equal(code, 0, `Server did not shut down cleanly: ${output}`);
    }
  }

  try {
    await legacy.waitReady;
    await legacy.query(`
      CREATE TABLE hotels (
        id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL,
        price NUMERIC(12,2) NOT NULL, image_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    if (withOptionalFields) {
      await legacy.query(`
        ALTER TABLE hotels ADD COLUMN hotel_type TEXT, ADD COLUMN location TEXT,
          ADD COLUMN room_type TEXT, ADD COLUMN rating INTEGER, ADD COLUMN amenities TEXT[]
      `);
    }
    await legacy.query(
      "INSERT INTO hotels (id, title, description, latitude, longitude, price, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [42, "Existing hotel", "Existing description", 13, 80, 1200, "/uploads/existing.png"],
    );
    if (withOptionalFields) {
      await legacy.query(
        "UPDATE hotels SET hotel_type = $1, location = $2, room_type = $3, rating = $4, amenities = $5 WHERE id = 42",
        ["Resort", "Chennai", "Suite", 4, ["Pool", "Wi-Fi"]],
      );
    }
    await legacy.close();

    await start();
    let response = await fetch(`${base}/api/hotels`);
    let body = await response.json();
    assert.equal(body.pagination.total, 1);
    assert.equal(Number(body.hotels[0].id), 42);
    assert.equal(body.hotels[0].imageUrl, "/uploads/existing.png");
    assert.equal(body.hotels[0].hotelType, withOptionalFields ? "Resort" : "");
    assert.equal(body.hotels[0].location, withOptionalFields ? "Chennai" : "");
    assert.equal(body.hotels[0].roomType, withOptionalFields ? "Suite" : "");
    assert.equal(body.hotels[0].rating, withOptionalFields ? 4 : null);
    assert.deepEqual(body.hotels[0].amenities, withOptionalFields ? ["Pool", "Wi-Fi"] : []);
    response = await fetch(`${base}/api/hotels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New hotel", description: "New description", latitude: 0, longitude: 0, price: 2500 }),
    });
    assert.equal(response.status, 201);
    assert.equal(Number((await response.json()).hotel.id), 43);
    await stop();
    await start();
    body = await (await fetch(`${base}/api/hotels`)).json();
    assert.equal(body.pagination.total, 2);
    assert.ok(body.hotels.some((hotel) => hotel.title === "Existing hotel"));
    assert.ok(body.hotels.some((hotel) => hotel.title === "New hotel"));

    const unchangedLegacy = new PGlite(legacyDir);
    try {
      const { rows } = await unchangedLegacy.query("SELECT COUNT(*)::int AS total FROM hotels");
      assert.equal(rows[0].total, 1);
    } finally {
      await unchangedLegacy.close();
    }
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
}
