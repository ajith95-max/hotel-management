import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { migrateLocalCluster } from "../server/local-postgres.js";

test("local PostgreSQL data is copied once without overwriting existing data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stayfinder-copy-"));
  const source = path.join(directory, "old");
  const destination = path.join(directory, "new", "database");
  try {
    await mkdir(path.join(source, "cluster"), { recursive: true });
    await writeFile(path.join(source, "credentials.json"), "original");
    await writeFile(path.join(source, "cluster", "PG_VERSION"), "17");
    await writeFile(path.join(source, "cluster", "data"), "original data");
    await migrateLocalCluster(source, destination);
    assert.equal(await readFile(path.join(destination, "cluster", "data"), "utf8"), "original data");
    await writeFile(path.join(destination, "cluster", "data"), "new data");
    await migrateLocalCluster(source, destination);
    assert.equal(await readFile(path.join(destination, "cluster", "data"), "utf8"), "new data");
    assert.equal(await readFile(path.join(source, "cluster", "data"), "utf8"), "original data");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an incomplete local PostgreSQL cluster is not copied", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stayfinder-copy-"));
  try {
    const source = path.join(directory, "old");
    await mkdir(source);
    await assert.rejects(migrateLocalCluster(source, path.join(directory, "new")), /incomplete/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
