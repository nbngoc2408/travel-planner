(function attachItineraryState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PinkTripItineraryState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createItineraryState() {
  function clone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  function createBaseline({ itinerary = [], budget = {} } = {}) {
    return { itinerary: clone(itinerary), budget: clone(budget) };
  }

  function restoreBaseline(baseline) {
    return baseline ? createBaseline(baseline) : null;
  }

  function itineraryPlaceIds(days = []) {
    return [...new Set(days.flatMap((day) => (day.items || []).map((item) => item.placeId).filter(Boolean)))];
  }

  function dayItems(day = {}) {
    return Array.isArray(day.items) ? day.items.filter(Boolean) : [];
  }

  function parseTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours * 60 + minutes;
  }

  function formatTime(totalMinutes) {
    return String(Math.floor(totalMinutes / 60)).padStart(2, '0') + ':' + String(totalMinutes % 60).padStart(2, '0');
  }

  function dayTimeRange(items) {
    const starts = items.map((item) => parseTime(item.startTime)).filter((value) => value !== null);
    const ends = items.map((item) => parseTime(item.endTime)).filter((value) => value !== null);
    if (!starts.length || !ends.length) return '';
    return formatTime(Math.min(...starts)) + '–' + formatTime(Math.max(...ends));
  }

  function dayRouteDetails(items) {
    const hasAreaMetadata = items.some((item) => item.areaLabel || item.area);
    const values = [...new Set(items.map((item) => item.areaLabel || item.area || item.title).filter(Boolean))];
    return { label: hasAreaMetadata ? 'Khu vực' : 'Lộ trình', text: values.join(' → ') };
  }

  function dayRoute(items) {
    return dayRouteDetails(items).text;
  }

  // Itinerary items are place/experience activities; travel gaps are implicit
  // in their schedule and are not counted as activities.
  function summarizeDay(day = {}) {
    const items = dayItems(day);
    return {
      items,
      count: items.length,
      hasActivities: items.length > 0,
      route: dayRoute(items),
      routeLabel: dayRouteDetails(items).label,
      timeRange: dayTimeRange(items)
    };
  }

  function summarizeItinerary(days = []) {
    const summaries = days.map(summarizeDay);
    const activityCount = summaries.reduce((total, summary) => total + summary.count, 0);
    return {
      days: summaries,
      activityCount,
      activeDays: summaries.filter((summary) => summary.hasActivities).length
    };
  }

  return { clone, createBaseline, restoreBaseline, itineraryPlaceIds, dayItems, parseTime, dayTimeRange, dayRoute, summarizeDay, summarizeItinerary };
}));
