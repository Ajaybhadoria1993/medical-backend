# Clinic Admin Finance Dashboard API

Current backend contract for the clinic finance dashboard.

```text
Base URL: /api/v1/clinic-finance
```

## Common rules

- All endpoints require a bearer token and role `Admin` or `Super_Admin`.
- The clinic is resolved from the authenticated user's assignment. No endpoint
  accepts a clinic ID from the caller.
- Money is returned as numeric rupee values, not paise.
- JSON timestamps are ISO strings.
- Date ranges use required `startDate` and `endDate` values in `YYYY-MM-DD`
  format; `startDate` cannot be after `endDate`.
- Pagination defaults to `page=1&pageSize=20`; maximum `pageSize` is `100`.

Except for statement downloads, successful responses use:

```json
{
  "success": true,
  "message": "Operation-specific message",
  "data": {}
}
```

## Financial calculation rules

Clinic revenue is derived in this order:

1. `financialSnapshot.basePrice`;
2. `financialSnapshot.breakdown.basePrice`;
3. amount transferred to the clinic;
4. primary service price;
5. patient total minus platform, gateway, GST, and convenience fees as a
   legacy fallback.

The patient-paid platform fee is not deducted from clinic revenue. Refunds issued are deducted from gross revenue to determine net payable:

```text
netPayable = max(grossRevenue - refundsIssued, 0)
pendingPayout = max(netPayable - alreadyReceived, 0)
```

`alreadyReceived` comes only from completed settlement items. Payment collection
status is not treated as bank-settlement status.

