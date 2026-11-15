import {
  resolveTestPaymentTotal,
  resolveHomeCollectionPaymentAmount,
} from '../services/labOrder.service';

describe('resolveTestPaymentTotal', () => {
  it('returns the submitted price unchanged when there is no home collection', () => {
    expect(resolveTestPaymentTotal(270, undefined)).toBe(270);
    expect(resolveTestPaymentTotal(270, null)).toBe(270);
  });

  it('subtracts the home collection fee before the test split', () => {
    // 3 tests @100/listed with 10% discount, paid 270 for the tests, plus a
    // 500 home collection fee submitted together as one total of 770.
    expect(resolveTestPaymentTotal(770, 500)).toBe(270);
  });

  it('never goes negative when the fee exceeds what was submitted', () => {
    expect(resolveTestPaymentTotal(300, 500)).toBe(0);
  });
});

describe('resolveHomeCollectionPaymentAmount', () => {
  it('records the full fee when the submitted amount covers it', () => {
    // 600 submitted, 500 fee — fee is fully covered, with 100 left for tests.
    expect(resolveHomeCollectionPaymentAmount(600, 500)).toBe(500);
  });

  it('caps the recorded fee payment at what was actually submitted', () => {
    // Only 450 submitted against a 500 fee — must never record more than
    // what was actually handed over, even though the fee itself is bigger.
    expect(resolveHomeCollectionPaymentAmount(450, 500)).toBe(450);
  });

  it('records the full fee exactly when the submitted amount matches it', () => {
    expect(resolveHomeCollectionPaymentAmount(500, 500)).toBe(500);
  });
});
