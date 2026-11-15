import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { startLocalPostgres } from "./local-postgres.js";

const { Pool } = pg;
const seedHotels = [
  {
    title: "Grand Palace Hotel",
    description: "Comfortable city hotel with restaurant and business facilities.",
    latitude: 13.0827, longitude: 80.2707, price: 8500,
    hotelType: "Hotel", location: "Chennai", roomType: "Deluxe", rating: 4,
    amenities: ["Wi-Fi", "Restaurant", "Parking"],
    imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=85",
  },
  {
    title: "Ocean View Resort",
    description: "Beachside resort with pool and sea-facing rooms.",
    latitude: 12.9141, longitude: 80.227, price: 6500,
    hotelType: "Resort", location: "Chennai", roomType: "Suite", rating: 4,
    amenities: ["Wi-Fi", "Pool", "Restaurant"],
    imageUrl: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=85",
  },
  {
    title: "City Comfort Inn",
    description: "Affordable accommodation close to city transport.",
    latitude: 13.0569, longitude: 80.2425, price: 4500,
    hotelType: "Inn", location: "Chennai", roomType: "Standard", rating: 3,
    amenities: ["Wi-Fi", "Parking"],
    imageUrl: "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1200&q=85",
  },
  {
    title: "Green Valley Stay",
    description: "Quiet property surrounded by greenery and walking paths.",
    latitude: 11.0168, longitude: 76.9558, price: 5200,
    hotelType: "Hotel", location: "Coimbatore", roomType: "Deluxe", rating: 4,
    amenities: ["Wi-Fi", "Parking"],
    imageUrl: "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=85",
  },
  {
    title: "Airport Residency",
    description: "Convenient hotel for travellers needing airport access.",
    latitude: 12.9941, longitude: 80.1709, price: 3900,
    hotelType: "Hotel", location: "Chennai", roomType: "Standard", rating: 3,
    amenities: ["Wi-Fi", "Restaurant"],
    imageUrl: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=85",
  },
];

let client;
let pool;
let localPostgres;

async function readLegacyHotels() {
  const directory = path.resolve(process.env.PGLITE_DATA_DIR || "data");
  try {
    await access(path.join(directory, "PG_VERSION"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const legacy = new PGlite(directory);
  try {
    await legacy.waitReady;
    const result = await legacy.query(
      "SELECT * FROM hotels ORDER BY id",
    );
    return result.rows;
  } finally {
    await legacy.close();
  }
}

export async function initializeDatabase() {
  try {
    if (process.env.DATABASE_URL) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      pool.on("error", (error) => console.error("PostgreSQL connection error:", error.message));
      client = { query: (sql, values) => pool.query(sql, values) };
      await client.query("SELECT 1");
      console.info("Using PostgreSQL from DATABASE_URL.");
    } else if (process.env.DATABASE_MODE === "pglite") {
      const dataDirectory = path.resolve(process.env.PGLITE_DATA_DIR || "data");
      await mkdir(dataDirectory, { recursive: true });
      const embedded = new PGlite(dataDirectory);
      await embedded.waitReady;
      client = { query: (sql, values) => embedded.query(sql, values) };
      client.close = () => embedded.close();
      console.info("Using legacy embedded database.");
    } else {
      const local = await startLocalPostgres();
      localPostgres = local.postgres;
      pool = new Pool(local.connection);
      pool.on("error", (error) => console.error("PostgreSQL connection error:", error.message));
      client = { query: (sql, values) => pool.query(sql, values) };
      await client.query("SELECT 1");
      console.info("Using a local PostgreSQL server.");
    }

    await client.query(`
    CREATE TABLE IF NOT EXISTS hotels (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      price NUMERIC(12, 2) NOT NULL CHECK (price > 0),
      image_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await client.query(`
      ALTER TABLE hotels
        ADD COLUMN IF NOT EXISTS hotel_type TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS room_type TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS rating INTEGER,
        ADD COLUMN IF NOT EXISTS amenities TEXT[] NOT NULL DEFAULT '{}'
    `);

    await client.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY
    )
  `);
    const initialized = await client.query(
      "SELECT key FROM app_settings WHERE key = $1",
      ["sample_data_initialized"],
    );
    const { rows } = await client.query("SELECT COUNT(*)::int AS total FROM hotels");
    if (initialized.rows.length === 0) {
      const legacyHotels = localPostgres && rows[0].total === 0 ? await readLegacyHotels() : null;
      const transaction = pool ? await pool.connect() : null;
      const target = transaction || client;
      try {
        await target.query("BEGIN");
        if (legacyHotels) {
          for (const hotel of legacyHotels) {
            await target.query(
              `INSERT INTO hotels (id, title, description, latitude, longitude, price, image_url, created_at, updated_at,
                hotel_type, location, room_type, rating, amenities)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [hotel.id, hotel.title, hotel.description, hotel.latitude, hotel.longitude,
                hotel.price, hotel.image_url, hotel.created_at, hotel.updated_at,
                hotel.hotel_type ?? "", hotel.location ?? "", hotel.room_type ?? "",
                hotel.rating ?? null, hotel.amenities ?? []],
            );
          }
          await target.query(
            "SELECT setval(pg_get_serial_sequence('hotels', 'id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM hotels",
          );
          console.info(`Migrated ${legacyHotels.length} existing hotel records to PostgreSQL.`);
        } else if (rows[0].total === 0) {
          for (const hotel of seedHotels) {
            await target.query(
              `INSERT INTO hotels (title, description, latitude, longitude, price, image_url,
                hotel_type, location, room_type, rating, amenities)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [hotel.title, hotel.description, hotel.latitude, hotel.longitude, hotel.price, hotel.imageUrl,
                hotel.hotelType, hotel.location, hotel.roomType, hotel.rating, hotel.amenities],
            );
          }
        }
        await target.query(
          "INSERT INTO app_settings (key) VALUES ($1) ON CONFLICT DO NOTHING",
          ["sample_data_initialized"],
        );
        await target.query("COMMIT");
      } catch (error) {
        await target.query("ROLLBACK");
        throw error;
      } finally {
        transaction?.release();
      }
    }
  } catch (error) {
    await database.close();
    throw error;
  }
}

export const database = {
  query(sql, values) {
    if (!client) throw new Error("Database has not been initialized.");
    return client.query(sql, values);
  },
  async close() {
    if (pool) {
      await pool.end();
      pool = undefined;
    } else if (client?.close) {
      await client.close();
    }
    if (localPostgres) {
      await localPostgres.stop();
      localPostgres = undefined;
    }
    client = undefined;
  },
};
