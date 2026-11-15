export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export type RatingBreakdown = Record<ReviewRating, number>;

export interface RatingCountRow {
  rating: number;
  count: number;
}

export interface DoctorReviewsSummary {
  averageRating: number;
  totalReviews: number;
  breakdown: RatingBreakdown;
}
