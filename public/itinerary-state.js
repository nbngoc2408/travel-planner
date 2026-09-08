(function attachItineraryState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PinkTripItineraryState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createItineraryState() {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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

  return { clone, createBaseline, restoreBaseline, itineraryPlaceIds };
}));
