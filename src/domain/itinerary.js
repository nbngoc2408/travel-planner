const INTENSITY = {
  relaxed: { maxStops: 2, start: 9 * 60, gap: 90 },
  balanced: { maxStops: 3, start: 8 * 60, gap: 50 },
  packed: { maxStops: 4, start: 7 * 60 + 30, gap: 25 }
};

const DAY_END = 20 * 60 + 30;
const WEATHER_PRIORITY = new Set(['food', 'culture', 'experience', 'wellness']);

function addMinutes(time, minutes) {
  const total = time + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function parseTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

function sourcePlaceId(source) {
  return source?.placeId || source?.id;
}

function travelDuration(previous, current, travelTimes = []) {
  if (!previous || !current) return 0;
  const fromPlaceId = sourcePlaceId(previous);
  const toPlaceId = sourcePlaceId(current);
  const explicit = travelTimes.find((entry) => (entry.fromPlaceId === fromPlaceId && entry.toPlaceId === toPlaceId)
    || (entry.fromPlaceId === toPlaceId && entry.toPlaceId === fromPlaceId));
  if (explicit?.durationMinutes) return explicit.durationMinutes;
  if (previous.area && current.area) return previous.area === current.area ? 12 : 35;
  return 20;
}

function settingsFor(intensity = 'balanced') {
  return INTENSITY[intensity] || INTENSITY.balanced;
}

function formatRange(start, duration) {
  return `${addMinutes(start, 0)} – ${addMinutes(start, duration)}`;
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) return 1;
  return Math.floor((end - start) / 86400000) + 1;
}

const TIME_RANK = { morning: 0, any: 1, afternoon: 2, evening: 3 };

function orderDayPlaces(dayPlaces) {
  return [...dayPlaces].sort((left, right) => (TIME_RANK[left.bestTimeOfDay] ?? 1) - (TIME_RANK[right.bestTimeOfDay] ?? 1)
    || left.recommendedDurationMinutes - right.recommendedDurationMinutes
    || String(left.name).localeCompare(String(right.name), 'vi'));
}

function fitsDay(dayPlaces, settings, travelTimes) {
  let cursor = settings.start;
  let previous = null;
  for (const place of orderDayPlaces(dayPlaces)) {
    cursor += previous ? travelDuration(previous, place, travelTimes) + settings.gap : 0;
    cursor += Math.max(30, Number(place.recommendedDurationMinutes) || 120);
    if (cursor > DAY_END) return false;
    previous = place;
  }
  return true;
}

function candidateScore(candidate, dayPlaces, remaining) {
  const sameArea = dayPlaces.length && dayPlaces[0].area && candidate.area === dayPlaces[0].area;
  const areaCount = remaining.filter((place) => place.area === candidate.area).length;
  const usedCategories = new Set(dayPlaces.map((place) => place.category));
  const timeTarget = ['morning', 'any', 'afternoon', 'evening'][Math.min(dayPlaces.length, 3)];
  return (sameArea ? 20 : dayPlaces.length ? 0 : areaCount * 3)
    + (!usedCategories.has(candidate.category) ? 4 : 0)
    + (candidate.bestTimeOfDay === timeTarget ? 3 : candidate.bestTimeOfDay === 'any' ? 1 : 0)
    - Math.max(0, (Number(candidate.recommendedDurationMinutes) || 120) - 150) / 90;
}

