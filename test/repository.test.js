const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/infrastructure/jsonStore');
const { PlanRepository, ReviewRepository } = require('../src/infrastructure/repositories');

test('plan repository supports CRUD and ownership boundaries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pinktrip-'));
  const repository = new PlanRepository(new JsonStore(directory), 'plans');
  const created = await repository.create({ userId: 'user-a', title: 'Beach break' });
  assert.equal((await repository.findByUserId('user-a')).length, 1);
  assert.equal(await repository.findOwnedById(created.id, 'user-b'), null);
  const updated = await repository.update(created.id, { title: 'Beach break updated' });
  assert.equal(updated.title, 'Beach break updated');
  assert.equal(await repository.delete(created.id), true);
  assert.equal(await repository.findById(created.id), null);
  await fs.rm(directory, { recursive: true, force: true });
});

test('review repository scopes a review by owner, destination and optional place', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pinktrip-reviews-'));
  const repository = new ReviewRepository(new JsonStore(directory), 'reviews');
  const destinationReview = await repository.create({ userId: 'user-a', destinationId: 'vinh-hy', placeId: null, rating: 4 });
  const placeReview = await repository.create({ userId: 'user-a', destinationId: 'vinh-hy', placeId: 'bai-chuoi', rating: 5 });
  assert.equal((await repository.findByUserAndTarget('user-a', 'vinh-hy', null)).id, destinationReview.id);
  assert.equal((await repository.findByUserAndTarget('user-a', 'vinh-hy', 'bai-chuoi')).id, placeReview.id);
  assert.equal(await repository.findOwnedById(placeReview.id, 'user-b'), null);
  await fs.rm(directory, { recursive: true, force: true });
});
