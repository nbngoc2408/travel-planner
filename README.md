# PinkTrip

PinkTrip is a polished travel-planning demo based on the attached product idea. A traveler chooses a destination, dates, interests, intensity and budget; the app recommends local places, generates a believable day-by-day itinerary, calculates a budget, and lets the traveler save and edit the result.

The prototype intentionally uses local JSON files instead of a database. It includes Vĩnh Hy, Đà Lạt and Hà Nội seed data, with attractions, restaurants, cafés, accommodation and sample reviews.

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
- `POST /api/inspiration/resolve` resolves a pasted travel link before it can be added to a trip

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
- Đà Lạt: 47 places across lakes, falls, forests, cultural sites, cafés, gardens, farms, and day excursions.

Step 2 applies interest filters across all compatible categories, supports a name/area search, preserves selections when filters hide them, and reveals results in small batches. The itinerary generator keeps each place unique, groups a day's stops by `area` when possible, uses an explicit travel-time entry when available, and otherwise uses a deterministic same-area/cross-area demo estimate. It honours the selected list first and keeps each daily schedule inside the demo day window. `test/place-data.test.js` verifies data integrity and 10-day relaxed, balanced, and packed itineraries for all three destinations.

## Itinerary workspace UX

The itinerary is intentionally structured as an overview followed by daily detail, rather than one continuous editable list. The overview shows trip dates, travelers, pace, stop count, average stops per active day, budget, and a horizontally scrollable summary of every day. Each day summary names the planned stops and the area sequence already present in PinkTrip's place data. A sticky day navigator makes 2–10-day schedules quick to inspect on both desktop and mobile, while a compact mode removes editing controls until the user asks for detail again.

The implementation was informed by focused research before the redesign: Wanderlog documents separate daily-itinerary and map/route views, and TripIt emphasizes one consolidated itinerary; both support the choice to make overall trip shape visible before detail. NN/g's guidance on in-page links and sticky headers informed the current-location day chips, anchors with scroll offsets, and restrained persistent utility controls. Sources: [Wanderlog Help Center](https://help.wanderlog.com/hc/en-us), [TripIt](https://www.tripit.com/web/free), and [NN/g on in-page links](https://www.nngroup.com/articles/in-page-links/).

PinkTrip does not currently store coordinates, addresses, or map geometry for its canonical places, and has no map runtime. We therefore rejected a decorative or guessed map, as it would misrepresent the data. The area-route summaries are connected to the actual scheduled items and offer a truthful lightweight geographic cue. We also rejected a permanently expanded dashboard of statistics and a separate nested itinerary navigation: the compact overview, one sticky day strip, and progressive detail keep the workspace readable.

### Timeline and reset semantics

The daily timeline uses a dedicated time column, a connected stop rail, and an explicit “Khoảng chuyển tiếp” only when the existing scheduled timestamps expose a gap. It does not invent travel durations; the model does not expose travel legs separately. On small screens the time becomes a readable inline range above the stop content, while edit controls remain below it.

“Đặt lại lịch trình” means **restore the last saved baseline**, never regenerate recommendations. Creating a new generated draft establishes its first baseline; loading a saved trip restores its persisted baseline; saving, including an applied replan that is saved, establishes a new baseline. Reordering, changing duration/time, moving across days, and removing stops only change the editable current itinerary. Reset clones the baseline back into current state, so it also restores derived day summaries and budget without changing trip inputs or the user’s Step 2/Inspiration selections.

## Inspiration links

The optional Inspiration step accepts a travel link and resolves it deterministically from `data/inspiration-links.json`; it does not scrape social platforms or call third-party APIs. A mapping either points at an existing canonical `Place` through `catalogPlaceId`, or stores only recognized display metadata in `resolved` when the place is outside PinkTrip's catalog. The latter is returned as an unavailable result and never creates a destination, place, itinerary stop, or persisted inspiration item.

The application catalog remains the three original destination records: Vĩnh Hy, Đà Lạt (whose province is Lâm Đồng), and Hà Nội. The link mapping data may describe locations outside that catalog, but only the two mapped existing Đà Lạt places can be added from a link. URL normalization and catalog integrity are covered by `test/inspiration.test.js` and the authenticated API workflow by `test/planning-api.test.js`.

## Reviews and ratings

A review always belongs to a destination and can optionally belong to one of that destination's places. Omitting `placeId` represents a general destination experience; providing it creates a place-specific review. The server validates that a submitted place exists and belongs to the selected destination, accepts ratings only from 1 to 5, and allows one active review per user for each destination or place target.

Place-card ratings are derived from place-specific reviews only, so a general destination review never changes an individual attraction's score. `GET /api/places` and `GET /api/destinations` include efficient `ratingSummaries` maps for all returned entities, while `GET /api/reviews?placeId=…` includes the selected place's summary and rating distribution. Older review JSON records without `placeId` remain valid destination-level reviews.

The public review browser uses `GET /api/reviews` with optional `destinationId`, `placeId`, `rating`, `sort` (`newest`, `oldest`, `highest`, `lowest`), `page`, and `pageSize` parameters. The response always returns the requested page in `reviews`, a full filtered `ratingSummary` and `ratingDistribution`, and `pagination` metadata. Results are sorted deterministically and out-of-range pages are safely clamped. Contextual surfaces request only three recent review previews; `/reviews` requests ten at a time with URL-backed filters and pagination.

## Product flow demonstrated

1. Browse destinations or start a new trip.
2. Register/login.
3. Set dates, travelers, budget and pace.
4. Select interests and attractions.
5. Generate an itinerary with time slots, duration, notes and budget breakdown.
6. Add/remove stops, reorder items, change start time and duration.
7. Save, reopen, edit or delete a personal trip.
8. Browse local services, inspect place ratings in Step 2, and leave a destination or place-specific review.

## Prototype tradeoffs

JSON persistence is easy to inspect, reset and share, but it is not a production database: it is single-process, has limited query capability, and should run on persistent storage. The weather provider is represented by seeded destination weather text rather than a hard external API dependency. Travel time is likewise seeded so a real maps provider can replace it later.
