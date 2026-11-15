import {
  buildPagination,
  buildReviewsSummary,
} from '../utils/doctorReview.utils';

describe('buildReviewsSummary', () => {
  it('returns zeros for no reviews', () => {
    expect(buildReviewsSummary([])).toEqual({
      averageRating: 0,
      totalReviews: 0,
      breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it('ignores out-of-range ratings', () => {
    const summary = buildReviewsSummary([
      { rating: 5, count: 2 },
      { rating: 9, count: 4 },
    ]);
    expect(summary.totalReviews).toBe(2);
    expect(summary.averageRating).toBe(5);
  });
});

describe('buildPagination', () => {
  it('computes total pages', () => {
    expect(buildPagination(5, 1, 2).totalPages).toBe(3);
    expect(buildPagination(0, 1, 10).totalPages).toBe(0);
  });
});
