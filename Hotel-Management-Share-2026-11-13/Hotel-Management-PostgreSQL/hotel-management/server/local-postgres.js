import { createHash, randomBytes } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function findAvailablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

function defaultDatabaseDirectory() {
  const home = os.homedir();
  const base = process.platform === "darwin"
    ? path.join(home, "Library", "Application Support")
    : process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
      : process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const projectId = createHash("sha256").update(path.resolve(".")).digest("hex").slice(0, 20);
  return path.join(base, "Stayfinder", projectId);
}

export async function migrateLocalCluster(source, destination) {
  if (await exists(destination) || !(await exists(source))) return;
  if (!(await exists(path.join(source, "credentials.json"))) ||
      !(await exists(path.join(source, "cluster", "PG_VERSION")))) {
    throw new Error("The existing PostgreSQL data is incomplete; it was not changed.");
  }
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(path.dirname(destination), "migration-"));
  const copied = path.join(staging, "postgres");
  await cp(source, copied, { recursive: true, errorOnExist: true, force: false });
  await rename(copied, destination);
  await rmdir(staging);
  console.info("Copied existing PostgreSQL data to local application storage.");
}

export async function startLocalPostgres() {
  const root = process.env.LOCAL_POSTGRES_DIR
    ? path.resolve(process.env.LOCAL_POSTGRES_DIR)
    : defaultDatabaseDirectory();
  if (!process.env.LOCAL_POSTGRES_DIR) {
    await migrateLocalCluster(path.resolve("postgres-data"), root);
  }
  const cluster = path.join(root, "cluster");
  const configPath = path.join(root, "credentials.json");
  const initialized = await exists(path.join(cluster, "PG_VERSION"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  let credentials;
  if (await exists(configPath)) {
    credentials = JSON.parse(await readFile(configPath, "utf8"));
    if (typeof credentials.user !== "string" || typeof credentials.password !== "string" ||
        !credentials.user || !credentials.password) {
      throw new Error("Local PostgreSQL credentials are invalid.");
    }
  } else {
    if (initialized) throw new Error("Local PostgreSQL credentials are missing; the existing database was not changed.");
    credentials = { user: "hotel_app", password: randomBytes(32).toString("hex") };
    await writeFile(configPath, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
  }

  const port = await findAvailablePort();
  const postgres = new EmbeddedPostgres({
    databaseDir: cluster,
    user: credentials.user,
    password: credentials.password,
    port,
    authMethod: "scram-sha-256",
    persistent: true,
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
    onLog: (message) => {
      if (/error|fatal|panic/i.test(message)) console.error("PostgreSQL:", message.trim());
    },
    onError: (message) => console.error("PostgreSQL:", message),
  });

  if (!initialized) {
    const previousUmask = process.umask(0o077);
    try {
      await postgres.initialise();
    } finally {
      process.umask(previousUmask);
    }
  }
  await postgres.start();
  return {
    postgres,
    connection: {
      host: "127.0.0.1",
      port,
      database: "postgres",
      user: credentials.user,
      password: credentials.password,
    },
  };
}
