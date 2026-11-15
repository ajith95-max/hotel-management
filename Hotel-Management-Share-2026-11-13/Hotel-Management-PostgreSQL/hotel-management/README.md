# Stayfinder

A responsive hotel listing app with hotel creation, editing, search, price filtering, pagination, image uploads, hotel detail pages, and a map view.

The frontend uses React, Redux Toolkit, React Router and React Helmet. The backend uses Node.js, Express, parameterized native SQL and PostgreSQL.

## Run locally

Requirements: Node.js 20 or newer, npm, and internet access for the initial dependency installation. Use a standard (non-root) user account. PostgreSQL binaries are downloaded automatically for supported macOS, Windows, and Linux systems.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs at `http://localhost:4000`.

The app starts with the five illustrative hotels from the workbook on a fresh database. Their extra categories, ratings and amenities are example values, not verified hotel information. Existing databases and hotels are preserved; their new optional fields can be added by editing them. The first launch initializes PostgreSQL and can take a little longer. The app automatically starts a separate local PostgreSQL server when the API starts and stops it when the API stops. No separate PostgreSQL installation, manual database creation, Docker, or login is needed. PostgreSQL runs on a private local port and stores its files in the operating system's local application-data directory (under `Stayfinder/`), rather than in a potentially cloud-synced project folder. Each extracted project location gets its own database. A random database password is generated locally; the credentials and database are excluded from the shareable ZIP. Uploaded images are stored in `uploads/`, also excluded from the ZIP. Existing hotels from the previous embedded database are copied once on first startup; the original `data/` directory remains untouched.

The ZIP contains source code rather than installed dependencies or personal data. After extracting it, run the two commands above in the extracted `hotel-management` folder. Each person gets a fresh database and sample records. To stop the app, press `Ctrl+C` in the terminal.

To use an existing PostgreSQL server instead, create a database, copy `.env.example` to `.env`, set `DATABASE_URL`, and start the app. The API uses parameterized native SQL queries in either mode. Each configured database has its own data.

## Build and run the production app

```bash
npm run build
npm start
```

The production server serves the app and API from `http://localhost:4000`.

## Test

```bash
npm test
npm run build
```

The API tests start separate local servers and isolated temporary PostgreSQL databases. They do not modify your existing hotels. PostgreSQL does not permit running its server as root; run the tests as an ordinary user.

## API

- `GET /api/hotels?search=hotel&minPrice=1000&maxPrice=5000&limit=6&offset=0` lists filtered results; `page` is also supported.
- `GET /api/hotels/:id` returns a hotel.
- `POST /api/hotels` creates a hotel.
- `PUT /api/hotels/:id` updates a hotel.
- `DELETE /api/hotels/:id` deletes a hotel and its locally uploaded image.

Create and update accept `multipart/form-data` fields `title`, `description`, `latitude`, `longitude`, `price` and an optional `image` file. Optional hotel attributes are `hotelType` (Hotel, Resort or Inn), `location`, `roomType` (Standard, Deluxe or Suite), `rating` (1–5), and repeated `amenities` (Wi-Fi, Pool, Restaurant or Parking). To clear all amenities, send an empty `amenities` field. Latitude must be between -90 and 90, longitude between -180 and 180, and price greater than zero. Sample records are initialized once; deleting all hotels will not recreate them on restart.

The list endpoint also supports `hotelType`, `location`, `roomType`, minimum `rating`, comma-separated `amenities`, `favorites` (comma-separated hotel IDs, or `none`), and `sort` (`newest`, `name`, `price_asc`, or `price_desc`). Filters are combined and pagination is performed by the database.

## Features

- Responsive hotel cards, title search, price range filters, and server-side pagination
- Blue category banner, breadcrumbs, desktop filter sidebar and mobile-friendly stacked layout
- Optional hotel type, location, room type, rating and amenity filters, list/grid views, and name/price sorting
- Browser-local favourites and About, Contact and Support pages (contact details are not configured)
- Shared create/edit form with image preview and validation
- Hotel details with coordinate map, dynamic page metadata, and accessible image descriptions
- REST API backed by PostgreSQL-compatible SQL
- Image uploads limited to JPG, PNG, and WebP files up to 5 MB, with file-signature checks

Sample hotel entries and their coordinates are illustrative demo data. The map uses OpenStreetMap, and sample photos and fonts load from external services.
The map uses the hotel's saved coordinates. The optional distance button asks for browser geolocation permission and calculates straight-line distance locally; the hotel map still works when permission is denied.

This is a local demonstration app with no authentication; do not expose it publicly without adding appropriate access controls, upload validation, and deployment hardening.