function generateItinerary({ places = [], startDate, endDate, intensity = 'balanced', travelTimes = [] }) {
  const totalDays = daysBetween(startDate, endDate);
  const settings = settingsFor(intensity);
  const seenPlaceIds = new Set();
  const remaining = places.filter((place) => place?.id && !seenPlaceIds.has(place.id) && seenPlaceIds.add(place.id));
  const days = [];

  for (let dayIndex = 0; dayIndex < totalDays; dayIndex += 1) {
    const dayPlaces = [];
    while (dayPlaces.length < settings.maxStops && remaining.length) {
      const candidates = [...remaining].sort((left, right) => candidateScore(right, dayPlaces, remaining) - candidateScore(left, dayPlaces, remaining)
        || (left.recommendedDurationMinutes || 120) - (right.recommendedDurationMinutes || 120)
        || String(left.name).localeCompare(String(right.name), 'vi'));
      const next = candidates.find((place) => fitsDay([...dayPlaces, place], settings, travelTimes));
      if (!next) break;
      dayPlaces.push(next);
      remaining.splice(remaining.indexOf(next), 1);
    }

    let cursor = settings.start;
    let previous = null;
    const items = orderDayPlaces(dayPlaces).map((place, index) => {
      cursor += previous ? travelDuration(previous, place, travelTimes) + settings.gap : 0;
      const duration = Math.max(30, Number(place.recommendedDurationMinutes) || 120);
      const item = {
        id: `item-${Date.now()}-${dayIndex}-${index}`,
        placeId: place.id,
        title: place.name,
        category: place.category,
        area: place.area,
        areaLabel: place.areaLabel,
        startTime: addMinutes(cursor, 0),
        endTime: addMinutes(cursor, duration),
        durationMinutes: duration,
        estimatedCost: place.estimatedCost || 0,
        note: place.notes?.[0] || 'Mang theo nước và giày thoải mái.'
      };
      cursor += duration;
      previous = place;
      return item;
    });
    days.push({ date: addDate(startDate, dayIndex), items });
  }
  return days;
}

function recalculateItinerary(days = [], { intensity = 'balanced', travelTimes = [] } = {}) {
  const settings = settingsFor(intensity);
  return days.map((day) => {
    if (!day?.items?.length) return { ...day, items: [] };
    const requiredMinutes = day.items.reduce((total, source, index) => {
      const duration = Math.max(30, Number(source.durationMinutes) || 120);
      const previous = day.items[index - 1];
      const travel = previous ? travelDuration(previous, source, travelTimes) : 0;
      return total + duration + (index ? settings.gap + travel : 0);
    }, 0);
    const latestStart = Math.max(settings.start, DAY_END - requiredMinutes);
    const firstStart = Math.min(parseTime(day.items[0].startTime) ?? settings.start, latestStart);
    let cursor = firstStart;
    let previous = null;
    const items = day.items.map((source, index) => {
      const duration = Math.max(30, Number(source.durationMinutes) || 120);
      cursor += travelDuration(previous, source, travelTimes);
      const item = { ...source, startTime: addMinutes(cursor, 0), endTime: addMinutes(cursor, duration), durationMinutes: duration };
      cursor += duration + settings.gap;
      previous = item;
      return item;
    });
    return { ...day, items };
  });
}

function moveItineraryItem(days, { fromDayIndex, itemIndex, toDayIndex, toIndex = null, intensity = 'balanced', travelTimes = [] } = {}) {
  const next = days.map((day) => ({ ...day, items: [...(day.items || [])] }));
  const from = next[Number(fromDayIndex)];
  const to = next[Number(toDayIndex)];
  if (!from || !to || !from.items[Number(itemIndex)]) return recalculateItinerary(next, { intensity, travelTimes });
  const [item] = from.items.splice(Number(itemIndex), 1);
  let insertion = toIndex === null || toIndex === undefined ? to.items.length : Number(toIndex);
  insertion = Math.max(0, Math.min(insertion, to.items.length));
  to.items.splice(insertion, 0, item);
  return recalculateItinerary(next, { intensity, travelTimes });
}

