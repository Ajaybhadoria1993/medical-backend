// unitCostWithTax: Meta's rate plus GST, as the 4-decimal string the column stores.
import { unitCostWithTax } from '../utils/cost.utils';

it('adds GST to the seeded rate: ₹0.1150 + 18% = ₹0.1357', () => {
  expect(unitCostWithTax('0.1150', '18.00')).toBe('0.1357');
});

it('uses whatever rate and tax are in force', () => {
  expect(unitCostWithTax('0.1300', '18.00')).toBe('0.1534');
  expect(unitCostWithTax('0.1150', '0.00')).toBe('0.1150');
});
