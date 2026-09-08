const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { Readable } = require('node:stream');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

async function request(handler, route, { method = 'GET', body, cookie } = {}) {
  const payload = body ? JSON.stringify(body) : '';
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.url = route;
  req.headers = { host: 'localhost', ...(cookie ? { cookie } : {}) };
  let status;
  let headers;
  let responseBody = '';
  const res = {
    writeHead(nextStatus, nextHeaders) { status = nextStatus; headers = nextHeaders; },
    end(value = '') { responseBody += value; }
  };
  await handler(req, res);
  return { status, headers, body: JSON.parse(responseBody) };
}

test('a long saved trip preserves all selected places and the generated budget', async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pinktrip-long-plan-'));
  const previousDataDirectory = process.env.PINKTRIP_DATA_DIR;
  const serverPath = require.resolve('../src/server');
  try {
    const seedDirectory = path.join(ROOT, 'data', 'seed');
    const seedFiles = await fs.readdir(seedDirectory);
    await Promise.all(seedFiles.map((file) => fs.copyFile(path.join(seedDirectory, file), path.join(dataDirectory, file))));
    process.env.PINKTRIP_DATA_DIR = dataDirectory;
    delete require.cache[serverPath];
    const { requestHandler } = require('../src/server');
    const signup = await request(requestHandler, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Long Trip QA', email: 'long-trip@example.test', password: 'long-trip-test-password' }
    });
    assert.equal(signup.status, 201);
    const cookie = signup.headers['set-cookie'].split(';')[0];
    const selectedPlaceIds = JSON.parse(await fs.readFile(path.join(dataDirectory, 'places.json'), 'utf8'))
      .filter((place) => place.destinationId === 'dest-hanoi')
      .slice(0, 40)
      .map((place) => place.id);
    const created = await request(requestHandler, '/api/plans', {
      method: 'POST',
      cookie,
      body: {
        title: 'Mười ngày Hà Nội',
        destinationId: 'dest-hanoi',
        selectedPlaceIds,
        startDate: '2026-10-01',
        endDate: '2026-10-10',
        travelers: 2,
        targetBudget: 12000000,
        accommodationLevel: 'comfort',
        intensity: 'packed',
        interests: ['culture', 'food', 'photography']
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.plan.selectedPlaceIds.length, 40);
    const scheduled = created.body.plan.days.flatMap((day) => day.items);
    assert.ok(scheduled.length >= 30 && scheduled.length <= 40);
    assert.equal(new Set(scheduled.map((item) => item.placeId)).size, scheduled.length);
    assert.ok(created.body.plan.budget.attractions > 0);

    const replanPreview = await request(requestHandler, '/api/plans/replan', {
      method: 'POST', cookie,
      body: {
        ...created.body.plan,
        planId: created.body.plan.id,
        currentItinerary: created.body.plan.days,
        disruption: { type: 'skip', dayIndex: 0, itemId: created.body.plan.days[0].items[0].id, completedItemIds: [] }
      }
    });
    assert.equal(replanPreview.status, 200);
    assert.equal(replanPreview.body.selectedPlaceIds.length, 40);
    assert.equal(replanPreview.body.days.flatMap((day) => day.items).some((item) => item.id === created.body.plan.days[0].items[0].id), false);
    assert.ok(replanPreview.body.budget.attractions < created.body.plan.budget.attractions);

    const editedDays = JSON.parse(JSON.stringify(created.body.plan.days));
    const removed = editedDays[0].items.pop();
    const edited = await request(requestHandler, '/api/plans/' + encodeURIComponent(created.body.plan.id), {
      method: 'PUT', cookie,
      body: { ...created.body.plan, days: editedDays, regenerate: false }
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.plan.selectedPlaceIds.length, 40);
    assert.ok(edited.body.plan.budget.attractions < created.body.plan.budget.attractions);
    assert.equal(edited.body.plan.days.flatMap((day) => day.items).some((item) => item.id === removed.id), false);

    const reopened = await request(requestHandler, '/api/plans/' + encodeURIComponent(created.body.plan.id), { cookie });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.plan.selectedPlaceIds.length, 40);
    assert.equal(reopened.body.plan.days.flatMap((day) => day.items).length, scheduled.length - 1);
    assert.equal(reopened.body.plan.days.flatMap((day) => day.items).some((item) => item.id === removed.id), false);
  } finally {
    delete require.cache[serverPath];
    if (previousDataDirectory === undefined) delete process.env.PINKTRIP_DATA_DIR;
    else process.env.PINKTRIP_DATA_DIR = previousDataDirectory;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

test('inspiration resolution is static, destination-safe, and persists canonical provenance', async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pinktrip-inspiration-'));
  const previousDataDirectory = process.env.PINKTRIP_DATA_DIR;
  const serverPath = require.resolve('../src/server');
  try {
    const seedDirectory = path.join(ROOT, 'data', 'seed');
    const seedFiles = await fs.readdir(seedDirectory);
    await Promise.all(seedFiles.map((file) => fs.copyFile(path.join(seedDirectory, file), path.join(dataDirectory, file))));
    process.env.PINKTRIP_DATA_DIR = dataDirectory;
    delete require.cache[serverPath];
    const { requestHandler } = require('../src/server');
    const signup = await request(requestHandler, '/api/auth/register', { method: 'POST', body: { name: 'Inspiration QA', email: 'inspiration@example.test', password: 'inspiration-test-password' } });
    const cookie = signup.headers['set-cookie'].split(';')[0];
    const deoprenn = 'https://vt.tiktok.com/ZSVbhasUT/';
    const resolved = await request(requestHandler, '/api/inspiration/resolve', { method: 'POST', cookie, body: { url: deoprenn, destinationId: 'dest-da-lat' } });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.status, 'matched');
    assert.equal(resolved.body.place.id, 'place-deo-prenn');
    const mismatch = await request(requestHandler, '/api/inspiration/resolve', { method: 'POST', cookie, body: { url: deoprenn, destinationId: 'dest-vinh-hy' } });
    assert.equal(mismatch.body.status, 'mismatch');
    const unavailable = await request(requestHandler, '/api/inspiration/resolve', { method: 'POST', cookie, body: { url: 'https://vt.tiktok.com/ZSVbMC4aw/', destinationId: 'dest-da-lat' } });
    assert.equal(unavailable.body.status, 'unavailable');
    assert.equal(unavailable.body.resolved.name, 'Bàu Trắng');
    assert.equal(unavailable.body.place, undefined);
    const catalog = await request(requestHandler, '/api/destinations', { cookie });
    assert.deepEqual(catalog.body.destinations.map((item) => item.id), ['dest-vinh-hy', 'dest-da-lat', 'dest-hanoi']);
    const unsupported = await request(requestHandler, '/api/inspiration/resolve', { method: 'POST', cookie, body: { url: 'https://vt.tiktok.com/not-a-known-place/', destinationId: 'dest-da-lat' } });
    assert.equal(unsupported.body.status, 'unsupported');
    const created = await request(requestHandler, '/api/plans', {
      method: 'POST', cookie,
      body: { title: 'Đà Lạt từ cảm hứng', destinationId: 'dest-da-lat', startDate: '2026-10-01', endDate: '2026-10-03', travelers: 2, targetBudget: 4000000, intensity: 'balanced', selectedPlaceIds: ['place-deo-prenn', 'place-dalat-railway'], inspirationItems: [{ mappingId: resolved.body.mapping.id, placeId: 'place-deo-prenn', sourceUrl: deoprenn, platform: 'tiktok' }, { mappingId: resolved.body.mapping.id, placeId: 'place-deo-prenn', sourceUrl: deoprenn, platform: 'tiktok' }, { mappingId: unavailable.body.mapping.id, sourceUrl: 'https://vt.tiktok.com/ZSVbMC4aw/', platform: 'tiktok' }] }
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.plan.selectedPlaceIds.sort(), ['place-dalat-railway', 'place-deo-prenn']);
    assert.deepEqual(created.body.plan.inspirationItems, [{ mappingId: 'inspiration-deo-prenn', placeId: 'place-deo-prenn', sourceUrl: 'https://vt.tiktok.com/ZSVbhasUT', platform: 'tiktok' }]);
    assert.equal(created.body.plan.days.flatMap((day) => day.items).filter((item) => item.placeId === 'place-deo-prenn').length, 1);
    const reopened = await request(requestHandler, '/api/plans/' + encodeURIComponent(created.body.plan.id), { cookie });
    assert.deepEqual(reopened.body.plan.inspirationItems, created.body.plan.inspirationItems);
  } finally {
    delete require.cache[serverPath];
    if (previousDataDirectory === undefined) delete process.env.PINKTRIP_DATA_DIR;
    else process.env.PINKTRIP_DATA_DIR = previousDataDirectory;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});
