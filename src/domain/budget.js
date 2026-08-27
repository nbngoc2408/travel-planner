function calculateBudget({ places = [], days = 1, travelers = 1, targetBudget = 0, accommodationLevel = 'comfort' }) {
  const accommodationRate = { budget: 420000, comfort: 700000, premium: 1250000 }[accommodationLevel] || 700000;
  const transportation = Math.round((180000 + Math.max(0, days - 1) * 80000) * travelers);
  const accommodation = Math.round(accommodationRate * Math.max(0, days - 1));
  const food = Math.round(260000 * days * travelers);
  const attractions = places.reduce((total, place) => total + (place.estimatedCost || 0) * travelers, 0);
  const activities = Math.round(130000 * days * travelers);
  const miscellaneous = Math.round((transportation + food) * 0.08);
  const total = transportation + accommodation + food + attractions + activities + miscellaneous;
  return {
    transportation,
    accommodation,
    food,
    attractions,
    activities,
    miscellaneous,
    total,
    perPerson: Math.round(total / Math.max(1, travelers)),
    remaining: targetBudget ? targetBudget - total : 0,
    isOverBudget: Boolean(targetBudget && total > targetBudget)
  };
}

module.exports = { calculateBudget };
