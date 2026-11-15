import {
  IFeeConfig,
  IPatientFeeLine,
  IPatientPricingSummary,
  ISplitBreakdown,
  ISplitEngineResult,
  TaxTreatment,
} from '../interfaces/splitEngine.types';

/** Run order when priorities tie: the gateway fee is charged on the subtotal of the fees before it. */
const RUN_ORDER: Record<string, number> = {
  CONVENIENCE_FEE: 1,
  CLINIC_COMMISSION: 2,
  GATEWAY_FEE: 3,
  ROUTE_TRANSFER_FEE: 4,
};
/** Who keeps each fee; a new fee type is added here and in BREAKDOWN_KEY. */
const RECEIVER: Record<string, 'platform' | 'gateway'> = {
  CONVENIENCE_FEE: 'platform',
  CLINIC_COMMISSION: 'platform',
  GATEWAY_FEE: 'gateway',
  ROUTE_TRANSFER_FEE: 'gateway',
};
const BREAKDOWN_KEY: Record<
  string,
  [keyof ISplitBreakdown, keyof ISplitBreakdown]
> = {
  CONVENIENCE_FEE: ['convenienceFee', 'gstOnConvenienceFee'],
  CLINIC_COMMISSION: ['commission', 'gstOnCommission'],
  GATEWAY_FEE: ['gatewayFee', 'gstOnGatewayFee'],
  ROUTE_TRANSFER_FEE: ['routeTransferFee', 'gstOnRouteTransferFee'],
};

/** How a fee reads on the patient's bill; the commission is folded into "Platform Fee". */
const PATIENT_LINE: Record<string, [IPatientFeeLine['type'], string]> = {
  CONVENIENCE_FEE: ['CONVENIENCE_FEE', 'Convenience Fee'],
  CLINIC_COMMISSION: ['PLATFORM_FEE', 'Platform Fee'],
  GATEWAY_FEE: ['GATEWAY_FEE', 'Payment Gateway Fee'],
  ROUTE_TRANSFER_FEE: ['GATEWAY_FEE', 'Payment Gateway Fee'],
};

export class DynamicSplitEngine {
  /** The patient total and its split, in integer paise (no float drift); takes and returns rupees. */
  public static calculate(
    servicePriceRupees: number,
    configs: IFeeConfig[],
    taxTreatmentP: TaxTreatment = 'TAX_EXEMPT',
    gstRateP: number = 18
  ): ISplitEngineResult {
    const P = Math.round(servicePriceRupees * 100);

    let baseClinicShare = P;
    let gstOnP = 0;
    if (taxTreatmentP === 'TAX_EXCLUSIVE') {
      gstOnP = Math.round(P * (gstRateP / 100));
    } else if (taxTreatmentP === 'TAX_INCLUSIVE') {
      gstOnP = Math.round(P - P / (1 + gstRateP / 100));
      baseClinicShare = P - gstOnP;
    }

    // One config per fee type (the first given), enabled only, in run order.
    const seen = new Set<string>();
    const active = configs
      .filter((c) => c.enabled && !seen.has(c.feeType) && seen.add(c.feeType))
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          (RUN_ORDER[a.feeType] ?? 9) - (RUN_ORDER[b.feeType] ?? 9)
      );

    const breakdown: ISplitBreakdown = {
      basePrice: P / 100,
      gstOnPrice: gstOnP / 100,
      convenienceFee: 0,
      gstOnConvenienceFee: 0,
      commission: 0,
      gstOnCommission: 0,
      gatewayFee: 0,
      gstOnGatewayFee: 0,
      routeTransferFee: 0,
      gstOnRouteTransferFee: 0,
    };
    let subtotal = P + gstOnP;
    let fees = 0;
    let feeGst = 0;
    let platform = 0;
    let gateway = 0;
    // Paise per patient line, in run order; summed here so lines always match the totals.
    const lines = new Map<
      string,
      { label: string; fee: number; gst: number }
    >();

    for (const c of active) {
      const base =
        c.calculationBase === 'PRE_GATEWAY_SUBTOTAL'
          ? subtotal
          : c.calculationBase === 'CLINIC_TRANSFER_AMOUNT'
            ? baseClinicShare
            : P;
      const fee =
        c.calculationMethod === 'PERCENTAGE'
          ? Math.round(base * (c.rateOrAmount / 100))
          : Math.round(c.rateOrAmount * 100);
      const gst =
        c.taxTreatment === 'TAX_EXCLUSIVE'
          ? Math.round(fee * (c.taxRate / 100))
          : 0;

      subtotal += fee + gst;
      fees += fee;
      feeGst += gst;
      if ((RECEIVER[c.feeType] ?? 'platform') === 'gateway') gateway += fee;
      else platform += fee;
      const [lineType, label] = PATIENT_LINE[c.feeType] ?? [
        'PLATFORM_FEE',
        'Platform Fee',
      ];
      const line = lines.get(lineType) ?? { label, fee: 0, gst: 0 };
      line.fee += fee;
      line.gst += gst;
      lines.set(lineType, line);
      const key = BREAKDOWN_KEY[c.feeType];
      if (key) {
        breakdown[key[0]] = fee / 100;
        breakdown[key[1]] = gst / 100;
      }
    }

    const TP = subtotal;
    const taxAmount = gstOnP + feeGst;
    // Every paisa the patient pays must land with exactly one party.
    if (TP !== P + platform + gateway + taxAmount) {
      throw new Error(
        `Calculation Reconciliation Failure: Patient Payable (Paise: ${TP}) does not match cumulative split sums (Paise: ${P + platform + gateway + taxAmount})`
      );
    }

    // Every fee is paid by the patient on top of the price (Q10).
    const patientPricingSummary: IPatientPricingSummary = {
      consultationFee: P / 100,
      consultationGst: gstOnP / 100,
      platformFee: fees / 100,
      platformFeeGst: feeGst / 100,
      gstRate:
        active.find((c) => c.feeType === 'CONVENIENCE_FEE')?.taxRate ?? 18,
      totalPayable: TP / 100,
      currency: 'INR',
      fees: [...lines]
        .filter(([, l]) => l.fee + l.gst > 0)
        .map(([type, l]) => ({
          type: type as IPatientFeeLine['type'],
          label: l.label,
          amount: l.fee / 100,
          gst: l.gst / 100,
        })),
    };

    return {
      patientTotal: TP / 100,
      clinicAmount: P / 100,
      platformAmount: platform / 100,
      gatewayAmount: gateway / 100,
      taxAmount: taxAmount / 100,
      breakdown,
      patientPricingSummary,
    };
  }
}
