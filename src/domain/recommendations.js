const CATEGORY_ALIASES = { photo: 'photography', activity: 'experience' };

function normalizeCategory(category) {
  return CATEGORY_ALIASES[category] || category;
}

function filterPlaces(places, interests = []) {
  const interestSet = new Set(interests.map(normalizeCategory));
  if (!interestSet.size) return [...places];
  return places.filter((place) => interestSet.has(normalizeCategory(place.category)));
}

function scorePlace(place, { interests = [], budgetPerStop = Infinity, intensity = 'balanced' } = {}) {
  const interestSet = new Set(interests.map(normalizeCategory));
  let score = 0;
  if (interestSet.has(normalizeCategory(place.category))) score += 5;
  if (place.hiddenGem) score += 2;
  if (place.estimatedCost <= budgetPerStop) score += 2;
  if (intensity === 'relaxed' && place.category === 'wellness') score += 2;
  if (intensity === 'packed' && place.recommendedDurationMinutes <= 120) score += 1;
  return score;
}

function recommendPlaces(places, config) {
  const ranked = places
    .map((place) => ({ place, score: scorePlace(place, config) }))
    .sort((a, b) => b.score - a.score || a.place.estimatedCost - b.place.estimatedCost);
  return ranked.map(({ place }) => place);
}

module.exports = { recommendPlaces, scorePlace, filterPlaces, normalizeCategory };
