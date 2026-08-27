function emptyRatingSummary() {
  return { average: null, count: 0 };
}

function summarizeRatings(reviews = []) {
  const ratings = reviews
    .map((review) => Number(review.rating))
    .filter((rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5);
  if (!ratings.length) return emptyRatingSummary();
  const average = ratings.reduce((total, rating) => total + rating, 0) / ratings.length;
  return { average: Math.round(average * 10) / 10, count: ratings.length };
}

function ratingDistribution(reviews = []) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach((review) => {
    const rating = Number(review.rating);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) distribution[rating] += 1;
  });
  return distribution;
}

function summariesBy(reviews = [], key, ids = []) {
  const grouped = new Map(ids.map((id) => [id, []]));
  reviews.forEach((review) => {
    const id = review[key];
    if (id && grouped.has(id)) grouped.get(id).push(review);
  });
  return Object.fromEntries([...grouped].map(([id, items]) => [id, summarizeRatings(items)]));
}

function getPlaceRatingSummaries(reviews = [], placeIds = []) {
  return summariesBy(reviews.filter((review) => review.placeId), 'placeId', placeIds);
}

function getDestinationRatingSummaries(reviews = [], destinationIds = []) {
  return summariesBy(reviews.filter((review) => !review.placeId), 'destinationId', destinationIds);
}

module.exports = {
  emptyRatingSummary,
  summarizeRatings,
  ratingDistribution,
  getPlaceRatingSummaries,
  getDestinationRatingSummaries
};
