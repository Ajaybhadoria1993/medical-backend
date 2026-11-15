import crypto from 'crypto';
import { RazorpayWebhookRouter as Router } from '../services/razorpayWebhookRouter.service';
import { razorpayWebhookController } from '../controllers/webhook.controller';

// Every owner is a stub: these tests check which one an event reaches.
const sub = { isOurs: jest.fn(), dispatch: jest.fn(), receive: jest.fn() };
const patient = {
  confirmPaymentAndAppoint: jest.fn(),
  handlePaymentFailure: jest.fn(),
};
const account = { handles: jest.fn(), handle: jest.fn() };
const finance = { handleRazorpayWebhook: jest.fn() };
jest.mock('../../subscription', () => ({ WebhookService: sub }));
jest.mock('../../patient/services/patient.service', () => ({
  PatientService: patient,
}));
jest.mock('../services/payoutAccount/payoutAccountWebhook.service', () => ({
  // Looked up on call: the router imports this at load, before `account` exists.
  PayoutAccountWebhookService: {
    handles: (e: string) => account.handles(e),
    handle: (e: string, p: unknown) => account.handle(e, p),
  },
}));
jest.mock(
  '../../clinicFinance/services/financeProviderWebhook.service',
  () => ({
    ClinicFinanceProviderWebhookService: finance,
  })
);
jest.mock('../../../utils/logger');
jest.mock('../../../utils/envConfig', () => ({
  envConfig: {
    RAZORPAY_KEY_ID: 'rzp_test_x',
    RAZORPAY_KEY_SECRET: 'x',
    RAZORPAY_WEBHOOK_SECRET: 'sub_secret',
    RAZORPAY_WEBHOOK_APP_SECRET: 'app_secret',
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  sub.isOurs.mockResolvedValue(false);
  account.handles.mockReturnValue(false);
  finance.handleRazorpayWebhook.mockResolvedValue(false);
});

const appointmentPayment = (
  event: string,
  notes: object = { appointmentId: 'a1', patientId: 'p1' }
) => ({
  event,
  payload: { payment: { entity: { id: 'pay_1', notes } } },
});

describe('RazorpayWebhookRouter.route', () => {
  it('only stores the event in the inbox, so the reply is immediate', async () => {
    await Router.route(appointmentPayment('payment.captured'), 'evt_9');
    expect(sub.receive).toHaveBeenCalledWith(
      'evt_9',
      expect.objectContaining({ event: 'payment.captured' })
    );
    expect(patient.confirmPaymentAndAppoint).not.toHaveBeenCalled();
  });

  it('without an event id header it uses a stable id from the event', async () => {
    await Router.route(appointmentPayment('payment.captured'));
    expect(sub.receive).toHaveBeenCalledWith(
      'payment.captured:pay_1:',
      expect.anything()
    );
  });
});

describe('RazorpayWebhookRouter.dispatch', () => {
  it('an app booking is confirmed by its checkout reference; a failed one is released', async () => {
    const notes = {
      sourceType: 'APPOINTMENT',
      checkoutReferenceId: 'tmp1',
      patientId: 'p1',
    };
    await Router.dispatch(appointmentPayment('payment.captured', notes));
    await Router.dispatch(appointmentPayment('payment.failed', notes));
    expect(patient.confirmPaymentAndAppoint).toHaveBeenCalledWith(
      'tmp1',
      'pay_1',
      'p1'
    );
    expect(patient.handlePaymentFailure).toHaveBeenCalledWith(
      'tmp1',
      'pay_1',
      'p1'
    );
  });

  it('a checkout reference from another source is not treated as a booking', async () => {
    await Router.dispatch(
      appointmentPayment('payment.captured', {
        sourceType: 'PLAN',
        checkoutReferenceId: 'x',
        patientId: 'p1',
      })
    );
    expect(patient.confirmPaymentAndAppoint).not.toHaveBeenCalled();
  });

  it('AutoPay and our subscription payments go to the subscription inbox', async () => {
    await Router.dispatch({ event: 'token.confirmed' });
    sub.isOurs.mockResolvedValue(true);
    await Router.dispatch(appointmentPayment('payment.captured', {}));
    expect(sub.dispatch).toHaveBeenCalledTimes(2);
    expect(patient.confirmPaymentAndAppoint).not.toHaveBeenCalled();
  });

  it('an appointment payment is confirmed; a failed one is recorded', async () => {
    await Router.dispatch(appointmentPayment('payment.captured'));
    expect(patient.confirmPaymentAndAppoint).toHaveBeenCalledWith(
      'a1',
      'pay_1',
      'p1'
    );
    await Router.dispatch(appointmentPayment('payment.failed'));
    expect(patient.handlePaymentFailure).toHaveBeenCalledWith(
      'a1',
      'pay_1',
      'p1'
    );
  });

  it('account and Route events go to the onboarding handler', async () => {
    account.handles.mockReturnValue(true);
    await Router.dispatch({
      event: 'product.route.activated',
      payload: { x: 1 },
    });
    expect(account.handle).toHaveBeenCalledWith('product.route.activated', {
      x: 1,
    });
  });

  it('settlement, transfer and dispute events go to clinic finance', async () => {
    finance.handleRazorpayWebhook.mockResolvedValue(true);
    const body = { event: 'settlement.processed' };
    await Router.dispatch(body);
    expect(finance.handleRazorpayWebhook).toHaveBeenCalledWith(body);
  });

  it('an unknown event is acknowledged without a handler', async () => {
    await expect(
      Router.dispatch({ event: 'invoice.paid' })
    ).resolves.toBeUndefined();
  });
});

describe('razorpayWebhookController: signature', () => {
  const call = async (secret: string | null) => {
    const raw = JSON.stringify({ event: 'invoice.paid' });
    const sig = secret
      ? crypto.createHmac('sha256', secret).update(raw).digest('hex')
      : undefined;
    const req = {
      rawBody: Buffer.from(raw),
      body: JSON.parse(raw),
      get: (h: string) => (h === 'x-razorpay-signature' ? sig : undefined),
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await (razorpayWebhookController as any)(req, res, next);
    return { res, next };
  };

  it.each(['sub_secret', 'app_secret'])(
    'accepts a body signed with %s',
    async (s) => {
      const { res, next } = await call(s);
      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    }
  );

  it('refuses a wrong or missing signature', async () => {
    for (const s of ['wrong', null]) {
      const { next } = await call(s);
      expect(next.mock.calls[0][0]).toMatchObject({ status: 400 });
    }
  });
});
