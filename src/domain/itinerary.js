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

function travelDuration(previous, current, travelTimes = []) {
  return previous ? (travelTimes.find((entry) => entry.fromPlaceId === previous.placeId && entry.toPlaceId === current.placeId)?.durationMinutes || 20) : 0;
}

function settingsFor(intensity = 'balanced') {
  return INTENSITY[intensity] || INTENSITY.balanced;
}

function formatRange(start, duration) {
  return `${addMinutes(start, 0)} – ${addMinutes(start, duration)}`;
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) return 1;
  return Math.floor((end - start) / 86400000) + 1;
}

function generateItinerary({ places = [], startDate, endDate, intensity = 'balanced', travelTimes = [] }) {
  const totalDays = daysBetween(startDate, endDate);
  const settings = settingsFor(intensity);
  const sorted = [...places].sort((a, b) => {
    const timeRank = { morning: 0, any: 1, afternoon: 2, evening: 3 };
    return (timeRank[a.bestTimeOfDay] ?? 1) - (timeRank[b.bestTimeOfDay] ?? 1);
  });
  const dayItems = Array.from({ length: totalDays }, () => []);
  sorted.forEach((place, index) => {
    if (dayItems[index % totalDays].length < settings.maxStops) dayItems[index % totalDays].push(place);
  });
  return dayItems.map((dayPlaces, dayIndex) => {
    let cursor = settings.start;
    const items = [];
    dayPlaces.forEach((place, index) => {
      const previous = dayPlaces[index - 1];
      const travel = previous ? (travelTimes.find((entry) => entry.fromPlaceId === previous.id && entry.toPlaceId === place.id)?.durationMinutes || 20) : 0;
      cursor += travel;
      const duration = place.recommendedDurationMinutes || 120;
      items.push({
        id: `item-${Date.now()}-${dayIndex}-${index}`,
        placeId: place.id,
        title: place.name,
        category: place.category,
        startTime: addMinutes(cursor, 0),
        endTime: addMinutes(cursor, duration),
        durationMinutes: duration,
        estimatedCost: place.estimatedCost || 0,
        note: place.notes?.[0] || 'Bring water and comfortable shoes.'
      });
      cursor += duration + settings.gap;
    });
    return { date: addDate(startDate, dayIndex), items };
  });
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

module.exports = { generateItinerary, daysBetween, recalculateItinerary, moveItineraryItem, replanItinerary, parseTime, addMinutes };
