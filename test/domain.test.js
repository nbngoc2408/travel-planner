const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendPlaces, filterPlaces } = require('../src/domain/recommendations');
const { calculateBudget } = require('../src/domain/budget');
const { summarizeRatings, getPlaceRatingSummaries, getDestinationRatingSummaries } = require('../src/domain/ratings');
const { generateItinerary, moveItineraryItem, replanItinerary } = require('../src/domain/itinerary');
const { hashPassword, verifyPassword } = require('../src/infrastructure/auth');

const places = [
  { id: 'beach', name: 'Bãi biển', category: 'beach', hiddenGem: false, estimatedCost: 100000, recommendedDurationMinutes: 120, bestTimeOfDay: 'afternoon' },
  { id: 'nature', name: 'Suối', category: 'nature', hiddenGem: true, estimatedCost: 50000, recommendedDurationMinutes: 90, bestTimeOfDay: 'morning' },
  { id: 'food', name: 'Chợ', category: 'food', hiddenGem: false, estimatedCost: 180000, recommendedDurationMinutes: 60, bestTimeOfDay: 'evening' },
  { id: 'photo', name: 'Đồi ảnh', category: 'photography', hiddenGem: false, estimatedCost: 70000, recommendedDurationMinutes: 90, bestTimeOfDay: 'afternoon' }
];

test('interest filtering uses all places with no filter and OR semantics for multiple interests', () => {
  assert.equal(filterPlaces(places, []).length, places.length);
  assert.deepEqual(filterPlaces(places, ['nature']).map((place) => place.id), ['nature']);
  assert.deepEqual(filterPlaces(places, ['nature', 'beach']).map((place) => place.id), ['beach', 'nature']);
});

test('recommendations prioritize selected interests and hidden gems', () => {
  const result = recommendPlaces(places, { interests: ['nature'], budgetPerStop: 100000 });
  assert.equal(result[0].id, 'nature');
});

test('budget calculator returns total, per person and over-budget state', () => {
  const budget = calculateBudget({ places, days: 3, travelers: 2, targetBudget: 1000000, accommodationLevel: 'comfort' });
  assert.equal(budget.perPerson, Math.round(budget.total / 2));
  assert.equal(budget.isOverBudget, true);
  assert.ok(budget.total > budget.attractions);
});

test('rating summaries handle empty and rounded averages centrally', () => {
  assert.deepEqual(summarizeRatings([]), { average: null, count: 0 });
  assert.deepEqual(summarizeRatings([{ rating: 5 }, { rating: 4 }, { rating: 3 }]), { average: 4, count: 3 });
  assert.deepEqual(summarizeRatings([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), { average: 4.3, count: 3 });
});

test('place ratings exclude destination-level and other-place reviews', () => {
  const reviews = [
    { destinationId: 'vinh-hy', rating: 5 },
    { destinationId: 'vinh-hy', rating: 4 },
    { destinationId: 'vinh-hy', placeId: 'bai-chuoi', rating: 5 },
    { destinationId: 'vinh-hy', placeId: 'bai-chuoi', rating: 5 },
    { destinationId: 'vinh-hy', placeId: 'bai-thung', rating: 3 }
  ];
  assert.deepEqual(getPlaceRatingSummaries(reviews, ['bai-chuoi', 'bai-thung']), {
    'bai-chuoi': { average: 5, count: 2 },
    'bai-thung': { average: 3, count: 1 }
  });
  assert.deepEqual(getDestinationRatingSummaries(reviews, ['vinh-hy']), { 'vinh-hy': { average: 4.5, count: 2 } });
});

test('itinerary respects relaxed intensity and dates', () => {
  const result = generateItinerary({ places, startDate: '2026-09-01', endDate: '2026-09-03', intensity: 'relaxed' });
  assert.equal(result.length, 3);
  assert.ok(result.every((day) => day.items.length <= 2));
  assert.equal(result[0].date, '2026-09-01');
});

test('itinerary items can move across days and empty days remain addressable', () => {
  const days = generateItinerary({ places, startDate: '2026-09-01', endDate: '2026-09-03', intensity: 'packed' });
  const moved = moveItineraryItem(days, { fromDayIndex: 0, itemIndex: 0, toDayIndex: 2, intensity: 'packed' });
  assert.equal(moved[0].items.length, days[0].items.length - 1);
  assert.equal(moved[2].items.at(-1).placeId, days[0].items[0].placeId);
  assert.ok(moved.every((day) => day.items.every((item) => item.endTime > item.startTime)));
});

test('recalculation keeps reordered items inside the available day window', () => {
  const days = [{ date: '2026-09-01', items: [
    { id: 'late-a', placeId: 'a', title: 'A', startTime: '16:45', endTime: '19:45', durationMinutes: 180 },
    { id: 'late-b', placeId: 'b', title: 'B', startTime: '20:05', endTime: '22:35', durationMinutes: 150 }
  ] }];
  const moved = moveItineraryItem(days, { fromDayIndex: 0, itemIndex: 0, toDayIndex: 0, toIndex: 1, intensity: 'balanced' });
  assert.equal(moved[0].items[0].startTime, '13:50');
  assert.equal(moved[0].items.at(-1).endTime, '20:30');
});

test('replanning starts from the edited itinerary, protects completed items, and never adds a day', () => {
  const days = generateItinerary({ places, startDate: '2026-09-01', endDate: '2026-09-02', intensity: 'relaxed' });
  const edited = moveItineraryItem(days, { fromDayIndex: 0, itemIndex: 0, toDayIndex: 1, intensity: 'relaxed' });
  const completed = edited[0].items[0];
  const result = replanItinerary({ days: edited, intensity: 'relaxed', disruption: { type: 'late-start', dayIndex: 1, availableFrom: '19:00', completedItemIds: [completed.id] } });
  assert.equal(result.days.length, 2);
  assert.deepEqual(result.days[0].items[0], completed);
  assert.equal(result.days.flatMap((day) => day.items).some((item) => item.id === completed.id), true);
  assert.ok(result.changes.length > 0);
});

test('replanning explains skipped places separately from unavailable places', () => {
  const days = generateItinerary({ places: places.slice(0, 2), startDate: '2026-09-01', endDate: '2026-09-01', intensity: 'balanced' });
  const result = replanItinerary({ days, intensity: 'balanced', disruption: { type: 'skip', dayIndex: 0, itemId: days[0].items[0].id } });
  assert.equal(result.days.flatMap((day) => day.items).some((item) => item.id === days[0].items[0].id), false);
  assert.equal(result.changes.find((change) => change.itemId === days[0].items[0].id).reason, 'skipped');
});

test('passwords are hashed and verified without storing plaintext', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.notEqual(stored, 'correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('wrong password', stored), false);
});
