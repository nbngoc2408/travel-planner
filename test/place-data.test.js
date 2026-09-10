const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { filterPlaces } = require('../src/domain/recommendations');
const { generateItinerary, parseTime } = require('../src/domain/itinerary');
const { calculateBudget } = require('../src/domain/budget');
const { buildPlanningResult } = require('../src/server');

const ROOT = path.join(__dirname, '..');
const destinations = require(path.join(ROOT, 'data/seed/destinations.json'));
const places = require(path.join(ROOT, 'data/seed/places.json'));
const services = require(path.join(ROOT, 'data/seed/services.json'));
const travelTimes = require(path.join(ROOT, 'data/seed/travelTimes.json'));
const VALID_CATEGORIES = new Set(['nature', 'beach', 'food', 'culture', 'photography', 'experience']);
const VALID_TIMES = new Set(['morning', 'afternoon', 'evening', 'any']);
const EXPECTED_COUNTS = { 'dest-hanoi': 45, 'dest-vinh-hy': 47, 'dest-da-lat': 47 };

function categoriesFor(place) {
  return new Set([place.category, ...(place.categories || [])]);
}

function placesFor(destinationId) {
  return places.filter((place) => place.destinationId === destinationId);
}

test('expanded place seed uses the compatible model with complete scheduling metadata', () => {
  const destinationIds = new Set(destinations.map((destination) => destination.id));
  const ids = new Set();
  const names = new Set();
  assert.deepEqual(Object.fromEntries(Object.entries(EXPECTED_COUNTS).map(([id, count]) => [id, placesFor(id).length])), EXPECTED_COUNTS);

  for (const place of places) {
    assert.ok(place.id && !ids.has(place.id), `unique id required for ${place.name}`);
    ids.add(place.id);
    assert.ok(destinationIds.has(place.destinationId), `${place.id} has a valid destination`);
    assert.equal(Object.hasOwn(place, 'hiddenGem'), false, `${place.id} does not retain removed presentation metadata`);
    assert.ok(place.name && place.description && place.image, `${place.id} has display metadata`);
    const nameKey = `${place.destinationId}:${place.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('vi-VN')}`;
    assert.ok(!names.has(nameKey), `duplicate attraction name: ${place.name}`);
    names.add(nameKey);
    assert.ok(VALID_CATEGORIES.has(place.category), `${place.id} has a supported primary category`);
    assert.ok(Array.isArray(place.categories) && place.categories.includes(place.category), `${place.id} keeps the primary category in categories`);
    assert.ok([...categoriesFor(place)].every((category) => VALID_CATEGORIES.has(category)), `${place.id} has supported categories`);
    assert.ok(place.area && place.areaLabel, `${place.id} has a geographic grouping`);
    assert.ok(Number.isInteger(place.recommendedDurationMinutes) && place.recommendedDurationMinutes >= 30 && place.recommendedDurationMinutes <= 300, `${place.id} has a usable duration`);
    assert.ok(Number.isFinite(place.estimatedCost) && place.estimatedCost >= 0, `${place.id} has a usable cost`);
    assert.ok(VALID_TIMES.has(place.bestTimeOfDay), `${place.id} has a supported time of day`);
  }
});

test('secondary categories participate in interest filtering', () => {
  const beachWithNature = places.find((place) => place.id === 'place-bai-kinh');
  assert.equal(beachWithNature.category, 'beach');
  assert.deepEqual(filterPlaces([beachWithNature], ['nature']).map((place) => place.id), ['place-bai-kinh']);
});

test('customer-facing place copy is complete and consistently Vietnamese', () => {
  for (const place of places) {
    assert.match(place.description, /[À-ỹĐđ]/u, `${place.id} has a Vietnamese description`);
    assert.doesNotMatch(`${place.areaLabel} ${place.description}`, /\bexcursion\b|ngày chuyến đi|chuyến chuyến/i, `${place.id} has no unfinished mixed-language copy`);
    for (const note of place.notes || []) assert.match(note, /[À-ỹĐđ]/u, `${place.id} has Vietnamese itinerary notes`);
  }
});

