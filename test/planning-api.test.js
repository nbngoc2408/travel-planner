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

    const reopened = await request(requestHandler, '/api/plans/' + encodeURIComponent(created.body.plan.id), { cookie });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.plan.selectedPlaceIds.length, 40);
    assert.equal(reopened.body.plan.days.flatMap((day) => day.items).length, scheduled.length);
  } finally {
    delete require.cache[serverPath];
    if (previousDataDirectory === undefined) delete process.env.PINKTRIP_DATA_DIR;
    else process.env.PINKTRIP_DATA_DIR = previousDataDirectory;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});
