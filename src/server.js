const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { URL } = require('node:url');
const { JsonStore } = require('./infrastructure/jsonStore');
const { CollectionRepository, PlanRepository, ReviewRepository, UserRepository } = require('./infrastructure/repositories');
const { hashPassword, verifyPassword, createToken } = require('./infrastructure/auth');
const { recommendPlaces } = require('./domain/recommendations');
const { summarizeRatings, ratingDistribution, getPlaceRatingSummaries, getDestinationRatingSummaries } = require('./domain/ratings');
const { calculateBudget } = require('./domain/budget');
const { generateItinerary, daysBetween, recalculateItinerary, replanItinerary } = require('./domain/itinerary');
const { resolveInspirationLink } = require('./domain/inspiration');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.PINKTRIP_DATA_DIR || path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const store = new JsonStore(DATA_DIR);
const users = new UserRepository(store, 'users');
const plans = new PlanRepository(store, 'plans');
const sessions = new CollectionRepository(store, 'sessions');
const destinations = new CollectionRepository(store, 'destinations');
const places = new CollectionRepository(store, 'places');
const services = new CollectionRepository(store, 'services');
const reviews = new ReviewRepository(store, 'reviews');
const inspirationLinks = new CollectionRepository(store, 'inspiration-links');

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const seedDir = path.join(DATA_DIR, 'seed');
  const files = await fs.readdir(seedDir);
  await Promise.all(files.map(async (file) => {
    const target = path.join(DATA_DIR, file);
    try { await fs.access(target); } catch { await fs.copyFile(path.join(seedDir, file), target); }
  }));
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function text(res, status, value, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(value);
}

function validatePlanningInputs(input = {}) {
  const startDate = String(input.startDate || '');
  const endDate = String(input.endDate || '');
  const parseDate = (value) => {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
  };
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start) throw Object.assign(new Error('Ngày đi không hợp lệ.'), { status: 400 });
  if (!end) throw Object.assign(new Error('Ngày về không hợp lệ.'), { status: 400 });
  if (end < start) throw Object.assign(new Error('Ngày về phải từ ngày đi trở đi.'), { status: 400 });

  const travelers = input.travelers === undefined || input.travelers === '' ? 1 : Number(input.travelers);
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 12) throw Object.assign(new Error('Số người cần nằm trong khoảng 1–12.'), { status: 400 });
  const targetBudget = input.targetBudget === undefined || input.targetBudget === '' || input.targetBudget === null ? 0 : Number(input.targetBudget);
  if (!Number.isSafeInteger(targetBudget) || targetBudget < 0) throw Object.assign(new Error('Ngân sách phải là số tiền nguyên không âm.'), { status: 400 });
  return { startDate, endDate, travelers, targetBudget };
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error('Invalid JSON body'); }
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

async function currentUser(req) {
  const token = parseCookies(req).pinktrip_session;
  if (!token) return null;
  const session = await sessions.findById(token);
  if (!session || new Date(session.expiresAt) < new Date()) return null;
  return users.findById(session.userId);
}

function publicUser(user) { return user ? { id: user.id, name: user.name, email: user.email } : null; }

function requireFields(input, fields) {
  const missing = fields.filter((field) => input[field] === undefined || input[field] === null || input[field] === '');
  if (missing.length) throw Object.assign(new Error(`Missing fields: ${missing.join(', ')}`), { status: 400 });
}

async function relatedPlan(plan) {
  const destination = await destinations.findById(plan.destinationId);
  const allPlaces = await places.all();
  const selected = allPlaces.filter((place) => (plan.selectedPlaceIds || []).includes(place.id));
  return { ...plan, destination, selectedPlaces: selected };
}

async function validateReviewInput(input) {
  requireFields(input, ['destinationId', 'rating', 'text']);
  const destination = await destinations.findById(input.destinationId);
  if (!destination) throw Object.assign(new Error('Không tìm thấy điểm đến'), { status: 404 });
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw Object.assign(new Error('Đánh giá cần từ 1 đến 5 sao'), { status: 400 });
  const text = String(input.text || '').trim();
  if (text.length < 2) throw Object.assign(new Error('Hãy chia sẻ trải nghiệm của bạn'), { status: 400 });
  const placeId = input.placeId ? String(input.placeId) : null;
  if (placeId) {
    const place = await places.findById(placeId);
    if (!place || place.destinationId !== destination.id) throw Object.assign(new Error('Địa điểm không thuộc điểm đến đã chọn'), { status: 400 });
  }
  return { destinationId: destination.id, placeId, rating, text: text.slice(0, 800) };
}

