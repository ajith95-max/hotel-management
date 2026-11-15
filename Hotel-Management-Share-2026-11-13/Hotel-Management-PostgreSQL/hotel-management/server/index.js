import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, open, unlink } from "node:fs/promises";
import crypto from "node:crypto";
import "dotenv/config";
import exitHook from "async-exit-hook";
import express from "express";
import multer from "multer";
import { database, initializeDatabase } from "./database.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(serverDirectory, "..");
const uploadsDirectory = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(projectDirectory, "uploads");
const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const maximumPageSize = 24;
const hotelTypes = ["Hotel", "Resort", "Inn"];
const roomTypes = ["Standard", "Deluxe", "Suite"];
const amenityOptions = ["Wi-Fi", "Pool", "Restaurant", "Parking"];
const app = express();

await mkdir(uploadsDirectory, { recursive: true });
await initializeDatabase();
exitHook.unhookEvent("SIGINT");
exitHook.unhookEvent("SIGTERM");
if (process.platform === "win32") exitHook.unhookEvent("SIGBREAK");

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadsDirectory),
    filename: (_request, file, callback) =>
      callback(null, `${crypto.randomUUID()}${allowedImageTypes.get(file.mimetype)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new Error("Upload a JPG, PNG, or WebP image."));
      return;
    }
    callback(null, true);
  },
});

app.use(express.json({ limit: "100kb" }));
app.use("/uploads", express.static(uploadsDirectory));

function validateHotel(body) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const hasLatitude = body.latitude !== undefined && String(body.latitude).trim() !== "";
  const hasLongitude = body.longitude !== undefined && String(body.longitude).trim() !== "";
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const price = Number(body.price);
  const hotelType = body.hotelType ?? "";
  const location = body.location ?? "";
  const roomType = body.roomType ?? "";
  const rating = body.rating === undefined || body.rating === null || body.rating === "" ? null : Number(body.rating);
  const amenities = body.amenities === undefined || body.amenities === "" ? []
    : Array.isArray(body.amenities) ? body.amenities : [body.amenities];
  const errors = {};

  if (!title || title.length > 120) {
    errors.title = "Enter a hotel name (up to 120 characters).";
  }
  if (!description || description.length > 2000) {
    errors.description = "Enter a description (up to 2,000 characters).";
  }
  if (!hasLatitude || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.latitude = "Latitude must be between -90 and 90.";
  }
  if (!hasLongitude || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.longitude = "Longitude must be between -180 and 180.";
  }
  if (!Number.isFinite(price) || price <= 0 || price > 100000000) {
    errors.price = "Enter a price greater than 0 and no more than 100,000,000.";
  }
  if (typeof hotelType !== "string" || (hotelType && !hotelTypes.includes(hotelType))) errors.hotelType = "Choose a valid hotel type.";
  if (typeof location !== "string" || location.length > 120) errors.location = "Location must be at most 120 characters.";
  if (typeof roomType !== "string" || (roomType && !roomTypes.includes(roomType))) errors.roomType = "Choose a valid room type.";
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) errors.rating = "Choose a rating from 1 to 5.";
  if (amenities.some((item) => typeof item !== "string" || !amenityOptions.includes(item))) errors.amenities = "Choose valid amenities.";
  return { errors, hotel: { title, description, latitude, longitude, price, hotelType, location, roomType, rating, amenities } };
}

function parseBound(value) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function isValidHotelId(id) {
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
}

async function validateImage(file) {
  if (!file) return true;
  const handle = await open(file.path, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (file.mimetype === "image/png") {
      return bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (file.mimetype === "image/jpeg") {
      return bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }
    return bytesRead >= 12 && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
  } finally {
    await handle.close();
  }
}

async function removeUploadedFile(filePath) {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function removeStoredImage(imageUrl) {
  if (!imageUrl?.startsWith("/uploads/")) return;
  await removeUploadedFile(path.join(uploadsDirectory, path.basename(imageUrl)));
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/hotels", async (request, response, next) => {
  try {
    const parseInteger = (value, fallback) =>
      value === undefined ? fallback : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    const pageSize = parseInteger(request.query.limit, 6);
    const requestedPage = parseInteger(request.query.page, 1);
    const offset = parseInteger(request.query.offset, (requestedPage - 1) * pageSize);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maximumPageSize ||
        !Number.isSafeInteger(requestedPage) || requestedPage < 1 ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) {
      response.status(400).json({ error: `Use a positive page, an offset of 0 or greater, and a limit between 1 and ${maximumPageSize}.` });
      return;
    }
    const page = Math.floor(offset / pageSize) + 1;
    const search =
      typeof request.query.search === "string"
        ? request.query.search.trim().slice(0, 120)
        : "";
    const minPrice = parseBound(request.query.minPrice);
    const maxPrice = parseBound(request.query.maxPrice);
    if (Number.isNaN(minPrice) || Number.isNaN(maxPrice)) {
      response.status(400).json({ error: "Prices must be valid non-negative numbers." });
      return;
    }
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      response.status(400).json({ error: "Minimum price cannot exceed maximum price." });
      return;
    }
    const hotelType = request.query.hotelType || "";
    const location = request.query.location || "";
    const roomType = request.query.roomType || "";
    const rating = request.query.rating || "";
    const amenities = request.query.amenities ? String(request.query.amenities).split(",") : [];
    const favoriteIds = request.query.favorites === undefined ? null
      : request.query.favorites === "none" ? [] : String(request.query.favorites).split(",");
    const sorts = { newest: "created_at DESC, id DESC", name: "title ASC, id DESC",
      price_asc: "price ASC, id DESC", price_desc: "price DESC, id DESC" };
    const sort = request.query.sort || "newest";
    if (typeof hotelType !== "string" || (hotelType && !hotelTypes.includes(hotelType)) ||
        typeof location !== "string" || location.length > 120 ||
        typeof roomType !== "string" || (roomType && !roomTypes.includes(roomType)) ||
        (rating && !["1", "2", "3", "4", "5"].includes(rating)) ||
        amenities.some((item) => !amenityOptions.includes(item)) ||
        (favoriteIds && (favoriteIds.length > 1000 || favoriteIds.some((id) => !isValidHotelId(id)))) ||
        typeof sort !== "string" || !Object.hasOwn(sorts, sort)) {
      response.status(400).json({ error: "Invalid hotel filters or sort order." });
      return;
    }

    const conditions = [];
    const values = [];
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`title ILIKE $${values.length}`);
    }
    if (minPrice !== null) {
      values.push(minPrice);
      conditions.push(`price >= $${values.length}`);
    }
    if (maxPrice !== null) {
      values.push(maxPrice);
      conditions.push(`price <= $${values.length}`);
    }
    if (hotelType) { values.push(hotelType); conditions.push(`hotel_type = $${values.length}`); }
    if (location) { values.push(`%${location}%`); conditions.push(`location ILIKE $${values.length}`); }
    if (roomType) { values.push(roomType); conditions.push(`room_type = $${values.length}`); }
    if (rating) { values.push(Number(rating)); conditions.push(`rating >= $${values.length}`); }
    if (amenities.length) { values.push(amenities); conditions.push(`amenities @> $${values.length}::text[]`); }
    if (favoriteIds) { values.push(favoriteIds); conditions.push(`id = ANY($${values.length}::bigint[])`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await database.query(
      `SELECT COUNT(*)::int AS total FROM hotels ${where}`,
      values,
    );
    const total = countResult.rows[0].total;
    const listValues = [...values, pageSize, offset];
    const hotels = await database.query(
      `SELECT id, title, description, latitude, longitude, price, image_url AS "imageUrl",
              created_at AS "createdAt", updated_at AS "updatedAt", hotel_type AS "hotelType",
              location, room_type AS "roomType", rating, amenities
       FROM hotels ${where}
       ORDER BY ${sorts[sort]}
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    response.json({
      hotels: hotels.rows,
      pagination: { page, pageSize, offset, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/hotels/:id", async (request, response, next) => {
  try {
    if (!isValidHotelId(request.params.id)) {
      response.status(400).json({ error: "Hotel id must be a positive integer." });
      return;
    }
    const result = await database.query(
      `SELECT id, title, description, latitude, longitude, price, image_url AS "imageUrl",
              created_at AS "createdAt", updated_at AS "updatedAt", hotel_type AS "hotelType",
              location, room_type AS "roomType", rating, amenities
       FROM hotels WHERE id = $1`,
      [request.params.id],
    );
    if (!result.rows[0]) {
      response.status(404).json({ error: "Hotel not found." });
      return;
    }
    response.json({ hotel: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/hotels", upload.single("image"), async (request, response, next) => {
  try {
    if (!(await validateImage(request.file))) {
      await removeUploadedFile(request.file.path);
      response.status(400).json({ error: "The uploaded file is not a valid JPG, PNG, or WebP image." });
      return;
    }
    const { errors, hotel } = validateHotel(request.body);
    if (Object.keys(errors).length) {
      await removeUploadedFile(request.file?.path);
      response.status(400).json({ error: "Check the highlighted fields.", fields: errors });
      return;
    }
    const result = await database.query(
      `INSERT INTO hotels (title, description, latitude, longitude, price, image_url, hotel_type, location, room_type, rating, amenities)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, title, description, latitude, longitude, price,
                 image_url AS "imageUrl", created_at AS "createdAt", updated_at AS "updatedAt",
                 hotel_type AS "hotelType", location, room_type AS "roomType", rating, amenities`,
      [
        hotel.title,
        hotel.description,
        hotel.latitude,
        hotel.longitude,
        hotel.price,
        request.file ? `/uploads/${request.file.filename}` : null,
        hotel.hotelType, hotel.location, hotel.roomType, hotel.rating, hotel.amenities,
      ],
    );
    response.status(201).json({ hotel: result.rows[0] });
  } catch (error) {
    if (request.file) await removeUploadedFile(request.file.path);
    next(error);
  }
});

app.put("/api/hotels/:id", upload.single("image"), async (request, response, next) => {
  try {
    if (!isValidHotelId(request.params.id)) {
      await removeUploadedFile(request.file?.path);
      response.status(400).json({ error: "Hotel id must be a positive integer." });
      return;
    }
    if (!(await validateImage(request.file))) {
      await removeUploadedFile(request.file.path);
      response.status(400).json({ error: "The uploaded file is not a valid JPG, PNG, or WebP image." });
      return;
    }
    const previous = await database.query(
      `SELECT image_url, hotel_type AS "hotelType", location, room_type AS "roomType", rating, amenities
       FROM hotels WHERE id = $1`,
      [request.params.id],
    );
    if (!previous.rows[0]) {
      await removeUploadedFile(request.file?.path);
      response.status(404).json({ error: "Hotel not found." });
      return;
    }
    const { errors, hotel } = validateHotel({ ...previous.rows[0], ...request.body });
    if (Object.keys(errors).length) {
      await removeUploadedFile(request.file?.path);
      response.status(400).json({ error: "Check the highlighted fields.", fields: errors });
      return;
    }
    const imageUrl = request.file
      ? `/uploads/${request.file.filename}`
      : previous.rows[0].image_url;
    const result = await database.query(
      `UPDATE hotels
       SET title = $1, description = $2, latitude = $3, longitude = $4,
           price = $5, image_url = $6, updated_at = NOW(), hotel_type = $7,
           location = $8, room_type = $9, rating = $10, amenities = $11
       WHERE id = $12
       RETURNING id, title, description, latitude, longitude, price,
                 image_url AS "imageUrl", created_at AS "createdAt", updated_at AS "updatedAt",
                 hotel_type AS "hotelType", location, room_type AS "roomType", rating, amenities`,
      [
        hotel.title,
        hotel.description,
        hotel.latitude,
        hotel.longitude,
        hotel.price,
        imageUrl,
        hotel.hotelType, hotel.location, hotel.roomType, hotel.rating, hotel.amenities,
        request.params.id,
      ],
    );
    let warning;
    if (request.file) {
      try {
        await removeStoredImage(previous.rows[0].image_url);
      } catch (error) {
        console.error("Could not remove the replaced hotel image:", error);
        warning = "The hotel was saved, but its previous uploaded image could not be removed.";
      }
    }
    response.json({ hotel: result.rows[0], warning });
  } catch (error) {
    if (request.file) await removeUploadedFile(request.file.path);
    next(error);
  }
});

app.delete("/api/hotels/:id", async (request, response, next) => {
  try {
    if (!isValidHotelId(request.params.id)) {
      response.status(400).json({ error: "Hotel id must be a positive integer." });
      return;
    }
    const result = await database.query(
      `DELETE FROM hotels WHERE id = $1 RETURNING id, image_url AS "imageUrl"`,
      [request.params.id],
    );
    if (!result.rows[0]) {
      response.status(404).json({ error: "Hotel not found." });
      return;
    }
    let warning;
    try {
      await removeStoredImage(result.rows[0].imageUrl);
    } catch (error) {
      console.error("Could not remove the deleted hotel's image:", error);
      warning = "The hotel was deleted, but its uploaded image could not be removed.";
    }
    response.json({ deleted: true, warning });
  } catch (error) {
    next(error);
  }
});

if (process.env.NODE_ENV === "production" || process.argv.includes("--production")) {
  app.use(express.static(path.join(projectDirectory, "dist")));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(projectDirectory, "dist", "index.html"));
  });
}

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image must be 5 MB or smaller."
        : "The image upload could not be processed.";
    response.status(400).json({ error: message });
    return;
  }
  if (error.message === "Upload a JPG, PNG, or WebP image.") {
    response.status(400).json({ error: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "Something went wrong. Please try again." });
});

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, "127.0.0.1", () => {
  console.info(`Hotel API listening on http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close(async () => {
    try {
      await database.close();
      process.exit(0);
    } catch (error) {
      console.error("Failed to shut down the database:", error);
      process.exit(1);
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.platform === "win32") process.on("SIGBREAK", shutdown);
