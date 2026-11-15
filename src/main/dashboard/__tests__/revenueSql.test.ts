import { clinicAmountLines } from '../utils/revenueSql';

// Mirrors CLINIC_AMOUNT: Payments History and the dashboard must sum the same per row.
describe('clinicAmountLines', () => {
  it('leaves the platform fee out of an online booking', () => {
    expect(clinicAmountLines('1312.00', '1346.00', [])).toEqual({
      primary: 1312,
      total: 1312,
    });
  });

  it('adds services added after booking to the primary price', () => {
    expect(clinicAmountLines('500', '700', [200])).toEqual({
      primary: 500,
      total: 700,
    });
  });

  it('reads the whole amount from price when primaryServicePrice is missing', () => {
    expect(clinicAmountLines(null, '300', [300])).toEqual({
      primary: 0,
      total: 300,
    });
    expect(clinicAmountLines(null, '450', [])).toEqual({
      primary: 450,
      total: 450,
    });
  });
});