test('destination and service descriptions are localized for the Vietnamese interface', () => {
  for (const item of [...destinations, ...services]) assert.match(item.description, /[À-ỹĐđ]/u, `${item.id} has Vietnamese display copy`);
  for (const item of destinations) assert.doesNotMatch(item.weather, /Sunny|Cloudy/i, `${item.id} has a localized weather label`);
});

test('each destination supplies unique, believable ten-day itineraries at each intensity', () => {
  for (const [destinationId, availableCount] of Object.entries(EXPECTED_COUNTS)) {
    const available = placesFor(destinationId);
    assert.ok(available.length >= 45 && available.length <= 60);

    const scenarios = [
      { intensity: 'relaxed', selectedCount: 20, maxPerDay: 2 },
      { intensity: 'balanced', selectedCount: 30, maxPerDay: 3 },
      { intensity: 'packed', selectedCount: 40, maxPerDay: 4 }
    ];

    for (const scenario of scenarios) {
      const selected = available.slice(0, scenario.selectedCount);
      const itinerary = generateItinerary({
        places: selected,
        startDate: '2026-10-01',
        endDate: '2026-10-10',
        intensity: scenario.intensity,
        travelTimes
      });
      const items = itinerary.flatMap((day) => day.items);
      assert.equal(itinerary.length, 10, `${destinationId}/${scenario.intensity} has ten days`);
      const minimumActivities = scenario.intensity === 'packed' ? 30 : scenario.selectedCount;
      assert.ok(items.length >= minimumActivities && items.length <= scenario.selectedCount, `${destinationId}/${scenario.intensity} supplies 3–4 activities per day without overpacking`);
      assert.equal(new Set(items.map((item) => item.placeId)).size, items.length, `${destinationId}/${scenario.intensity} has no duplicate attractions`);
      assert.ok(items.every((item) => selected.some((place) => place.id === item.placeId)), `${destinationId}/${scenario.intensity} keeps selected places ahead of unselected recommendations`);
      if (scenario.intensity === 'balanced') assert.deepEqual(new Set(items.map((item) => item.placeId)), new Set(selected.map((place) => place.id)), `${destinationId}/balanced preserves all 30 user-selected places`);
      assert.ok(itinerary.every((day) => day.items.length <= scenario.maxPerDay), `${destinationId}/${scenario.intensity} respects daily intensity`);
      assert.ok(items.every((item) => parseTime(item.endTime) <= 20 * 60 + 30), `${destinationId}/${scenario.intensity} keeps each activity within the day`);
      assert.ok(new Set(items.map((item) => item.category)).size >= 4, `${destinationId}/${scenario.intensity} remains category-diverse`);
    }
  }
});

test('planning budget counts scheduled stops when packed timing leaves a selected stop for later', async () => {
  const selectedPlaceIds = placesFor('dest-hanoi').slice(0, 40).map((place) => place.id);
  const result = await buildPlanningResult({
    destinationId: 'dest-hanoi',
    selectedPlaceIds,
    startDate: '2026-10-01',
    endDate: '2026-10-10',
    intensity: 'packed',
    travelers: 2,
    targetBudget: 12000000,
    accommodationLevel: 'comfort',
    interests: ['culture', 'food']
  });
  assert.equal(result.selectedPlaces.length, 40);
  assert.ok(result.scheduledPlaces.length >= 30 && result.scheduledPlaces.length < result.selectedPlaces.length);
  assert.equal(result.itinerary.flatMap((day) => day.items).length, result.scheduledPlaces.length);
  const expected = calculateBudget({
    places: result.scheduledPlaces,
    days: 10,
    travelers: 2,
    targetBudget: 12000000,
    accommodationLevel: 'comfort'
  });
  assert.deepEqual(result.budget, expected);
});