function reviewListQuery(url) {
  const destinationId = url.searchParams.get('destinationId') || null;
  const placeId = url.searchParams.get('placeId') || null;
  const ratingValue = url.searchParams.get('rating');
  const rating = ratingValue === null || ratingValue === '' ? null : Number(ratingValue);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    throw Object.assign(new Error('Bộ lọc số sao cần từ 1 đến 5'), { status: 400 });
  }
  const requestedSort = url.searchParams.get('sort') || 'newest';
  const sort = ['newest', 'oldest', 'highest', 'lowest'].includes(requestedSort) ? requestedSort : 'newest';
  const requestedPage = Number(url.searchParams.get('page') || 1);
  const requestedPageSize = Number(url.searchParams.get('pageSize') || 12);
  return {
    destinationId,
    placeId,
    rating,
    sort,
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: Number.isInteger(requestedPageSize) && requestedPageSize > 0 ? Math.min(requestedPageSize, 24) : 12
  };
}

function reviewResponse(list, query) {
  return {
    reviews: list.items,
    ratingSummary: summarizeRatings(list.matched),
    ratingDistribution: ratingDistribution(list.matched),
    pagination: { page: list.page, pageSize: list.pageSize, total: list.total, totalPages: list.totalPages },
    filters: { destinationId: query.destinationId, placeId: query.placeId, rating: query.rating, sort: query.sort }
  };
}

