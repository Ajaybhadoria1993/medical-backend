import { callRazorpaySdk, razorpayInstance } from '../../../utils/razorpay';

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/** New subscription code reaches Razorpay only through here; amounts are paise. */
export const razorpayClient = {
  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder> {
    const order = await callRazorpaySdk('Razorpay order creation', () =>
      razorpayInstance.orders.create({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        payment_capture: true,
        notes: input.notes,
      })
    );
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      status: order.status,
    };
  },

  fetchOrder: (orderId: string) =>
    callRazorpaySdk('Razorpay order fetch', () =>
      razorpayInstance.orders.fetch(orderId)
    ),

  fetchPayment: (paymentId: string) =>
    callRazorpaySdk('Razorpay payment fetch', () =>
      razorpayInstance.payments.fetch(paymentId)
    ),

  /** A card payment's card: network, last 4 and issuer only, never the full number. */
  fetchPaymentCard: (paymentId: string) =>
    callRazorpaySdk('Razorpay payment card fetch', () =>
      razorpayInstance.payments.fetchCardDetails(paymentId)
    ),

  orderPayments: (orderId: string) =>
    callRazorpaySdk('Razorpay order payments fetch', () =>
      razorpayInstance.orders.fetchPayments(orderId)
    ),

  /** Full refund; only a captured payment can be refunded. */
  refundPayment: (paymentId: string, notes: Record<string, string>) =>
    callRazorpaySdk('Razorpay refund', () =>
      razorpayInstance.payments.refund(paymentId, { notes })
    ),

  // ── AutoPay (Razorpay Recurring Payments): we keep the token and charge it ourselves.

  /** Returns the existing customer for this contact instead of failing on a repeat. */
  async createCustomer(input: {
    name: string;
    email?: string;
    contact?: string;
    notes: Record<string, string>;
  }): Promise<{ id: string }> {
    try {
      const customer = await callRazorpaySdk('Razorpay customer creation', () =>
        razorpayInstance.customers.create({
          name: input.name,
          email: input.email,
          contact: input.contact,
          fail_existing: 0,
          notes: input.notes,
        })
      );
      return { id: customer.id };
    } catch (error) {
      // Razorpay returns the old customer only on an exact email + phone match; find it ourselves.
      if (!/already exists/i.test(String((error as Error)?.message ?? error)))
        throw error;
      const found = await razorpayClient.findCustomer(input);
      if (!found) throw error;
      return { id: found };
    }
  },

  /** An existing customer: ours by notes.clinicId first, else the same email or phone. Pages of 100, up to 1,000. */
  async findCustomer(input: {
    email?: string;
    contact?: string;
    notes: Record<string, string>;
  }) {
    const digits = (v?: string | null) =>
      (v ?? '').replace(/D/g, '').slice(-10);
    let byContact: string | null = null;
    for (let skip = 0; skip < 1000; skip += 100) {
      const page = (await callRazorpaySdk('Razorpay customer list', () =>
        razorpayInstance.customers.all({ count: 100, skip })
      )) as {
        items: {
          id: string;
          email?: string | null;
          contact?: string | null;
          notes?: Record<string, string> | unknown[];
        }[];
      };
      for (const c of page.items) {
        const notes = Array.isArray(c.notes) ? {} : (c.notes ?? {});
        if (input.notes.clinicId && notes.clinicId === input.notes.clinicId)
          return c.id;
        const sameEmail =
          !!input.email && c.email?.toLowerCase() === input.email.toLowerCase();
        const samePhone =
          !!input.contact && digits(c.contact) === digits(input.contact);
        if ((sameEmail || samePhone) && !byContact) byContact = c.id;
      }
      if (page.items.length < 100) break;
    }
    return byContact;
  },

  /** The order the clinic approves AutoPay on; `amountPaise` is the first month, or the small check. */
  async createMandateOrder(input: {
    amountPaise: number;
    customerId: string;
    method: 'card' | 'upi' | 'emandate';
    maxAmountPaise: number;
    expireAt: Date;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder> {
    const order = await callRazorpaySdk('Razorpay AutoPay order', () =>
      razorpayInstance.orders.create({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        payment_capture: true,
        customer_id: input.customerId,
        method: input.method,
        notes: input.notes,
        token: {
          max_amount: input.maxAmountPaise,
          expire_at: Math.floor(input.expireAt.getTime() / 1000),
          // Our server sets each charge (plan + add-ons), so the bank must not fix a schedule.
          frequency: 'as_presented',
        },
      } as never)
    );
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      status: order.status,
    };
  },

  /** A renewal order; Razorpay sends the pre-debit notice and debits after `chargeAfter`. */
  async createRecurringOrder(input: {
    amountPaise: number;
    tokenId: string;
    chargeAfter: Date;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder> {
    const order = await callRazorpaySdk('Razorpay renewal order', () =>
      razorpayInstance.orders.create({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        payment_capture: true,
        notes: input.notes,
        notification: {
          token_id: input.tokenId,
          payment_after: Math.floor(input.chargeAfter.getTime() / 1000),
        },
      } as never)
    );
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      status: order.status,
    };
  },

  /** Charges a saved token; the result arrives later by webhook. */
  async chargeToken(input: {
    orderId: string;
    customerId: string;
    tokenId: string;
    amountPaise: number;
    email: string;
    contact: string;
    description: string;
    notes: Record<string, string>;
  }): Promise<{ paymentId: string }> {
    const res = await callRazorpaySdk('Razorpay recurring charge', () =>
      razorpayInstance.payments.createRecurringPayment({
        email: input.email,
        contact: input.contact,
        amount: input.amountPaise,
        currency: 'INR',
        order_id: input.orderId,
        customer_id: input.customerId,
        token: input.tokenId,
        recurring: '1',
        description: input.description,
        notes: input.notes,
      } as never)
    );
    // Without a payment id the charge cannot be tracked; the renewal job marks the try failed.
    if (!res.razorpay_payment_id) {
      throw new Error(
        'Razorpay did not return a payment id for the recurring charge'
      );
    }
    return { paymentId: res.razorpay_payment_id };
  },

  /** One page of all payments on our Razorpay account in a time window (Unix seconds). */
  listPayments: (q: {
    from: number;
    to: number;
    count: number;
    skip: number;
  }) =>
    callRazorpaySdk('Razorpay payments list', () =>
      razorpayInstance.payments.all(q)
    ),

  fetchToken: (customerId: string, tokenId: string) =>
    callRazorpaySdk('Razorpay token fetch', () =>
      razorpayInstance.customers.fetchToken(customerId, tokenId)
    ),

  /** Turns AutoPay off at Razorpay; no further charge can be made on this token. */
  // An active AutoPay token must be cancelled, not deleted (Razorpay refuses the delete); the SDK has no call for it.
  cancelToken: (customerId: string, tokenId: string) =>
    callRazorpaySdk('Razorpay token cancel', () =>
      razorpayInstance.api.put({
        url: `/customers/${customerId}/tokens/${tokenId}/cancel`,
      })
    ),

  deleteToken: (customerId: string, tokenId: string) =>
    callRazorpaySdk('Razorpay token delete', () =>
      razorpayInstance.customers.deleteToken(customerId, tokenId)
    ),

  /** Turns an AutoPay token off: UPI and eMandate are cancelled; a card token cannot be ("cannot be revoked"), so it is deleted. */
  stopToken: (customerId: string, tokenId: string, method: string) =>
    method === 'card'
      ? razorpayClient.deleteToken(customerId, tokenId)
      : razorpayClient.cancelToken(customerId, tokenId),
};
