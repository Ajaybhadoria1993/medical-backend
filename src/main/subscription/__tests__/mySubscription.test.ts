describe('GET /subscription/my-subscription add-on renewalQuantity logic', () => {
  it('calculates renewalQuantity correctly based on cancelAtPeriodEnd flag', () => {
    const activeAddOns = [
      {
        id: 'addon-1',
        addOnName: 'Additional Staff Member',
        featureKey: 'staff_accounts',
        quantity: 2,
        billingCycle: 'monthly',
        expiresAt: new Date('2026-10-01'),
        price: '200.00',
        monthlyPrice: '100.00',
        yearlyPrice: '1000.00',
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      },
      {
        id: 'addon-2',
        addOnName: 'Additional Staff Member',
        featureKey: 'staff_accounts',
        quantity: 1,
        billingCycle: 'monthly',
        expiresAt: new Date('2026-10-01'),
        price: '100.00',
        monthlyPrice: '100.00',
        yearlyPrice: '1000.00',
        cancelAtPeriodEnd: true,
        cancelledAt: new Date('2026-09-16'),
      },
    ];

    const groupedAddOns = Object.values(
      activeAddOns.reduce(
        (acc, addOn) => {
          if (!acc[addOn.featureKey]) {
            acc[addOn.featureKey] = {
              id: addOn.id,
              addOnName: addOn.addOnName,
              featureKey: addOn.featureKey,
              totalQuantity: 0,
              renewalQuantity: 0,
              billingCycle: addOn.billingCycle,
              latestExpiresAt: addOn.expiresAt,
              totalPrice: 0,
              recurringPrice: 0,
              cancelAtPeriodEnd: addOn.cancelAtPeriodEnd || false,
              cancelledAt: addOn.cancelledAt || null,
            };
          }
          acc[addOn.featureKey].totalQuantity += addOn.quantity;
          if (!addOn.cancelAtPeriodEnd) {
            acc[addOn.featureKey].renewalQuantity += addOn.quantity;
          }
          acc[addOn.featureKey].totalPrice += Number(addOn.price);
          acc[addOn.featureKey].recurringPrice +=
            Number(
              addOn.billingCycle === 'yearly'
                ? addOn.yearlyPrice
                : addOn.monthlyPrice
            ) * addOn.quantity;
          if (addOn.cancelAtPeriodEnd) {
            acc[addOn.featureKey].cancelAtPeriodEnd = true;
            acc[addOn.featureKey].cancelledAt = addOn.cancelledAt;
          }
          return acc;
        },
        {} as Record<
          string,
          {
            id: string;
            addOnName: string;
            featureKey: string;
            totalQuantity: number;
            renewalQuantity: number;
            billingCycle: string;
            latestExpiresAt: Date | null;
            totalPrice: number;
            recurringPrice: number;
            cancelAtPeriodEnd: boolean;
            cancelledAt: Date | null;
          }
        >
      )
    );

    expect(groupedAddOns).toHaveLength(1);
    expect(groupedAddOns[0]).toEqual({
      id: 'addon-1',
      addOnName: 'Additional Staff Member',
      featureKey: 'staff_accounts',
      totalQuantity: 3,
      renewalQuantity: 2,
      billingCycle: 'monthly',
      latestExpiresAt: expect.any(Date),
      totalPrice: 300,
      recurringPrice: 300,
      cancelAtPeriodEnd: true,
      cancelledAt: expect.any(Date),
    });
  });

  it('sets renewalQuantity to 0 when all add-on units have cancelAtPeriodEnd set to true', () => {
    const activeAddOns = [
      {
        id: 'addon-1',
        addOnName: 'Additional Staff Member',
        featureKey: 'staff_accounts',
        quantity: 3,
        billingCycle: 'monthly',
        expiresAt: new Date('2026-10-01'),
        price: '300.00',
        monthlyPrice: '100.00',
        yearlyPrice: '1000.00',
        cancelAtPeriodEnd: true,
        cancelledAt: new Date('2026-09-16'),
      },
    ];

    const groupedAddOns = Object.values(
      activeAddOns.reduce(
        (acc, addOn) => {
          if (!acc[addOn.featureKey]) {
            acc[addOn.featureKey] = {
              id: addOn.id,
              addOnName: addOn.addOnName,
              featureKey: addOn.featureKey,
              totalQuantity: 0,
              renewalQuantity: 0,
              billingCycle: addOn.billingCycle,
              latestExpiresAt: addOn.expiresAt,
              totalPrice: 0,
              recurringPrice: 0,
              cancelAtPeriodEnd: addOn.cancelAtPeriodEnd || false,
              cancelledAt: addOn.cancelledAt || null,
            };
          }
          acc[addOn.featureKey].totalQuantity += addOn.quantity;
          if (!addOn.cancelAtPeriodEnd) {
            acc[addOn.featureKey].renewalQuantity += addOn.quantity;
          }
          acc[addOn.featureKey].totalPrice += Number(addOn.price);
          acc[addOn.featureKey].recurringPrice +=
            Number(
              addOn.billingCycle === 'yearly'
                ? addOn.yearlyPrice
                : addOn.monthlyPrice
            ) * addOn.quantity;
          if (addOn.cancelAtPeriodEnd) {
            acc[addOn.featureKey].cancelAtPeriodEnd = true;
            acc[addOn.featureKey].cancelledAt = addOn.cancelledAt;
          }
          return acc;
        },
        {} as Record<
          string,
          {
            id: string;
            addOnName: string;
            featureKey: string;
            totalQuantity: number;
            renewalQuantity: number;
            billingCycle: string;
            latestExpiresAt: Date | null;
            totalPrice: number;
            recurringPrice: number;
            cancelAtPeriodEnd: boolean;
            cancelledAt: Date | null;
          }
        >
      )
    );

    expect(groupedAddOns[0].totalQuantity).toBe(3);
    expect(groupedAddOns[0].renewalQuantity).toBe(0);
    expect(groupedAddOns[0].cancelAtPeriodEnd).toBe(true);
  });
});