function replanItinerary({ days = [], disruption = {}, intensity = 'balanced', travelTimes = [] } = {}) {
  const original = days.map((day) => ({ ...day, items: [...(day.items || [])] }));
  const completedIds = new Set(Array.isArray(disruption.completedItemIds) ? disruption.completedItemIds : []);
  const affectedDay = Math.max(0, Math.min(original.length - 1, Number(disruption.dayIndex) || 0));
  const unavailableIds = new Set();
  const removalReasons = new Map();
  const type = disruption.type || 'late-start';
  if (['place-unavailable', 'skip'].includes(type) && disruption.itemId) {
    unavailableIds.add(disruption.itemId);
    removalReasons.set(disruption.itemId, type === 'skip' ? 'skipped' : 'unavailable');
  }
  const blockedUntil = ['late-start', 'rest', 'activity-overrun'].includes(type) ? parseTime(disruption.availableFrom) : null;
  const delayMinutes = type === 'transport-delay' ? Math.max(0, Number(disruption.delayMinutes) || 0) : 0;
  const settings = settingsFor(intensity);
  const completedByDay = original.map((day) => day.items.filter((item) => completedIds.has(item.id)));
  const assignedByDay = original.map(() => []);
  let remaining = [];

  original.forEach((day, dayIndex) => day.items.forEach((item, itemIndex) => {
    if (!completedIds.has(item.id) && !unavailableIds.has(item.id)) remaining.push({ item, dayIndex, itemIndex });
  }));
  if (type === 'bad-weather') {
    remaining = [...remaining].sort((a, b) => {
      const aPriority = WEATHER_PRIORITY.has(a.item.category) ? 0 : 1;
      const bPriority = WEATHER_PRIORITY.has(b.item.category) ? 0 : 1;
      return aPriority - bPriority || a.dayIndex - b.dayIndex || a.itemIndex - b.itemIndex;
    });
  }

  function scheduledItems(dayIndex) { return [...completedByDay[dayIndex], ...assignedByDay[dayIndex]]; }

  function slotFor(dayIndex, item) {
    const scheduled = scheduledItems(dayIndex);
    const latest = scheduled.reduce((latestEnd, entry) => Math.max(latestEnd, parseTime(entry.endTime) || 0), settings.start);
    const previous = scheduled.reduce((latestItem, entry) => (parseTime(entry.endTime) || 0) >= (parseTime(latestItem?.endTime) || 0) ? entry : latestItem, null);
    const lock = dayIndex === affectedDay ? (blockedUntil || settings.start) + delayMinutes : settings.start;
    const start = Math.max(settings.start, lock, latest + (scheduled.length ? settings.gap + travelDuration(previous, item, travelTimes) : 0));
    const duration = Math.max(30, Number(item.durationMinutes) || 120);
    return { start, end: start + duration, duration };
  }

  for (const entry of remaining) {
    const firstDay = Math.max(entry.dayIndex, affectedDay);
    let placed = false;
    for (let dayIndex = firstDay; dayIndex < original.length; dayIndex += 1) {
      if (completedByDay[dayIndex].length + assignedByDay[dayIndex].length >= settings.maxStops) continue;
      const slot = slotFor(dayIndex, entry.item);
      if (slot.end > DAY_END) continue;
      assignedByDay[dayIndex].push({ ...entry.item, startTime: addMinutes(slot.start, 0), endTime: addMinutes(slot.start, slot.duration), durationMinutes: slot.duration });
      placed = true;
      break;
    }
    if (!placed) {
      unavailableIds.add(entry.item.id);
      if (!removalReasons.has(entry.item.id)) removalReasons.set(entry.item.id, 'no-room');
    }
  }

  const nextDays = original.map((day, dayIndex) => ({
    ...day,
    items: [...completedByDay[dayIndex], ...assignedByDay[dayIndex]].sort((a, b) => (parseTime(a.startTime) || 0) - (parseTime(b.startTime) || 0))
  }));
  const changes = [];
  const nextLocation = new Map();
  nextDays.forEach((day, dayIndex) => day.items.forEach((item) => nextLocation.set(item.id, { dayIndex, item })));
  original.forEach((day, dayIndex) => day.items.forEach((item) => {
    const next = nextLocation.get(item.id);
    if (!next) {
      changes.push({ itemId: item.id, title: item.title, kind: 'removed', fromDay: dayIndex, reason: removalReasons.get(item.id) || 'no-room' });
      return;
    }
    const moved = next.dayIndex !== dayIndex;
    const timeChanged = next.item.startTime !== item.startTime;
    if (moved || timeChanged) changes.push({ itemId: item.id, title: item.title, kind: moved ? 'moved' : 'time', fromDay: dayIndex, toDay: next.dayIndex, fromTime: item.startTime, toTime: next.item.startTime });
  }));
  if (!changes.length) changes.push({ kind: 'unchanged', title: 'Các hoạt động còn lại vẫn giữ nguyên.' });
  return { days: nextDays, changes, unavailableItemIds: [...unavailableIds], affectedDay, disruptionType: type };
}

function addDate(dateString, offset) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return date.toISOString().slice(0, 10);
}

module.exports = { generateItinerary, daysBetween, recalculateItinerary, moveItineraryItem, replanItinerary, parseTime, addMinutes, travelDuration };
