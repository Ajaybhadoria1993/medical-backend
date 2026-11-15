import { subscriptionInvoiceTemplate } from '../../../htmltamplates/subscriptionInvoice';

describe('subscription invoice template', () => {
  // The page is styled `text-transform: uppercase`. Razorpay IDs are
  // case-sensitive, so an uppercased pay_… no longer matches the dashboard.
  it('keeps the transaction ID in its original case', () => {
    expect(subscriptionInvoiceTemplate).toMatch(
      /\.ref-id\s*\{[^}]*text-transform:\s*none/
    );
    expect(subscriptionInvoiceTemplate).toContain(
      '<span class="ref-id">{{transactionId}}</span>'
    );
  });
});
