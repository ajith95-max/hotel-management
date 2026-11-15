import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("local PostgreSQL supports CRUD, uploads, filtering, pagination, and persistent deletion", { timeout: 90000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stayfinder-test-"));
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  let server;
  let output = "";

  async function start() {
    server = spawn(process.execPath, ["server/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "",
        DATABASE_MODE: "",
        PORT: String(port),
        PGLITE_DATA_DIR: path.join(directory, "data"),
        LOCAL_POSTGRES_DIR: path.join(directory, "postgres"),
        UPLOADS_DIR: path.join(directory, "uploads"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => { output += chunk; });
    server.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`Test server failed to start: ${output}`);
  }

  async function stop() {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      const [code] = await once(server, "exit");
      assert.equal(code, 0, `Server did not shut down cleanly: ${output}`);
    }
  }

  async function request(url, options) {
    const response = await fetch(`${base}${url}`, options);
    return { status: response.status, body: await response.json() };
  }

  try {
    await start();
    const initial = await request("/api/hotels?limit=2&offset=2");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.hotels.length, 2);
    assert.equal(initial.body.pagination.offset, 2);
    assert.equal(initial.body.pagination.total, 5);
    assert.equal((await request("/api/hotels?offset=-1")).status, 400);
    assert.equal((await request("/api/hotels?limit=25")).status, 400);
    const category = await request("/api/hotels?hotelType=Resort&roomType=Suite&location=Chennai&rating=4&amenities=Pool,Wi-Fi");
    assert.equal(category.status, 200);
    assert.equal(category.body.pagination.total, 1);
    assert.equal(category.body.hotels[0].title, "Ocean View Resort");
    const sorted = await request("/api/hotels?sort=price_asc");
    assert.deepEqual(sorted.body.hotels.map((hotel) => Number(hotel.price)), [3900, 4500, 5200, 6500, 8500]);
    assert.equal((await request("/api/hotels?favorites=none")).body.pagination.total, 0);
    const favoriteId = sorted.body.hotels[0].id;
    assert.equal((await request(`/api/hotels?favorites=${favoriteId}`)).body.hotels[0].id, favoriteId);
    assert.equal((await request("/api/hotels?sort=invalid")).status, 400);
    assert.equal((await request("/api/hotels?amenities=invalid")).status, 400);

    const invalid = await request("/api/hotels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Test", description: "Test", price: 100 }),
    });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.fields.latitude && invalid.body.fields.longitude);

    const form = new FormData();
    for (const [key, value] of Object.entries({
      title: "Test Hotel", description: "Test hotel description",
      latitude: "13.1", longitude: "80.2", price: "4321", hotelType: "Hotel",
      location: "Chennai", roomType: "Deluxe", rating: "4",
    })) form.append(key, value);
    form.append("amenities", "Wi-Fi");
    form.append("amenities", "Pool");
    const invalidImage = new FormData();
    invalidImage.append("image", new Blob([Buffer.from("not an image")], { type: "image/png" }), "fake.png");
    assert.equal((await request("/api/hotels", { method: "POST", body: invalidImage })).status, 400);
    form.append("image", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j66sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "test.png");
    const created = await request("/api/hotels", { method: "POST", body: form });
    assert.equal(created.status, 201);
    const { id, imageUrl } = created.body.hotel;
    assert.equal((await fetch(`${base}${imageUrl}`)).status, 200);

    const filtered = await request("/api/hotels?search=Test%20Hotel&minPrice=4000&maxPrice=5000");
    assert.equal(filtered.body.pagination.total, 1);
    assert.equal(filtered.body.hotels[0].id, id);
    const updated = await request(`/api/hotels/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated Hotel", description: "Updated description", latitude: 0, longitude: 0, price: 5000 }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.hotel.title, "Updated Hotel");
    assert.equal(updated.body.hotel.imageUrl, imageUrl);
    assert.equal(updated.body.hotel.hotelType, "Hotel");
    assert.equal(updated.body.hotel.location, "Chennai");
    assert.deepEqual(updated.body.hotel.amenities, ["Wi-Fi", "Pool"]);
    assert.equal((await request(`/api/hotels/${id}`)).body.hotel.title, "Updated Hotel");
    const replacement = new FormData();
    for (const [key, value] of Object.entries({
      title: "Updated Hotel", description: "Updated description",
      latitude: "0", longitude: "0", price: "5000",
    })) replacement.append(key, value);
    replacement.append("image", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j66sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "replacement.png");
    const replaced = await request(`/api/hotels/${id}`, { method: "PUT", body: replacement });
    assert.equal(replaced.status, 200);
    assert.notEqual(replaced.body.hotel.imageUrl, imageUrl);
    assert.equal((await fetch(`${base}${imageUrl}`)).status, 404);
    assert.equal((await fetch(`${base}${replaced.body.hotel.imageUrl}`)).status, 200);
    assert.equal((await request(`/api/hotels/${id}`, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(`${base}${replaced.body.hotel.imageUrl}`)).status, 404);
    assert.equal((await request(`/api/hotels/${id}`)).status, 404);

    const all = await request("/api/hotels?limit=24");
    for (const hotel of all.body.hotels) {
      assert.equal((await request(`/api/hotels/${hotel.id}`, { method: "DELETE" })).status, 200);
    }
    await stop();
    await start();
    assert.equal((await request("/api/hotels")).body.pagination.total, 0);
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
