import { AddOnService } from '../services/addon.service';

// One second short of N whole days, so Math.ceil lands exactly on N.
const inDays = (n: number) =>
  new Date(Date.now() + n * 24 * 60 * 60 * 1000 - 1000);

describe('AddOnService.calculateProRatedPrice (days left in the period)', () => {
  it('charges the daily rate × days left × quantity, monthly', () => {
    expect(
      AddOnService.calculateProRatedPrice(499, inDays(15), 'monthly', 3)
    ).toEqual({
      proRatedPrice: 748.5,
      remainingDays: 15,
      totalDays: 30,
    });
  });

  it('uses the yearly price on a yearly plan', () => {
    expect(
      AddOnService.calculateProRatedPrice(500, inDays(73), 'yearly', 1, 4800)
    ).toEqual({
      proRatedPrice: 960,
      remainingDays: 73,
      totalDays: 365,
    });
  });

  it('falls back to monthly × 12 when the add-on has no yearly price', () => {
    expect(
      AddOnService.calculateProRatedPrice(500, inDays(73), 'yearly')
        .proRatedPrice
    ).toBe(1200);
  });

  it('charges at least one day, even when the period already ended', () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(AddOnService.calculateProRatedPrice(300, past, 'monthly')).toEqual({
      proRatedPrice: 10,
      remainingDays: 1,
      totalDays: 30,
    });
  });

  it('rounds to the paisa', () => {
    expect(
      AddOnService.calculateProRatedPrice(199, inDays(7), 'monthly', 2)
        .proRatedPrice
    ).toBe(92.87);
  });
});