async function buildPlanningResult(input) {
  requireFields(input, ['destinationId', 'startDate', 'endDate']);
  const planningInputs = validatePlanningInputs(input);
  const destination = await destinations.findById(input.destinationId);
  if (!destination) throw Object.assign(new Error('Destination not found'), { status: 404 });
  const allKnownPlaces = await places.all();
  const allPlaces = allKnownPlaces.filter((place) => place.destinationId === destination.id);
  const mappings = await inspirationLinks.all();
  const suppliedItems = Array.isArray(input.inspirationItems) ? input.inspirationItems : [];
  const inspirationItems = [];
  for (const item of suppliedItems) {
    const match = resolveInspirationLink(item?.sourceUrl || item?.canonicalUrl, mappings, allKnownPlaces);
    if (match.status !== 'matched' || match.place.destinationId !== destination.id) continue;
    if (!inspirationItems.some((saved) => saved.placeId === match.place.id)) {
      inspirationItems.push({ mappingId: match.mapping.id, placeId: match.place.id, sourceUrl: match.normalizedUrl, platform: match.mapping.platform });
    }
  }
  const selectedIds = [...new Set([...(Array.isArray(input.selectedPlaceIds) ? input.selectedPlaceIds : []), ...inspirationItems.map((item) => item.placeId)])];
  if (!selectedIds.length) throw Object.assign(new Error('Hãy chọn ít nhất một địa điểm để tạo lịch trình'), { status: 400 });
  const selectedPlaces = allPlaces.filter((place) => selectedIds.includes(place.id));
  if (!selectedPlaces.length) throw Object.assign(new Error('Không tìm thấy địa điểm đã chọn cho điểm đến này'), { status: 400 });
  const days = daysBetween(input.startDate, input.endDate);
  const itinerary = generateItinerary({
    places: selectedPlaces,
    startDate: input.startDate,
    endDate: input.endDate,
    intensity: input.intensity || 'balanced',
    travelTimes: await store.read('travelTimes', [])
  });
  const scheduledPlaceIds = new Set(itinerary.flatMap((day) => day.items.map((item) => item.placeId)));
  const scheduledPlaces = selectedPlaces.filter((place) => scheduledPlaceIds.has(place.id));
  const budget = calculateBudget({
    places: scheduledPlaces,
    days,
    travelers: planningInputs.travelers,
    targetBudget: planningInputs.targetBudget,
    accommodationLevel: input.accommodationLevel || 'comfort'
  });
  const recommendations = recommendPlaces(allPlaces, {
    interests: input.interests || [],
    budgetPerStop: budget.total / Math.max(1, selectedPlaces.length || 1),
    intensity: input.intensity
  }).slice(0, 6);
  return { destination, selectedPlaces, scheduledPlaces, itinerary, budget, recommendations, inspirationItems };
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};
  const user = await currentUser(req);

  if (method === 'POST' && pathname === '/api/auth/register') {
    requireFields(body, ['name', 'email', 'password']);
    if (String(body.password).length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
    if (await users.findByEmail(String(body.email).trim())) throw Object.assign(new Error('An account with this email already exists'), { status: 409 });
    const created = await users.create({ name: String(body.name).trim().slice(0, 60), email: String(body.email).trim().toLowerCase(), passwordHash: hashPassword(String(body.password)), createdAt: new Date().toISOString() });
    const token = createToken();
    await sessions.create({ id: token, userId: created.id, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() });
    res.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': `pinktrip_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600` });
    res.end(JSON.stringify({ user: publicUser(created) }));
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    requireFields(body, ['email', 'password']);
    const found = await users.findByEmail(String(body.email).trim());
    if (!found || !verifyPassword(String(body.password), found.passwordHash)) throw Object.assign(new Error('Email or password is incorrect'), { status: 401 });
    const token = createToken();
    await sessions.create({ id: token, userId: found.id, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': `pinktrip_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600` });
    res.end(JSON.stringify({ user: publicUser(found) }));
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = parseCookies(req).pinktrip_session;
    if (token) await sessions.delete(token);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'pinktrip_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (method === 'GET' && pathname === '/api/auth/me') { json(res, 200, { user: publicUser(user) }); return; }
  if (method === 'GET' && pathname === '/api/destinations') {
    const allDestinations = await destinations.all();
    const allReviews = await reviews.all();
    json(res, 200, { destinations: allDestinations, ratingSummaries: getDestinationRatingSummaries(allReviews, allDestinations.map((item) => item.id)) }); return;
  }
  if (method === 'GET' && pathname === '/api/places') {
    const allPlaces = await places.all();
    const filteredPlaces = allPlaces.filter((place) => !url.searchParams.get('destinationId') || place.destinationId === url.searchParams.get('destinationId'));
    json(res, 200, { places: filteredPlaces, ratingSummaries: getPlaceRatingSummaries(await reviews.all(), filteredPlaces.map((item) => item.id)) }); return;
  }
  if (method === 'POST' && pathname === '/api/inspiration/resolve') {
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    const match = resolveInspirationLink(body.url, await inspirationLinks.all(), await places.all());
    if (match.status === 'invalid') throw Object.assign(new Error('Vui lòng dán một đường link hợp lệ.'), { status: 400 });
    if (match.status === 'unsupported') { json(res, 200, { status: 'unsupported' }); return; }
    if (match.status === 'unavailable') {
      json(res, 200, { status: 'unavailable', mapping: { id: match.mapping.id, platform: match.mapping.platform }, resolved: match.mapping.resolved });
      return;
    }
    const targetDestination = await destinations.findById(match.place.destinationId);
    const currentDestinationId = body.destinationId ? String(body.destinationId) : '';
    json(res, 200, {
      status: currentDestinationId && currentDestinationId !== match.place.destinationId ? 'mismatch' : 'matched',
      mapping: { id: match.mapping.id, platform: match.mapping.platform, canonicalUrl: match.mapping.url },
      place: match.place,
      destination: targetDestination,
      normalizedUrl: match.normalizedUrl
    });
    return;
  }
  if (method === 'GET' && pathname === '/api/services') { json(res, 200, { services: (await services.all()).filter((service) => !url.searchParams.get('destinationId') || service.destinationId === url.searchParams.get('destinationId')) }); return; }
  if (method === 'GET' && pathname === '/api/reviews') {
    const query = reviewListQuery(url);
    if (query.destinationId && !(await destinations.findById(query.destinationId))) throw Object.assign(new Error('Không tìm thấy điểm đến'), { status: 404 });
    if (query.placeId) {
      const reviewPlace = await places.findById(query.placeId);
      if (!reviewPlace) throw Object.assign(new Error('Không tìm thấy địa điểm'), { status: 404 });
      if (query.destinationId && reviewPlace.destinationId !== query.destinationId) throw Object.assign(new Error('Địa điểm không thuộc điểm đến đã chọn'), { status: 400 });
      if (!query.destinationId) query.destinationId = reviewPlace.destinationId;
    }
    json(res, 200, reviewResponse(await reviews.list(query), query)); return;
  }

  if (method === 'POST' && pathname === '/api/reviews') {
    if (!user) throw Object.assign(new Error('Please log in to leave a review'), { status: 401 });
    const input = await validateReviewInput(body);
    const existing = await reviews.findByUserAndTarget(user.id, input.destinationId, input.placeId);
    if (existing) throw Object.assign(new Error('Bạn đã có một đánh giá cho mục này. Hãy chỉnh sửa đánh giá hiện có.'), { status: 409 });
    const review = await reviews.create({ ...input, authorName: user.name, userId: user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    json(res, 201, { review }); return;
  }

  const reviewMatch = pathname.match(/^\/api\/reviews\/([^/]+)$/);
  if (reviewMatch) {
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    const reviewId = reviewMatch[1];
    const existing = await reviews.findOwnedById(reviewId, user.id);
    if (!existing) throw Object.assign(new Error('Review not found'), { status: 404 });
    if (method === 'DELETE') { await reviews.delete(reviewId); json(res, 200, { ok: true }); return; }
    if (method === 'PUT') {
      const input = await validateReviewInput(body);
      const duplicate = await reviews.findByUserAndTarget(user.id, input.destinationId, input.placeId);
      if (duplicate && duplicate.id !== existing.id) throw Object.assign(new Error('Bạn đã có một đánh giá cho mục này.'), { status: 409 });
      const review = await reviews.update(reviewId, { ...input, authorName: user.name, userId: user.id, updatedAt: new Date().toISOString() });
      json(res, 200, { review }); return;
    }
    throw Object.assign(new Error('Method not allowed'), { status: 405 });
  }

  if (pathname === '/api/plans' && method === 'GET') {
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    const ownPlans = await plans.findByUserId(user.id);
    json(res, 200, { plans: await Promise.all(ownPlans.map(relatedPlan)) }); return;
  }

  if (pathname === '/api/plans/generate' && method === 'POST') {
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    json(res, 200, await buildPlanningResult(body)); return;
  }

  if (pathname === '/api/plans/recalculate' && method === 'POST') {
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    requireFields(body, ['startDate', 'endDate']);
    const planningInputs = validatePlanningInputs(body);
    const itinerary = Array.isArray(body.itinerary) ? body.itinerary : [];
    const recalculated = recalculateItinerary(itinerary, { intensity: body.intensity || 'balanced', travelTimes: await store.read('travelTimes', []) });
    const allPlaces = await places.all();
    const itineraryPlaceIds = new Set(recalculated.flatMap((day) => day.items.map((item) => item.placeId)).filter(Boolean));
    const budget = calculateBudget({ places: allPlaces.filter((place) => itineraryPlaceIds.has(place.id)), days: daysBetween(planningInputs.startDate, planningInputs.endDate), travelers: planningInputs.travelers, targetBudget: planningInputs.targetBudget, accommodationLevel: body.accommodationLevel || 'comfort' });
    json(res, 200, { itinerary: recalculated, budget }); return;
  }

  if (pathname === '/api/plans/replan' && method === 'POST') {
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    if (body.planId && !(await plans.findOwnedById(body.planId, user.id))) throw Object.assign(new Error('Trip not found'), { status: 404 });
    requireFields(body, ['startDate', 'endDate']);
    const planningInputs = validatePlanningInputs(body);
    const itinerary = Array.isArray(body.currentItinerary) ? body.currentItinerary : [];
    if (!itinerary.length) throw Object.assign(new Error('Chưa có lịch trình để điều chỉnh'), { status: 400 });
    const result = replanItinerary({ days: itinerary, disruption: body.disruption || {}, intensity: body.intensity || 'balanced', travelTimes: await store.read('travelTimes', []) });
    const allPlaces = await places.all();
    const itemPlaceIds = new Set(result.days.flatMap((day) => day.items.map((item) => item.placeId)).filter(Boolean));
    const selectedPlaceIds = Array.isArray(body.selectedPlaceIds) ? [...new Set(body.selectedPlaceIds)] : [];
    const budget = calculateBudget({ places: allPlaces.filter((place) => itemPlaceIds.has(place.id)), days: daysBetween(planningInputs.startDate, planningInputs.endDate), travelers: planningInputs.travelers, targetBudget: planningInputs.targetBudget, accommodationLevel: body.accommodationLevel || 'comfort' });
    json(res, 200, { ...result, budget, selectedPlaceIds }); return;
  }

  const planMatch = pathname.match(/^\/api\/plans\/([^/]+)$/);
  if (planMatch) {
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    const planId = planMatch[1];
    const existing = await plans.findOwnedById(planId, user.id);
    if (!existing) throw Object.assign(new Error('Trip not found'), { status: 404 });
    if (method === 'GET') { json(res, 200, { plan: await relatedPlan(existing) }); return; }
    if (method === 'DELETE') { await plans.delete(planId); json(res, 200, { ok: true }); return; }
    if (method === 'PUT') {
      const next = { ...existing, ...body, userId: user.id, id: existing.id, updatedAt: new Date().toISOString() };
      const validated = await buildPlanningResult(next);
      next.selectedPlaceIds = validated.selectedPlaces.map((place) => place.id);
      next.inspirationItems = validated.inspirationItems;
      if (body.regenerate !== false) {
        next.days = validated.itinerary;
        next.budget = validated.budget;
      } else if (Array.isArray(body.days)) {
        const allPlaces = await places.all();
        const itineraryPlaceIds = new Set(body.days.flatMap((day) => (day.items || []).map((item) => item.placeId)).filter(Boolean));
        const planningInputs = validatePlanningInputs(next);
        next.budget = calculateBudget({ places: allPlaces.filter((place) => itineraryPlaceIds.has(place.id)), days: daysBetween(planningInputs.startDate, planningInputs.endDate), travelers: planningInputs.travelers, targetBudget: planningInputs.targetBudget, accommodationLevel: next.accommodationLevel || 'comfort' });
      }
      delete next.regenerate;
      const saved = await plans.update(planId, next);
      json(res, 200, { plan: await relatedPlan(saved) }); return;
    }
  }

  if (pathname === '/api/plans' && method === 'POST') {
    if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
    requireFields(body, ['title', 'destinationId', 'startDate', 'endDate']);
    const planningInputs = validatePlanningInputs(body);
    const generated = await buildPlanningResult(body);
    const selectedPlaceIds = generated.selectedPlaces.map((place) => place.id);
    const days = Array.isArray(body.days) && body.regenerate === false ? body.days : generated.itinerary;
    const itineraryPlaceIds = new Set(days.flatMap((day) => (day.items || []).map((item) => item.placeId)).filter(Boolean));
    const budget = calculateBudget({ places: generated.selectedPlaces.filter((place) => itineraryPlaceIds.has(place.id)), days: daysBetween(planningInputs.startDate, planningInputs.endDate), travelers: planningInputs.travelers, targetBudget: planningInputs.targetBudget, accommodationLevel: body.accommodationLevel || 'comfort' });
    const created = await plans.create({ userId: user.id, title: String(body.title).trim().slice(0, 80), destinationId: body.destinationId, startDate: planningInputs.startDate, endDate: planningInputs.endDate, travelers: planningInputs.travelers, intensity: body.intensity || 'balanced', targetBudget: planningInputs.targetBudget, accommodationLevel: body.accommodationLevel || 'comfort', interests: body.interests || [], selectedPlaceIds, inspirationItems: generated.inspirationItems, days, budget, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    json(res, 201, { plan: await relatedPlan(created) }); return;
  }

  throw Object.assign(new Error('Not found'), { status: 404 });
}

async function serveStatic(req, res, url) {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  const target = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!target.startsWith(PUBLIC_DIR)) { text(res, 403, 'Forbidden'); return; }
  try {
    const content = await fs.readFile(target);
    const type = target.endsWith('.css') ? 'text/css; charset=utf-8' : target.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
    text(res, 200, content, type);
  } catch {
    // Browser-history routes belong to the client app. Static assets retain a
    // normal 404, while paths such as /trips/:id receive the SPA shell.
    if (req.method === 'GET' && !path.extname(url.pathname)) {
      const shell = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
      text(res, 200, shell, 'text/html; charset=utf-8');
      return;
    }
    text(res, 404, 'Not found');
  }
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    json(res, status, { error: status === 500 ? 'Something went wrong' : error.message });
  }
}

const port = Number(process.env.PORT) || 3000;
if (require.main === module) {
  ensureDataFiles().then(() => http.createServer(requestHandler).listen(port, () => console.log(`PinkTrip is running at http://localhost:${port}`))).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { requestHandler, buildPlanningResult, validatePlanningInputs };
