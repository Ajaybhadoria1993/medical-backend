# Lab partial payment API

For frontend developers.

## API

`PATCH /api/v1/lab/lab-order/bulk`

Same endpoint used for status updates, discounts and refunds. Payment fields go inside each order's `updates`.

## Two separate things you can update

| What | Field | Belongs to |
|---|---|---|
| A test's own payment | `price`, `paymentStatus`, `paymentMode`, `paymentNotes` | the test (`labOrderId`) |
| The home sample's payment | `homeSamplePayment: { amount, paymentStatus, paymentMode, paymentNotes }` | the home sample linked to that test |

They're independent. You can send one, the other, or both in the same call.

### Test payment fields

| Field | Required | Rule |
|---|---|---|
| `price` | No | Whole number ≥ 0 — the amount you're recording for this test |
| `paymentStatus` | No | `pending` / `paid` / `failed` |
| `paymentMode` | No | Up to 20 characters (`CASH` / `UPI` / `CARD`) |
| `paymentNotes` | No | Up to 50 characters |

### `homeSamplePayment` fields

| Field | Required | Rule |
|---|---|---|
| `amount` | Yes | Whole number above 0 |
| `paymentStatus` | No | `pending` / `paid` / `failed`, default `paid` |
| `paymentMode` | No | Up to 20 characters |
| `paymentNotes` | No | Up to 50 characters |

**How the home sample is found:** by the `labOrderId` you send in that same order entry — it looks up whichever home sample that test belongs to. You don't need a separate home sample ID, and you don't need to list every test the home sample covers — any one of them is enough.

**One rule to know:** a home sample can be paid through only **one** test per call. If two orders in the same request both send `homeSamplePayment` for the same home sample, the whole request is rejected with a 400: *"A home sample can be paid through one test only."* Pick any one test linked to it.

## No auto-split — you decide the amounts

There's no "give me ₹300 and split it for me" option on this endpoint. You send the exact amount for each test and/or the home sample yourself. (Auto-split only happens when **creating** or **adding** tests via the walk-in endpoint — not here.)

## Partial payment — worked examples

Setup: Test1 = ₹100, Test2 = ₹200, Home sample = ₹500. Total bill = ₹800. The lab collects ₹300 now, to be split as ₹50 / ₹100 / ₹150.

### Case 1 — pay the tests only (₹150 of the ₹300)

```json
{
  "orders": [
    {
      "labOrderId": "<test1 id>",
      "updates": { "price": 50, "paymentStatus": "paid", "paymentMode": "CASH" }
    },
    {
      "labOrderId": "<test2 id>",
      "updates": { "price": 100, "paymentStatus": "paid", "paymentMode": "CASH" }
    }
  ]
}
```

- Test1 now shows `price: 50`, `paymentStatus: "paid"`.
- Test2 now shows `price: 100`, `paymentStatus: "paid"`.
- Home sample is untouched — still shows whatever it showed before this call.

### Case 2 — pay tests and home sample together (the full ₹300)

```json
{
  "orders": [
    {
      "labOrderId": "<test1 id>",
      "updates": {
        "price": 50,
        "paymentStatus": "paid",
        "paymentMode": "CASH",
        "homeSamplePayment": {
          "amount": 150,
          "paymentStatus": "paid",
          "paymentMode": "CASH",
          "paymentNotes": "Partial payment"
        }
      }
    },
    {
      "labOrderId": "<test2 id>",
      "updates": { "price": 100, "paymentStatus": "paid", "paymentMode": "CASH" }
    }
  ]
}
```

- Test1's entry carries **both** its own `price` and the `homeSamplePayment` — that's allowed, they update different things.
- `homeSamplePayment` only needs to appear once, on either test1 or test2 — not both.

### Case 3 — pay the home sample only (₹150 of the ₹300)

```json
{
  "orders": [
    {
      "labOrderId": "<test1 id>",
      "updates": {
        "homeSamplePayment": { "amount": 150, "paymentStatus": "paid", "paymentMode": "CASH" }
      }
    }
  ]
}
```

- No `price` sent for test1 — its own payment is left exactly as it was.
- Only the home sample changes.

### Paying the rest later

The remaining ₹500 (test1 ₹50, test2 ₹100, home sample ₹350) is just another call later, same shape, with the new amounts:

```json
{
  "orders": [
    {
      "labOrderId": "<test1 id>",
      "updates": {
        "price": 50,
        "paymentStatus": "paid",
        "homeSamplePayment": { "amount": 350, "paymentStatus": "paid" }
      }
    },
    { "labOrderId": "<test2 id>", "updates": { "price": 100, "paymentStatus": "paid" } }
  ]
}
```

`price` on a test is always the *new* amount for that payment record, not added to the previous one — if test1 already had ₹50 recorded and you're adding ₹50 more, send `price: 50` again as its own entry; the test's total (`₹100`) is the sum shown in `GET /lab-order`, not something you track yourself.

## Response

Each updated order in the response gets a `homeSamplePayment` object when one was sent:

```json
{
  "id": "<test1 id>",
  "price": 50,
  "paymentStatus": "paid",
  "paymentMode": "CASH",
  "homeSamplePayment": {
    "homeCollectionId": "2dbdfd1f-fdb8-4e97-b5c5-7d8aaa0b689e",
    "amount": 150,
    "paymentStatus": "paid"
  }
}
```

## Reading it back — `GET /lab/lab-order`

- Each test's `payments[]` lists every payment made on it, oldest first.
- Each home sample's `payments[]` lists every payment made on it, oldest first — same shape as a test's.
- `homeSamples[].paidAmount` is the latest payment's amount, not a running total — check `payments[]` for the full history if you need every transaction.

## Errors (400, nothing is saved)

| When | Message |
|---|---|
| Home sample paid through two tests in one call | `A home sample can be paid through one test only` |
| `labOrderId` has no linked home sample, but `homeSamplePayment` was sent | `This test has no home sample to pay` |
| `amount` ≤ 0 | Validation error |