## Endpoint index

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/summary` | Period KPIs and payout banner |
| GET | `/revenue-breakdown` | Daily, doctor, or service revenue |
| GET | `/fees/summary` | Fee configuration and history |
| GET | `/fees/transactions` | Paginated fee transactions |
| GET | `/transactions` | Appointment and plan payments/refunds |
| GET | `/cancellations` | Cancellation metrics, refunds, reviews |
| GET | `/cancellation-settings` | Read editable settings |
| PUT | `/cancellation-settings` | Replace editable settings |
| GET | `/settlements` | Paginated settlements |
| GET | `/settlements/:settlementId/statement` | PDF/CSV statement |
| GET | `/refund-reviews` | All refund-review cases |
| POST | `/refund-reviews/:appointmentId/decision` | Approve/decline refund |
| GET | `/disputes` | Paginated disputes |
| POST | `/disputes/:disputeId/evidence` | Upload dispute evidence |

## 1. Summary

```http
GET /api/v1/clinic-finance/summary?startDate=2026-09-01&endDate=2026-09-18
```

Example `data`:

```json
{
  "period": {
    "start": "2026-09-01",
    "end": "2026-09-18",
    "label": "Selected period"
  },
  "payoutAccount": {
    "status": "verified",
    "statusReason": null,
    "manageAccountUrl": "/settings/payout-account"
  },
  "grossRevenue": 50000,
  "grossCollected": 50000,
  "completedAppointmentCount": 24,
  "platformFeeChargedToPatients": 1000,
  "platformFeeRatePercent": 2,
  "platformFeePayer": "patient",
  "netPayable": 50000,
  "alreadyReceived": 42000,
  "settledToBank": 42000,
  "settledCount": 2,
  "pendingPayout": 8000,
  "nextSettlementDate": "2026-09-20T00:00:00.000Z",
  "nextSettlementId": "27e12930-b91d-4763-a4ad-d20f20842c70",
  "nextSettlementRef": "setl_S390",
  "onHold": 1465,
  "onHoldReason": "Contact support to release",
  "refundsIssued": 2500,
  "refundCount": 2,
  "channelBreakdown": {
    "online": {
      "grossRevenue": 30000,
      "refundsIssued": 1500,
      "netPayable": 28500,
      "completedAppointmentCount": 14
    },
    "offline": {
      "grossRevenue": 20000,
      "refundsIssued": 1000,
      "netPayable": 19000,
      "completedAppointmentCount": 10
    }
  },
  "features": {
    "settlements": true,
    "refundReviews": true,
    "disputes": true
  }
}
```

Payout KPIs share this summary across Overview and Payout & Settlement:
`settledToBank` and `settledCount` include provider-confirmed settlements in the
selected settlement-date period; `pendingPayout` includes online net collections
that have not been confirmed as settled; `onHold` is the current held balance.
Elapsed expected settlement dates do not confirm a settlement.

`nextSettlementId` is the local settlement UUID used by the statement route.
`nextSettlementRef` is the provider settlement reference and is `null` when no
provider settlement exists; it is never synthesized.

Payout status is `verified`, `needs_clarification`, or `pending`. The `features`
object currently reports API availability and is not environment-driven.

## 2. Revenue breakdown

```http
GET /api/v1/clinic-finance/revenue-breakdown?startDate=2026-09-01&endDate=2026-09-18&view=daily
```

`view` defaults to `daily`; allowed values are `daily`, `doctor`, and `service`.

Daily response `data`:

```json
{
  "view": "daily",
  "series": ["booked", "completed", "cancelled"],
  "daily": [
    {
      "date": "2026-09-01",
      "label": "Tue",
      "booked": 6000,
      "completed": 5000,
      "cancelled": 1000
    }
  ]
}
```

Doctor and service views use the same amount fields under `byDoctor` or
`byService`:

```json
{
  "view": "doctor",
  "series": ["booked", "completed", "cancelled"],
  "byDoctor": [
    {
      "name": "Dr. Kapoor",
      "booked": 12000,
      "completed": 10000,
      "cancelled": 2000
    }
  ]
}
```

Failed payments are excluded from booked totals.

## 3. Fee transparency

### Fee summary

```http
GET /api/v1/clinic-finance/fees/summary?startDate=2026-09-01&endDate=2026-09-18
```

Example `data`:

```json
{
  "currentRatePercent": 2,
  "effectiveSince": "2026-01-01T00:00:00.000Z",
  "whoPays": "patient",
  "feesCollectedInPeriod": 1000,
  "rateHistory": [
    {
      "ratePercent": 2,
      "from": "2026-01-01T00:00:00.000Z",
      "to": null,
      "scope": "global"
    }
  ]
}
```

`scope` is `clinic` or `global`. An active clinic-specific configuration takes
precedence over global configuration.

### Fee transactions

```http
GET /api/v1/clinic-finance/fees/transactions?startDate=2026-09-01&endDate=2026-09-18&page=1&pageSize=20
```

Example `data`:

```json
{
  "data": [
    {
      "appointmentId": "5a913973-3dbf-43e6-8ae2-7858c35e8de4",
      "doctor": "Dr. Kapoor",
      "clinicServicePrice": 2000,
      "platformFee": 40,
      "totalChargedToPatient": 2040,
      "netToClinic": 2000,
      "transactionTime": "2026-09-04T10:30:00.000Z"
    }
  ],
  "metadata": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Payment and refund transactions

```http
GET /api/v1/clinic-finance/transactions
```

Each transaction row uses `id` for the local transaction row, and separate
nullable fields for `paymentRecordId`, `providerPaymentId`, `providerOrderId`,
`providerRefundId`, and `localReference`. Online payment/refund rows carry their
actual provider reference in the matching provider field. Offline/manual rows
carry a local reference or receipt and leave provider IDs null. `transactionId`
is retained as a compatibility display alias; new clients should use the
entity-specific fields. Refund rows identify the refund with
`providerRefundId` and retain the original payment separately in
`providerPaymentId`.

## 4. Cancellations and refunds

```http
GET /api/v1/clinic-finance/cancellations?startDate=2026-09-01&endDate=2026-09-18
```

Example `data`:

```json
{
  "counts": {
    "cancellations": 4,
    "noShows": 2,
    "reschedules": 3
  },
  "revenueImpact": -6500,
  "refunds": [
    {
      "id": "8ed31c51-5915-41f0-8f9f-25be5199a985",
      "appointmentId": "49058573-3dbf-43e6-8ae2-7858c35e8de4",
      "refundId": null,
      "providerRefundId": null,
      "providerPaymentId": "pay_example",
      "providerOrderId": "order_example",
      "originalPaymentRecordId": "6a2c0843-0595-43b3-b5fa-76be89b4e55a",
      "originalTxnId": "pay_example",
      "patientName": "Rahul Sharma",
      "doctorName": "Dr. Priya Patel",
      "appointmentDate": "2026-09-04 10:30:00",
      "reasonCode": "Medical Emergency",
      "note": "Hospitalised same-day",
      "amount": -2150,
      "status": "Pending",
      "failureReason": null,
      "createdAt": "2026-09-04T11:00:00.000Z"
    }
  ],
  "pendingReviews": [],
  "pendingReviewsAvailable": true
}
```

Only pending reviews whose appointment falls in the selected period appear in
`pendingReviews`. The dedicated review endpoint returns all review states.

## 5. Cancellation settings

```http
GET /api/v1/clinic-finance/cancellation-settings
PUT /api/v1/clinic-finance/cancellation-settings
```

The PUT request requires the complete object:

```json
{
  "userCancellationRights": {
    "patientsCanCancelOnline": true,
    "doctorsCanCancel": true,
    "receptionistsCanCancel": true,
    "adminCanCancel": true
  },
  "cancellationWindows": {
    "onlineConsultationHours": 24,
    "offlineInClinicHours": 12
  },
  "patientCancellationLimits": {
    "cooldownMinutes": 30,
    "maxPerDay": 3,
    "maxPerWeek": 10,
    "maxPerMonth": 30
  },
  "cancellationReasonAndComments": {
    "reasonRequired": true,
    "commentsAllowed": true,
    "minCommentLength": 0,
    "maxCommentLength": 500
  },
  "reschedulingRules": {
    "maxReschedulesPerAppointment": 3,
    "rescheduleAllowedUntilHours": 24,
    "paymentCarriedForward": true
  }
}
```

GET and successful PUT `data` use this shape. Numeric fields must be
non-negative integers and `minCommentLength` cannot exceed `maxCommentLength`.
Internal policy values not exposed here are preserved.

## 6. Settlements and statements

### List settlements

```http
GET /api/v1/clinic-finance/settlements?page=1&pageSize=20&startDate=2026-10-01&endDate=2026-10-31&status=COMPLETED
```

Optional `startDate` and `endDate` must be provided together. They filter by
the inclusive payment-cycle end date (`cycleEnd`), interpreted as full days in
IST. The same filtered set is used for `data`, `metadata`, and `summary`.
Optional `status`: `COMPLETED`, `PROCESSING`, or `FAILED`.

Example `data`:

```json
{
  "data": [
    {
      "id": "27e12930-b91d-4763-a4ad-d20f20842c70",
      "provider": "razorpay",
      "cycleId": null,
      "subMerchantId": "acc_MX7241",
      "settlementDate": "2026-09-05T08:00:00.000Z",
      "expectedSettlementDate": null,
      "cycleStart": "2026-08-16T00:00:00.000Z",
      "cycleEnd": "2026-08-29T23:59:59.000Z",
      "amount": 38900,
      "providerSettlementId": "setl_S390",
      "status": "completed",
      "failureReason": null,
      "statementAvailable": true
    }
  ],
  "metadata": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Download statement

```http
GET /api/v1/clinic-finance/settlements/{settlementId}/statement?format=pdf
GET /api/v1/clinic-finance/settlements/{settlementId}/statement?format=csv
```

- `settlementId` must be the local settlement `id` UUID from the settlements
  list. `providerSettlementId` is a separate Razorpay/provider reference and
  must not be passed to this endpoint.
- `format` defaults to `pdf`; allowed values are `pdf` and `csv`.
- Only completed, clinic-owned settlements can be downloaded.
- The endpoint returns a raw attachment, not the JSON envelope.
- A non-completed settlement returns HTTP `409`.

Statements contain settlement metadata and item-level appointment, transfer,
clinic amount, reversal, and net amount data.

Settlement items expose `id` as the local settlement-item ID,
`paymentRecordId` as the local appointment-payment ID, and
`providerPaymentId` / `providerTransferId` as provider references.
`paymentId` and `transactionId` remain deprecated aliases for
`providerPaymentId` during client migration.
`settlementId` remains a compatibility alias for `providerSettlementId`;
clients should use `id` for statement routes and the explicitly named provider
field for display or provider reconciliation.

### Provider ingestion status

`SettlementService.upsertFromProvider` is an internal idempotent entry point
keyed by provider and provider settlement ID. Verified Razorpay
`settlement.processed` events received by the appointment webhook now fetch the
settlement's Route transfers and map matching appointment payments into this
service. Transfers that cannot be matched to the linked clinic are ignored.

The same verified endpoint handles Route `transfer.processed` and
`transfer.failed` events (and tolerates `transfer.created` or
`transfer.reversed` payloads if delivered). The
latest provider transfer state is stored on the matching appointment payment
and exposed in the settlement cycle's `paymentsList` as `providerTransferId`,
`transferStatus`, `transferOnHold`, and `transferFailureReason`. Held, failed,
or reversed transfer balances contribute to the blocked/on-hold KPI and are
removed from the expected payout amount. Mixed daily cycles retain their
processing/scheduled row status while the summary reports only the blocked
portion. Passing the estimated settlement date alone still does not mark a
transfer failed or held.

Configure the Razorpay webhook in both Test and Live mode for
`transfer.processed`, `transfer.failed`, and `settlement.processed`. The
settlement webhook confirms a completed
settlement; the transfer events report linked-account transfer state. Razorpay
does not document a separate settlement-failed event for this Route flow, so
the backend does not infer a failure from an elapsed estimate.

## 7. Refund reviews

Review intake is controlled by:

```env
ENABLE_REFUND_REVIEWS=false
```

When `true`, a patient cancellation with reason `medical_emergency` can bypass
patient window, limit, and cooldown checks and creates a pending refund review
when a payment exists. The appointment cancellation remains approved; the clinic
decision applies only to the refund. Default `false` preserves existing flow.

### List reviews

```http
GET /api/v1/clinic-finance/refund-reviews
```

Example `data` item:

```json
{
  "id": "5e9c2a4d-f6c0-4ecb-a028-e6935ea33f3d",
  "appointmentId": "49058573-3dbf-43e6-8ae2-7858c35e8de4",
  "reasonCategory": "medical_emergency",
  "policyReference": "Medical emergency exception review",
  "amount": 2150,
  "status": "PENDING",
  "patientNote": "Hospitalised same-day",
  "decision": null,
  "decisionNote": null,
  "failureReason": null,
  "appointmentTime": "2026-09-04T17:30:00.000Z",
  "cancelledTime": "2026-09-04T16:10:00.000Z",
  "patient": "R. Deshmukh",
  "doctor": "Dr. Kapoor",
  "reviewedAt": null,
  "createdAt": "2026-09-04T16:10:00.000Z",
  "supportingDocs": [
    {
      "id": "81fcb48a-6a44-4bd7-a22e-8d48646dff50",
      "filename": "discharge-summary.pdf",
      "url": "https://storage.example/document.pdf",
      "mimeType": "application/pdf"
    }
  ],
  "actionsAvailable": true
}
```

States are `PENDING`, `PROCESSING`, `FAILED`, and `RESOLVED`.
`actionsAvailable` is true only for `PENDING`. Failed approvals may be retried.
The supporting-document table exists, but this module does not expose a refund
document upload endpoint; another workflow must persist those records.

### Approve or decline

```http
POST /api/v1/clinic-finance/refund-reviews/{appointmentId}/decision
Content-Type: application/json
```

`appointmentId` must be a UUID. Body:

```json
{
  "decision": "approved",
  "note": "Optional reviewer note, maximum 1000 characters"
}
```

`decision` is `approved` or `declined`.

Online approval example `data`:

```json
{
  "appointmentId": "49058573-3dbf-43e6-8ae2-7858c35e8de4",
  "status": "RESOLVED",
  "decision": "APPROVED",
  "refundStatus": "Completed",
  "providerRefundId": "rfnd_provider_id",
  "gatewayRefundId": "rfnd_provider_id"
}
```

Online approval uses the configured payment adapter, reverses transfers, updates
the payment/refund, and writes idempotent `REFUND` and `TRANSFER_REVERSAL` ledger
entries. A provider-pending result returns `Processing`. For cash/manual
payments, the review resolves but the operational refund remains `Pending`.

Declining resolves the review and marks its refund `Declined`; it does not undo
the appointment cancellation. A resolved retry returns `alreadyResolved: true`.
Concurrent processing returns HTTP `409`; gateway failure marks the review and
refund failed and returns HTTP `502`.

## 8. Disputes

### List disputes

```http
GET /api/v1/clinic-finance/disputes?page=1&pageSize=20&status=UNDER_REVIEW
```

Optional `status`: `UNDER_REVIEW`, `RESOLVED_CLINIC`, or `RESOLVED_PATIENT`.

Example `data`:

```json
{
  "data": [
    {
      "id": "590d5adc-940d-49f1-b2dc-46862caa75c5",
      "provider": "razorpay",
      "providerDisputeId": "disp_provider_id",
      "appointmentId": "48218573-3dbf-43e6-8ae2-7858c35e8de4",
      "amount": 1800,
      "filedDate": "2026-09-02T08:00:00.000Z",
      "reason": "Service not rendered",
      "status": "under_review",
      "resolutionParty": null,
      "resolvedAt": null,
      "evidence": [],
      "evidenceUploadAllowed": true
    }
  ],
  "metadata": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Upload evidence

```http
POST /api/v1/clinic-finance/disputes/{disputeId}/evidence
Content-Type: multipart/form-data
```

Use multipart field `file`. Rules:

- `disputeId` must be a UUID and belong to the authenticated clinic.
- Status must be `UNDER_REVIEW`.
- Maximum size is 10 MB.
- Allowed types: PDF, JPEG, PNG, WebP.
- The file is uploaded to S3 and metadata is persisted.

Example `data`:

```json
{
  "id": "c41f31db-149b-4690-a4c5-b93e864a3334",
  "disputeId": "590d5adc-940d-49f1-b2dc-46862caa75c5",
  "filename": "consultation-notes.pdf",
  "mimeType": "application/pdf",
  "url": "https://storage.example/evidence.pdf"
}
```

This stores evidence in the application but does not submit it to the payment
provider's dispute API.

### Provider ingestion status

`DisputeService.upsertFromProvider` is an internal idempotent entry point keyed
by provider and provider dispute ID. Verified Razorpay dispute events received
by the appointment webhook now map created/action-required/under-review, won,
lost, and closed states into the clinic dispute lifecycle.

## 9. Persistence and deployment

The implementation introduces:

- `clinic_settlements`
- `clinic_settlement_items`
- `cancellation_refund_reviews`
- `refund_review_documents`
- `payment_disputes`
- `payment_dispute_evidence`

A staging migration creating these tables, foreign keys, unique constraints,
and indexes is included at
`src/drizzle/migrations/staging/0029_clinic_finance_dashboard.sql`. It must be
reviewed and applied before deployment. Equivalent migrations are still needed
for any separately maintained development or production migration histories.

No clinic-finance seed is required or registered. Data should come from real
cancellation activity and provider webhook/reconciliation processing.

## 10. Availability and remaining work

| Capability | Status |
| --- | --- |
| Revenue KPIs and breakdowns | Implemented |
| Fee summary/history/transactions | Implemented |
| Cancellation metrics/refunds | Implemented |
| Cancellation settings | Implemented |
| Razorpay settlement persistence/statements | Implemented, including verified webhook ingestion |
| Manual refund-review decisions | Implemented; intake is feature-flagged |
| Refund supporting-document upload | Not exposed by this module |
| Razorpay dispute persistence/evidence storage | Implemented, including verified webhook ingestion |
| Provider evidence submission | Not implemented |
| KYC tracking/payout-account submission | Excluded |

## 11. Frontend guidance

- Summary, revenue, fees, cancellations, and settings use existing live data.
- Settlement/dispute lists populate from matching verified Razorpay events.
- Download statements only when `statementAvailable` is true.
- Show refund actions only when `actionsAvailable` is true.
- Show evidence upload only when `evidenceUploadAllowed` is true.
- Treat statements as binary file downloads rather than JSON.
- Do not send or expose a clinic ID for these endpoints.
- `id` identifies an application record. Provider IDs are returned in
  entity-specific fields such as `providerSettlementId` and
  `providerDisputeId`. They are not interchangeable.
- Expected settlement cycles have `id: null`, a deterministic `cycleId`, and
  no provider settlement ID until a provider settlement exists.
- Refund `refundId` is retained as a compatibility alias for
  `providerRefundId`; both are null when the refund has no provider ID. Never
  synthesize a provider-looking ID from an application or appointment ID.
