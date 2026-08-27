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

async function register(handler, name, email) {
  const result = await request(handler, '/api/auth/register', {
    method: 'POST',
    body: { name, email, password: 'review-test-password' }
  });
  assert.equal(result.status, 201);
  return { user: result.body.user, cookie: result.headers['set-cookie'].split(';')[0] };
}

async function prepareDataDirectory(directory) {
  const seedDirectory = path.join(ROOT, 'data', 'seed');
  const seedFiles = await fs.readdir(seedDirectory);
  await Promise.all(seedFiles.map((file) => fs.copyFile(path.join(seedDirectory, file), path.join(directory, file))));
  const reviewPath = path.join(directory, 'reviews.json');
  const legacyReviews = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
  delete legacyReviews[0].placeId;
  await fs.writeFile(reviewPath, JSON.stringify(legacyReviews, null, 2) + '\n');
}

test('review HTTP API validates place relationships, persists ratings, and enforces ownership', async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pinktrip-review-api-'));
  const previousDataDirectory = process.env.PINKTRIP_DATA_DIR;
  const serverPath = require.resolve('../src/server');
  try {
    await prepareDataDirectory(dataDirectory);
    process.env.PINKTRIP_DATA_DIR = dataDirectory;
    delete require.cache[serverPath];
    let { requestHandler } = require('../src/server');
    const firstUser = await register(requestHandler, 'Review A', 'review-a@example.test');

    const baseline = await request(requestHandler, '/api/places?destinationId=dest-vinh-hy');
    assert.deepEqual(baseline.body.ratingSummaries['place-baichuoi'], { average: 4.5, count: 2 });
    assert.deepEqual(baseline.body.ratingSummaries['place-suoingot'], { average: null, count: 0 });
    const legacyDestinationReview = await request(requestHandler, '/api/destinations');
    assert.deepEqual(legacyDestinationReview.body.ratingSummaries['dest-vinh-hy'], { average: 5, count: 1 });

    const invalidRelationship = await request(requestHandler, '/api/reviews', {
      method: 'POST',
      cookie: firstUser.cookie,
      body: { destinationId: 'dest-hanoi', placeId: 'place-baichuoi', rating: 5, text: 'Không cùng điểm đến.' }
    });
    assert.equal(invalidRelationship.status, 400);

    const invalidRating = await request(requestHandler, '/api/reviews', {
      method: 'POST',
      cookie: firstUser.cookie,
      body: { destinationId: 'dest-vinh-hy', placeId: 'place-baichuoi', rating: 6, text: 'Điểm sao không hợp lệ.' }
    });
    assert.equal(invalidRating.status, 400);

    const createdPlaceReview = await request(requestHandler, '/api/reviews', {
      method: 'POST',
      cookie: firstUser.cookie,
      body: { destinationId: 'dest-vinh-hy', placeId: 'place-baichuoi', rating: 3, text: 'Nước trong và yên tĩnh vào buổi sáng.' }
    });
    assert.equal(createdPlaceReview.status, 201);
    assert.equal(createdPlaceReview.body.review.placeId, 'place-baichuoi');
    const placeReviewId = createdPlaceReview.body.review.id;

    delete require.cache[serverPath];
    ({ requestHandler } = require('../src/server'));
    const persistedPlaceReviews = await request(requestHandler, '/api/reviews?placeId=place-baichuoi&page=1&pageSize=2');
    assert.equal(persistedPlaceReviews.status, 200);
    assert.deepEqual(persistedPlaceReviews.body.ratingSummary, { average: 4, count: 3 });
    assert.equal(persistedPlaceReviews.body.ratingDistribution[3], 1);
    assert.deepEqual(persistedPlaceReviews.body.pagination, { page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const duplicate = await request(requestHandler, '/api/reviews', {
      method: 'POST',
      cookie: firstUser.cookie,
      body: { destinationId: 'dest-vinh-hy', placeId: 'place-baichuoi', rating: 5, text: 'Đây là lần gửi trùng.' }
    });
    assert.equal(duplicate.status, 409);

    const beforeDestinationReview = await request(requestHandler, '/api/destinations');
    const destinationCount = beforeDestinationReview.body.ratingSummaries['dest-vinh-hy'].count;
    const createdDestinationReview = await request(requestHandler, '/api/reviews', {
      method: 'POST',
      cookie: firstUser.cookie,
      body: { destinationId: 'dest-vinh-hy', rating: 4, text: 'Một chuyến đi dễ chịu với nhiều cảnh đẹp.' }
    });
    assert.equal(createdDestinationReview.status, 201);

    const summaryAfterDestinationReview = await request(requestHandler, '/api/places?destinationId=dest-vinh-hy');
    assert.deepEqual(summaryAfterDestinationReview.body.ratingSummaries['place-baichuoi'], { average: 4, count: 3 });
    const destinationAfter = await request(requestHandler, '/api/destinations');
    assert.equal(destinationAfter.body.ratingSummaries['dest-vinh-hy'].count, destinationCount + 1);

    const secondUser = await register(requestHandler, 'Review B', 'review-b@example.test');
    const unauthorisedEdit = await request(requestHandler, '/api/reviews/' + placeReviewId, {
      method: 'PUT',
      cookie: secondUser.cookie,
      body: { destinationId: 'dest-vinh-hy', placeId: 'place-baichuoi', rating: 5, text: 'Cố sửa đánh giá của người khác.' }
    });
    assert.equal(unauthorisedEdit.status, 404);
    const unauthorisedDelete = await request(requestHandler, '/api/reviews/' + placeReviewId, { method: 'DELETE', cookie: secondUser.cookie });
    assert.equal(unauthorisedDelete.status, 404);

    const edited = await request(requestHandler, '/api/reviews/' + placeReviewId, {
      method: 'PUT',
      cookie: firstUser.cookie,
      body: { destinationId: 'dest-vinh-hy', placeId: 'place-baichuoi', rating: 5, text: 'Đổi lịch đi sớm, trải nghiệm rất đáng nhớ.' }
    });
    assert.equal(edited.status, 200);
    const afterEdit = await request(requestHandler, '/api/reviews?placeId=place-baichuoi');
    assert.deepEqual(afterEdit.body.ratingSummary, { average: 4.7, count: 3 });

    const deleted = await request(requestHandler, '/api/reviews/' + placeReviewId, { method: 'DELETE', cookie: firstUser.cookie });
    assert.equal(deleted.status, 200);
    const afterDelete = await request(requestHandler, '/api/places?destinationId=dest-vinh-hy');
    assert.deepEqual(afterDelete.body.ratingSummaries['place-baichuoi'], { average: 4.5, count: 2 });
    const paginationAfterDelete = await request(requestHandler, '/api/reviews?placeId=place-baichuoi&page=2&pageSize=2');
    assert.deepEqual(paginationAfterDelete.body.pagination, { page: 1, pageSize: 2, total: 2, totalPages: 1 });

    await request(requestHandler, '/api/auth/logout', { method: 'POST', cookie: firstUser.cookie });
    const loggedInAgain = await request(requestHandler, '/api/auth/login', {
      method: 'POST',
      body: { email: 'review-a@example.test', password: 'review-test-password' }
    });
    assert.equal(loggedInAgain.status, 200);
    assert.equal(loggedInAgain.body.user.id, firstUser.user.id);
  } finally {
    delete require.cache[serverPath];
    if (previousDataDirectory === undefined) delete process.env.PINKTRIP_DATA_DIR;
    else process.env.PINKTRIP_DATA_DIR = previousDataDirectory;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

test('review listings paginate, filter, sort deterministically, and preserve JSON while browsing', async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pinktrip-review-list-'));
  const previousDataDirectory = process.env.PINKTRIP_DATA_DIR;
  const serverPath = require.resolve('../src/server');
  try {
    await prepareDataDirectory(dataDirectory);
    const reviewPath = path.join(dataDirectory, 'reviews.json');
    const seeded = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
    const pageReviews = Array.from({ length: 13 }, (_, index) => ({
      id: 'page-review-' + String(index + 1).padStart(2, '0'),
      destinationId: 'dest-vinh-hy',
      placeId: index % 2 ? 'place-baichuoi' : 'place-baithung',
      authorName: 'Người đi ' + (index + 1),
      userId: 'seed-user-' + index,
      rating: (index % 5) + 1,
      text: 'Chia sẻ phân trang số ' + (index + 1),
      createdAt: '2026-08-' + String(index + 10).padStart(2, '0') + 'T09:00:00.000Z'
    }));
    await fs.writeFile(reviewPath, JSON.stringify([...seeded, ...pageReviews], null, 2) + '\n');
    const beforeBrowsing = await fs.readFile(reviewPath, 'utf8');
    process.env.PINKTRIP_DATA_DIR = dataDirectory;
    delete require.cache[serverPath];
    const { requestHandler } = require('../src/server');

    const firstPage = await request(requestHandler, '/api/reviews?destinationId=dest-vinh-hy&page=1&pageSize=3&sort=newest');
    const repeatedPage = await request(requestHandler, '/api/reviews?destinationId=dest-vinh-hy&page=1&pageSize=3&sort=newest');
    assert.equal(firstPage.status, 200);
    assert.deepEqual(firstPage.body.reviews.map((review) => review.id), repeatedPage.body.reviews.map((review) => review.id));
    assert.equal(firstPage.body.pagination.total, 17);
    assert.deepEqual(firstPage.body.pagination, { page: 1, pageSize: 3, total: 17, totalPages: 6 });
    assert.equal(firstPage.body.reviews[0].id, 'page-review-13');

    const placeOnly = await request(requestHandler, '/api/reviews?destinationId=dest-vinh-hy&placeId=place-baichuoi&page=1&pageSize=24');
    assert.equal(placeOnly.status, 200);
    assert.ok(placeOnly.body.reviews.every((review) => review.placeId === 'place-baichuoi'));
    assert.ok(placeOnly.body.ratingSummary.count === placeOnly.body.pagination.total);
    const placeOnlyDirect = await request(requestHandler, '/api/reviews?placeId=place-baichuoi&page=1&pageSize=24');
    assert.equal(placeOnlyDirect.body.filters.destinationId, 'dest-vinh-hy');
    assert.equal(placeOnlyDirect.body.filters.placeId, 'place-baichuoi');

    const fiveStar = await request(requestHandler, '/api/reviews?destinationId=dest-vinh-hy&rating=5&sort=highest&page=1&pageSize=24');
    assert.equal(fiveStar.status, 200);
    assert.ok(fiveStar.body.reviews.every((review) => review.rating === 5));
    assert.equal(fiveStar.body.filters.sort, 'highest');

    const lastPage = await request(requestHandler, '/api/reviews?destinationId=dest-vinh-hy&page=999&pageSize=3');
    assert.deepEqual(lastPage.body.pagination, { page: 6, pageSize: 3, total: 17, totalPages: 6 });
    assert.equal(lastPage.body.reviews.length, 2);
    const invalidPage = await request(requestHandler, '/api/reviews?destinationId=dest-vinh-hy&page=not-a-number&pageSize=3');
    assert.equal(invalidPage.body.pagination.page, 1);
    const invalidRelation = await request(requestHandler, '/api/reviews?destinationId=dest-hanoi&placeId=place-baichuoi');
    assert.equal(invalidRelation.status, 400);
    const invalidRating = await request(requestHandler, '/api/reviews?rating=8');
    assert.equal(invalidRating.status, 400);
    assert.equal(await fs.readFile(reviewPath, 'utf8'), beforeBrowsing);
  } finally {
    delete require.cache[serverPath];
    if (previousDataDirectory === undefined) delete process.env.PINKTRIP_DATA_DIR;
    else process.env.PINKTRIP_DATA_DIR = previousDataDirectory;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});
