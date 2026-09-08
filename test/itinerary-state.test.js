const test = require('node:test');
const assert = require('node:assert/strict');
const { createBaseline, restoreBaseline, itineraryPlaceIds, summarizeDay, summarizeItinerary } = require('../public/itinerary-state');
const { recalculateItinerary, moveItineraryItem, replanItinerary } = require('../src/domain/itinerary');

function sampleDays() {
  return [
    { date: '2026-10-01', items: [
      { id: 'a', placeId: 'a', title: 'Bãi Chuối', startTime: '08:00', endTime: '10:00', durationMinutes: 120, estimatedCost: 100 },
      { id: 'b', placeId: 'b', title: 'Suối Nước Ngọt', startTime: '11:00', endTime: '12:30', durationMinutes: 90, estimatedCost: 200 },
      { id: 'c', placeId: 'c', title: 'Công viên Đá', startTime: '13:30', endTime: '15:00', durationMinutes: 90, estimatedCost: 300 }
    ] },
    { date: '2026-10-02', items: [
      { id: 'd', placeId: 'd', title: 'Vườn nho', startTime: '08:00', endTime: '09:30', durationMinutes: 90, estimatedCost: 400 }
    ] }
  ];
}

test('reset baseline is deeply isolated from reorder, duration, move, and removal edits', () => {
  const original = sampleDays();
  const baseline = createBaseline({ itinerary: original, budget: { total: 1000, attractions: 1000 } });
  const edited = moveItineraryItem(original, { fromDayIndex: 0, itemIndex: 1, toDayIndex: 0, toIndex: 0 });
  edited[0].items[1].durationMinutes = 180;
  edited[1].items.push(edited[0].items.splice(2, 1)[0]);
  edited[0].items.splice(1, 1);
  const normalized = recalculateItinerary(edited);

  assert.notDeepEqual(normalized, baseline.itinerary);
  assert.deepEqual(itineraryPlaceIds(normalized).sort(), ['b', 'c', 'd']);
  const restored = restoreBaseline(baseline);
  assert.deepEqual(restored.itinerary, original);
  assert.deepEqual(restored.budget, { total: 1000, attractions: 1000 });
  assert.deepEqual(restored.itinerary.map((day) => day.items.map((item) => item.id)), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(itineraryPlaceIds(restored.itinerary).sort(), ['a', 'b', 'c', 'd']);

  restored.itinerary[0].items[0].durationMinutes = 999;
  assert.equal(baseline.itinerary[0].items[0].durationMinutes, 120);
});

test('a saved or applied-replan version can become the next reset baseline without shared references', () => {
  const first = createBaseline({ itinerary: sampleDays(), budget: { total: 1000 } });
  const saved = restoreBaseline(first);
  saved.itinerary[0].items[0].durationMinutes = 150;
  const nextBaseline = createBaseline(saved);
  const laterEdit = restoreBaseline(nextBaseline);
  laterEdit.itinerary[0].items.pop();

  assert.equal(restoreBaseline(first).itinerary[0].items[0].durationMinutes, 120);
  assert.equal(restoreBaseline(nextBaseline).itinerary[0].items[0].durationMinutes, 150);
  assert.equal(restoreBaseline(nextBaseline).itinerary[0].items.length, 3);
});

test('daily summaries derive count, route, and time range from current activities', () => {
  const summary = summarizeDay({ items: [{ title: 'Bãi Thùng', startTime: '11:45', endTime: '14:45' }] });
  assert.equal(summary.count, 1);
  assert.equal(summary.hasActivities, true);
  assert.equal(summary.route, 'Bãi Thùng');
  assert.equal(summary.routeLabel, 'Lộ trình');
  assert.equal(summary.timeRange, '11:45–14:45');

  const empty = summarizeDay({ items: [] });
  assert.equal(empty.count, 0);
  assert.equal(empty.hasActivities, false);
  assert.equal(empty.route, '');
  assert.equal(empty.timeRange, '');
});

test('navigation summaries update immediately after cross-day move, remove, reset, and replan', () => {
  const baselineDays = sampleDays();
  const moved = moveItineraryItem(baselineDays, { fromDayIndex: 0, itemIndex: 0, toDayIndex: 1, intensity: 'balanced' });
  assert.deepEqual(summarizeItinerary(moved).days.map((day) => day.count), [2, 2]);

  const removed = moved.map((day) => ({ ...day, items: [...day.items] }));
  removed[0].items.shift();
  assert.deepEqual(summarizeItinerary(removed).days.map((day) => day.count), [1, 2]);

  const restored = restoreBaseline(createBaseline({ itinerary: baselineDays }));
  assert.deepEqual(summarizeItinerary(restored.itinerary).days.map((day) => day.count), [3, 1]);

  const replanned = replanItinerary({ days: baselineDays, intensity: 'balanced', disruption: { type: 'skip', dayIndex: 0, itemId: baselineDays[0].items[0].id } });
  assert.deepEqual(summarizeItinerary(replanned.days).days.map((day) => day.count), [2, 1]);
  assert.equal(summarizeItinerary(replanned.days).activityCount, 3);
});
