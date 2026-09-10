(function attachDayNavigation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PinkTripDayNavigation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createDayNavigation() {
  function activeDayIndex(value, dayCount) {
    return Number.isInteger(value) && value >= 0 && value < dayCount ? value : null;
  }

  function navigationState(value, dayCount) {
    const activeDay = activeDayIndex(value, dayCount);
    return {
      activeDay,
      overviewActive: activeDay === null
    };
  }

  return { activeDayIndex, navigationState };
}));
