import { SubscriptionOverviewService } from '../services/core/subscriptionOverview.service';
import { SubscriptionService } from '../services/subscription.service';
import { AddOnPricingService } from '../services/billing/addOnPricing.service';
import { InvoiceService } from '../services/billing/invoice.service';

jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));

describe('billing page data', () => {
  afterEach(() => jest.restoreAllMocks());

  it('catalog returns every plan with its on-sale flag and the shared add-on prices', async () => {
    jest.spyOn(SubscriptionService, 'getPlans').mockResolvedValue([
      { id: 'p1', isActive: true },
      { id: 'p2', isActive: false },
    ] as never);
    jest
      .spyOn(AddOnPricingService, 'publicCatalog')
      .mockResolvedValue([{ id: 'a1', monthlyPrice: 99 }] as never);

    const catalog = await SubscriptionOverviewService.catalog();

    expect(catalog.plans.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(catalog.addOns).toEqual([{ id: 'a1', monthlyPrice: 99 }]);
  });

  it('page returns the clinic overview, add-on availability and the last 5 invoices', async () => {
    jest
      .spyOn(SubscriptionOverviewService, 'get')
      .mockResolvedValue({ subscription: null, hasActive: false } as never);
    jest
      .spyOn(AddOnPricingService, 'availability')
      .mockResolvedValue([{ id: 'a1', owned: 2, maxQuantity: 3 }] as never);
    jest
      .spyOn(InvoiceService, 'history')
      .mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => ({ id: `i${i}` })) as never
      );

    const page = await SubscriptionOverviewService.page('c-1');

    expect(page.hasActive).toBe(false);
    expect(page.addOnAvailability).toEqual([
      { id: 'a1', owned: 2, maxQuantity: 3 },
    ]);
    expect(page.recentInvoices).toHaveLength(5);
    expect(page.hasMoreInvoices).toBe(true);
    expect(page).not.toHaveProperty('plans');
  });
});
