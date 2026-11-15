import type {
  DoctorReviewsSummary,
  RatingBreakdown,
  RatingCountRow,
  ReviewRating,
} from '../types/doctorReview.types';

export const MY_REVIEWS_MAX_PAGE_SIZE = 50;

export const buildReviewsSummary = (
  rows: RatingCountRow[]
): DoctorReviewsSummary => {
  const breakdown: RatingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalReviews = 0;
  let ratingSum = 0;

  for (const { rating, count } of rows) {
    if (rating in breakdown) {
      breakdown[rating as ReviewRating] = count;
      totalReviews += count;
      ratingSum += rating * count;
    }
  }

  return {
    averageRating: totalReviews
      ? Math.round((ratingSum / totalReviews) * 10) / 10
      : 0,
    totalReviews,
    breakdown,
  };
};

export const buildPagination = (
  totalItems: number,
  pageNumber: number,
  pageSize: number
) => ({
  totalItems,
  pageNumber,
  pageSize,
  totalPages: Math.ceil(totalItems / pageSize),
});
