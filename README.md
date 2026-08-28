# PinkTrip

PinkTrip is a polished travel-planning demo based on the attached product idea. A traveler chooses a destination, dates, interests, intensity and budget; the app recommends local places, generates a believable day-by-day itinerary, calculates a budget, and lets the traveler save and edit the result.

The prototype intentionally uses local JSON files instead of a database. It includes Vĩnh Hy, Đà Lạt and Hà Nội seed data, with attractions, hidden gems, restaurants, cafés, accommodation and sample reviews.

## Run locally

Requires Node.js 20+.

```bash
npm run reset-data
npm run build
npm start
```

Open <http://localhost:3000>. During development, use `npm run dev` for Node's file watcher.

Create an account from the UI. Passwords are stored as scrypt hashes; sessions are HTTP-only cookies. `npm run reset-data` restores the original plans, users, sessions and reviews from `data/seed`.

## Run with Docker

```bash
docker compose up --build
```

The host `./data` directory is mounted into the container, so saved plans and reviews persist across container restarts. For a hosted demo, use a long-running Node container or VM with a persistent volume mounted at `/app/data`; stateless serverless hosting is not suitable for this JSON-write prototype.

## Architecture

The app is deliberately small and dependency-free so another person can run it with one command:

```text
Browser SPA (public/app.js)
        ↓ fetch /api
HTTP route handlers (src/server.js)
        ↓
Domain services (recommendations, itinerary, budget, ratings)
        ↓
Repository interfaces (PlanRepository, ReviewRepository, UserRepository, CollectionRepository)
        ↓
JsonStore (atomic writes + serialized per-file queue)
        ↓
data/*.json
```

The UI does not read or write files. Replacing `JsonStore` repositories with Postgres-backed implementations would leave the domain services and API contracts intact. Authentication is kept in `src/infrastructure/auth.js`; password hashing, cookie sessions and ownership checks are server-side.

## Main API

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/destinations`, `/api/places`, `/api/services`, `/api/reviews`
- `POST /api/reviews`, `PUT/DELETE /api/reviews/:id`
- `GET /api/plans`, `POST /api/plans`, `GET/PUT/DELETE /api/plans/:id`
- `POST /api/plans/generate` for an unsaved itinerary preview

## Test

```bash
npm run lint
npm run build
npm test
```

Tests cover recommendation ranking, itinerary dates/intensity, budget calculations, password verification, JSON repository CRUD, plan ownership, and the complete review HTTP flow.

## Place data and long trips

The seed data uses the existing `Place` shape with a primary `category`, plus compatible `categories`, `area`, and `areaLabel` metadata for discovery and scheduling. It currently contains 137 schedulable places:

- Hà Nội: 45 places across heritage, food, museums, lakes, neighbourhood walks, craft villages, and day excursions.
- Vĩnh Hy base / nearby Ninh Thuận: 47 places across bays, beaches, villages, vineyards, culture, and clearly labelled excursions.
- Đà Lạt: 45 places across lakes, falls, forests, cultural sites, cafés, gardens, farms, and day excursions.

Step 2 applies interest filters across all compatible categories, supports a name/area search, preserves selections when filters hide them, and reveals results in small batches. The itinerary generator keeps each place unique, groups a day's stops by `area` when possible, uses an explicit travel-time entry when available, and otherwise uses a deterministic same-area/cross-area demo estimate. It honours the selected list first and keeps each daily schedule inside the demo day window. `test/place-data.test.js` verifies data integrity and 10-day relaxed, balanced, and packed itineraries for all three destinations.

## Reviews and ratings

A review always belongs to a destination and can optionally belong to one of that destination's places. Omitting `placeId` represents a general destination experience; providing it creates a place-specific review. The server validates that a submitted place exists and belongs to the selected destination, accepts ratings only from 1 to 5, and allows one active review per user for each destination or place target.

Place-card ratings are derived from place-specific reviews only, so a general destination review never changes an individual attraction's score. `GET /api/places` and `GET /api/destinations` include efficient `ratingSummaries` maps for all returned entities, while `GET /api/reviews?placeId=…` includes the selected place's summary and rating distribution. Older review JSON records without `placeId` remain valid destination-level reviews.

The public review browser uses `GET /api/reviews` with optional `destinationId`, `placeId`, `rating`, `sort` (`newest`, `oldest`, `highest`, `lowest`), `page`, and `pageSize` parameters. The response always returns the requested page in `reviews`, a full filtered `ratingSummary` and `ratingDistribution`, and `pagination` metadata. Results are sorted deterministically and out-of-range pages are safely clamped. Contextual surfaces request only three recent review previews; `/reviews` requests ten at a time with URL-backed filters and pagination.

## Product flow demonstrated

1. Browse destinations or start a new trip.
2. Register/login.
3. Set dates, travelers, budget and pace.
4. Select interests and attractions, including hidden gems.
5. Generate an itinerary with time slots, duration, notes and budget breakdown.
6. Add/remove stops, reorder items, change start time and duration.
7. Save, reopen, edit or delete a personal trip.
8. Browse local services, inspect place ratings in Step 2, and leave a destination or place-specific review.

## Prototype tradeoffs

JSON persistence is easy to inspect, reset and share, but it is not a production database: it is single-process, has limited query capability, and should run on persistent storage. The weather provider is represented by seeded destination weather text rather than a hard external API dependency. Travel time is likewise seeded so a real maps provider can replace it later.
