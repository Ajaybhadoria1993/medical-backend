import {
  clinicFinanceDateRangeSchema,
  disputeListQuerySchema,
  refundReviewDecisionSchema,
  settlementStatementQuerySchema,
} from '../schemas/clinicFinance.schemas';

describe('clinic finance schemas', () => {
  it('accepts an ordered finance date range', () => {
    expect(
      clinicFinanceDateRangeSchema.safeParse({
        startDate: '2026-09-01',
        endDate: '2026-09-18',
      }).success
    ).toBe(true);
  });

  it('rejects a reversed finance date range', () => {
    expect(
      clinicFinanceDateRangeSchema.safeParse({
        startDate: '2026-09-19',
        endDate: '2026-09-18',
      }).success
    ).toBe(false);
  });

  it('validates refund decisions and settlement formats', () => {
    expect(
      refundReviewDecisionSchema.safeParse({ decision: 'approved' }).success
    ).toBe(true);
    expect(
      refundReviewDecisionSchema.safeParse({ decision: 'unknown' }).success
    ).toBe(false);
    expect(settlementStatementQuerySchema.parse({}).format).toBe('pdf');
  });

  it('validates dispute status filters', () => {
    expect(
      disputeListQuerySchema.safeParse({ status: 'UNDER_REVIEW' }).success
    ).toBe(true);
    expect(disputeListQuerySchema.safeParse({ status: 'OPEN' }).success).toBe(
      false
    );
  });
});
