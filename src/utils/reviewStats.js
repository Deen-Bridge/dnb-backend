/**
 * Compute review aggregate statistics (rating, numReviews, ratingBreakdown) from a reviews array.
 * @param {Array<{ rating: number }>} reviews
 * @returns {{ rating: number, numReviews: number, ratingBreakdown: Record<number, number> }}
 */
export const computeReviewStats = (reviews = []) => {
  const numReviews = reviews.length;
  const ratingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  if (numReviews === 0) {
    return {
      rating: 0,
      numReviews: 0,
      ratingBreakdown,
    };
  }

  let totalRating = 0;
  for (const review of reviews) {
    const r = Number(review.rating) || 0;
    const star = Math.round(r);
    if (star >= 1 && star <= 5) {
      ratingBreakdown[star] = (ratingBreakdown[star] || 0) + 1;
    }
    totalRating += r;
  }

  const avgRating = Math.round((totalRating / numReviews) * 10) / 10;

  return {
    rating: avgRating,
    numReviews,
    ratingBreakdown,
  };
};

/**
 * Recalculate and update review stats on a Mongoose document (Course or Book).
 * @param {import("mongoose").Document} doc - Course or Book Mongoose document with reviews
 */
export const recomputeAndSaveStats = async (doc) => {
  const stats = computeReviewStats(doc.reviews);
  doc.rating = stats.rating;
  doc.numReviews = stats.numReviews;
  doc.ratingBreakdown = stats.ratingBreakdown;
  await doc.save();
  return stats;
};
