import { reducedQuantity, seatExcess } from '../utils/addOnChange.utils';

describe('reducedQuantity', () => {
  it('reduces from the current quantity', () => {
    expect(reducedQuantity(5, null, 2)).toBe(3);
  });

  it('counts from an already scheduled reduce', () => {
    expect(reducedQuantity(5, 3, 1)).toBe(2);
  });

  it('allows reaching 0, which is a removal', () => {
    expect(reducedQuantity(2, null, 2)).toBe(0);
  });

  it('refuses below 0 or a non-positive step', () => {
    expect(reducedQuantity(2, null, 3)).toBeNull();
    expect(reducedQuantity(2, null, 0)).toBeNull();
  });
});

describe('seatExcess', () => {
  it('4 active doctors, limit 4 → 3: one must be picked', () => {
    expect(seatExcess(4, 4, 1, 1)).toBe(1);
  });

  it('room to spare needs no pick', () => {
    expect(seatExcess(2, 5, 2, 1)).toBe(0);
  });

  it('counts the unit value of a pack', () => {
    expect(seatExcess(10, 10, 1, 5)).toBe(5);
  });
});
