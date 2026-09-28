# WhatsApp (Meta Cloud API) — Complete Setup Guide

Single reference for provisioning and verifying WhatsApp messaging end to end. Covers the Meta-side account setup, the nine message templates, the backend `.env`, and how to test each layer independently.

Code entry points: [`smsClient.ts`](../src/utils/smsClient.ts) (`sendWhatsAppTemplate`), [`whatsapp.service.ts`](../src/main/notifications/services/whatsapp.service.ts) (Graph API call), [`whatsappTemplate.utils.ts`](../src/main/notifications/utils/whatsappTemplate.utils.ts) (template registry), [`whatsappWebhook.controller.ts`](../src/main/notifications/controllers/whatsappWebhook.controller.ts) (delivery statuses).

---

## Checklist

Work top to bottom — each step depends on the ones above it.

| # | Step | Done when |
|---|---|---|
| 1 | [Business account + app + WABA](#1-business-account-app-and-waba) | WhatsApp product appears in the app dashboard |
| 2 | [Add and **verify** the business number](#2-add-and-verify-the-business-number) | `code_verification_status: VERIFIED` |
| 3 | [**Register** the number on Cloud API](#3-register-the-number-on-cloud-api) | `platform_type: CLOUD_API`, `status: CONNECTED` |
| 3b | [Get the display name approved](#display-name--why-recipients-see-a-number) | `name_status: APPROVED` |
| 4 | [Permanent access token](#4-permanent-access-token) | Script lists templates without a 190 error |
| 5 | [Create the nine templates](#5-create-the-nine-templates) | All show `APPROVED` in the script |
| 6 | [Webhook](#6-delivery-status-webhook) | Meta's "Verify and Save" succeeds |
| 7 | [Fill `.env`](#7-env-reference) | Script shows all ✅ under Configuration |
| 8 | [Verify end to end](#8-verify-end-to-end) | A real appointment sends a real message |

**Steps 2 and 3 are different things.** Verifying proves you own the number; registering activates it for the Cloud API. Skipping step 3 is the single most common cause of a fully-configured setup that still refuses to send (error `133010`).

---

## How the flow works

Every business-initiated WhatsApp message goes through a **pre-approved Meta template**. `sendWhatsAppTemplate(to, key, params)` resolves the template name, flattens the parameters, and posts to the Graph API. There is deliberately **no Direct Send fallback**.

**Why no fallback:** a live test on 2026-07-23 sent three messages to a real handset — the `hello_world` **template** was delivered, while two **Direct Send** calls returned `200` plus a message id and **never arrived**. Direct Send participation is *"subject to acceptance of the beta terms"*; an unenrolled WABA gets no error, Meta silently drops the message while reporting success. Falling back to that turns every template failure into a false "sent successfully" log, so the code fails loudly instead. `WhatsAppService.sendDirectMessage` has been removed entirely — don't reintroduce it.

**Parameters are per-field** (`{{1}}` clinic, `{{2}}` date, …), never one placeholder holding a whole pre-formatted message. Meta rejects template parameters containing newlines, tabs, or 4+ consecutive spaces (error `132000`), which a multi-line body always trips. `sanitizeTemplateParam` flattens every value as a backstop; line breaks live in the approved template body instead.

**Patient and doctor names are resolved at send time**, not passed down from the caller — `getAppointmentParticipants` in [`appointmentParticipants.model.ts`](../src/main/notifications/models/appointmentParticipants.model.ts) looks them up from the appointment. Reminders fire hours or days after being scheduled, by which point the appointment may have been reassigned to a different doctor. An unassigned doctor falls back to "your doctor" rather than blocking the send.

**Templates belong to a WABA, not to your Meta account.** A number on WABA A cannot send a template approved on WABA B. If you have more than one WABA, confirm `WHATSAPP_BUSINESS_ACCOUNT_ID` and `WHATSAPP_PHONE_NUMBER_ID` belong to the *same* one.

---

## 1. Business account, app, and WABA

1. [business.facebook.com](https://business.facebook.com) → sign in with a company-owned account, not a personal one → **Create Account**
2. [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App** → type **Business**
3. App dashboard → find **WhatsApp** in the product list → **Set up**

This auto-creates a WABA and a free **test phone number**. The test number is registered and works immediately, but only sends to 5 manually-verified recipients and lives on its own WABA — see [Test number vs real number](#test-number-vs-real-number).

## 2. Add and verify the business number

1. WhatsApp → **API Setup** → **Add phone number**
2. The number must **not** be active on the regular WhatsApp or WhatsApp Business consumer app — deregister it there first
3. Verify via SMS or voice code
4. Note the **Phone Number ID** (numeric, *not* the phone number) → `WHATSAPP_PHONE_NUMBER_ID`
5. Note the **WhatsApp Business Account ID** on the same page → `WHATSAPP_BUSINESS_ACCOUNT_ID`

## 3. Register the number on Cloud API

Verification alone does not let you send. The number must also be registered, which sets a 6-digit PIN.

**UI:** WhatsApp → **API Setup** → your number → **Register** → choose a 6-digit PIN.

**API:**
```bash
curl -X POST "https://graph.facebook.com/v25.0/<PHONE_NUMBER_ID>/register" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","pin":"<YOUR_6_DIGITS>"}'
```
Expected: `{"success":true}`.

**Save the PIN.** It is permanently attached to the number, needed for re-registration or migration, and cannot be recovered.

Confirm the state flipped:

| Field | Before | After |
|---|---|---|
| `code_verification_status` | `VERIFIED` | `VERIFIED` |
| `platform_type` | `NOT_APPLICABLE` | `CLOUD_API` |
| `status` | `PENDING` | `CONNECTED` |

While `platform_type` is `NOT_APPLICABLE`, every send fails with `(#133010) Account not registered` regardless of templates, token, or `.env`.

### Display name — why recipients see a number

Registration makes the number *work*; it does not make it show your business name. Until the display name is approved, anyone who hasn't saved the number sees the raw digits. This is a property of the number in Meta — no code or template setting affects it.

Check it with `npx tsx src/scripts/testWhatsApp.ts`:

```
Phone number  +91 XXXXX XXXXX
  ✅ registration: CLOUD_API / CONNECTED
  ❌ display name: "Infinity medisetu" — DECLINED — recipients see the number, not this name
```

If `DECLINED`, work through these in order:

1. **Check business verification** — [business.facebook.com/settings/info](https://business.facebook.com/settings/info). An unverified business gets display names declined on its own.
2. **Verify the business** if needed — [Security Centre](https://business.facebook.com/settings/security) → **Start Verification**. Needs legal name/address/phone matching a supporting document (incorporation certificate, tax registration, utility bill, bank statement) plus a verification method. Usually 1–3 business days.
3. **Resubmit the name** — [WhatsApp Manager → Phone Numbers](https://business.facebook.com/wa/manage/phone-numbers/) → your number → settings → **Display name** → submit for review.
4. **Watch for the result** by re-running the script: `PENDING_REVIEW` → `APPROVED`.

| Requirement | What trips people up |
|---|---|
| Matches your real branding | Must match website/app/materials, not an internal shorthand |
| Consistent capitalisation | `Infinity medisetu` reads as a typo; `Infinity Medisetu` reads as a brand — a frequent sole cause of rejection |
| Relates to the verified entity | Should match the business verified above |
| No URLs, generic words or claims | "Best Clinic", "clinic.com" are refused |

**Test from a handset that has not saved the number.** WhatsApp shows a saved contact label over the business name, so testing on your own saved number looks unchanged and will mislead you.

The verified badge is separate: `is_official_business_account` reflects Meta's Official Business Account status, granted to notable brands. An approved display name is enough to show your name — the badge isn't required.

## 4. Permanent access token

The token shown on the API Setup page is a **24-hour user token**. It expires and breaks production sending with error `190` (subcode 467, "the user logged out"). Generate a system-user token instead:

1. [business.facebook.com/settings](https://business.facebook.com/settings) → **Users** → **System Users**
2. **Add** → role **Admin** → name it e.g. `medisetu-backend`
3. **Add Assets** → select your WhatsApp app/WABA → **Full control** *(skipping this generates a token that fails on every call)*
4. **Generate New Token** → select your app → tick **both**:
   - `whatsapp_business_messaging` — sending
   - `whatsapp_business_management` — listing template status
5. Expiration: **Never**
6. Copy immediately — shown once → `WHATSAPP_ACCESS_TOKEN`

## 5. Create the nine templates

WhatsApp Manager → **Message Templates** → **Create Template**. For each: category **Utility**, language matching `WHATSAPP_LANGUAGE_CODE` (default `en`), name exactly as written below.

Copy each body **verbatim** — placeholder order and count must match `WHATSAPP_TEMPLATES` in [`whatsappTemplate.utils.ts`](../src/main/notifications/utils/whatsappTemplate.utils.ts), which fills them at runtime.

> **Names are typo-sensitive and cannot be renamed after creation.** Meta has no rename — a misspelled template must be deleted and recreated, then re-approved. Copy-paste the names rather than typing them.

### Every template also needs a footer

In the template editor, click **Add footer** and enter exactly:

```
Infinity Medisetu
```

Footers are a separate component from the body and **cannot contain variables**, which is precisely why static branding belongs there rather than in the body text. Because it has no variables, the footer needs **no code change** — `sendTemplateMessage` keeps sending body params only, and Meta renders the footer automatically in smaller grey text beneath the message.

### `appointment_booked`

Sent **once**, when the appointment is created — from the web app, patient portal, or anywhere else. Later status changes (including `Confirmed`) send no further SMS or WhatsApp; they raise in-app notifications only. Editing unrelated fields sends nothing.

```
Hi {{1}}, your appointment is booked.

Doctor: {{2}}
Clinic: {{3}}
Date: {{4}}
{{5}}

Please arrive 10 minutes early and carry any previous reports.
```
`{{1}}` patient · `{{2}}` doctor · `{{3}}` clinic · `{{4}}` date · `{{5}}` time-or-token line
Sample: `Asha Nair` · `Dr. Rajesh Kumar` · `Apollo Clinic` · `Thu, 23 Jul 2026` · `Time: 10:00 AM`

### `appointment_reminder`

```
Hi {{1}}, this is a reminder for your upcoming appointment.

Doctor: {{2}}
Clinic: {{3}}
Date: {{4}}
{{5}}

Please arrive 10 minutes early. Contact the clinic if you need to reschedule.
```
`{{1}}` patient · `{{2}}` doctor · `{{3}}` clinic · `{{4}}` date · `{{5}}` time-or-token line
Sample: `Asha Nair` · `Dr. Rajesh Kumar` · `Apollo Clinic` · `Thu, 23 Jul 2026` · `Token No: 12`

### `appointment_rescheduled`

```
Hi {{1}}, your appointment has been rescheduled.

Doctor: {{2}}
Clinic: {{3}}
New date: {{4}}
{{5}}

Please arrive 10 minutes early. Contact the clinic if this time does not suit you.
```
`{{1}}` patient · `{{2}}` doctor · `{{3}}` clinic · `{{4}}` new date · `{{5}}` time-or-token line
Sample: `Asha Nair` · `Dr. Rajesh Kumar` · `Apollo Clinic` · `Sat, 25 Jul 2026` · `Time: 4:30 PM`

### `appointment_no_show`

```
Hi {{1}}, your appointment with {{2}} at {{3}} has been marked as missed.

Action taken: {{4}}
Reason: {{5}}

Please contact the clinic to rebook at a convenient time.
```
`{{1}}` patient · `{{2}}` doctor · `{{3}}` clinic · `{{4}}` action taken · `{{5}}` reason
Sample: `Asha Nair` · `Dr. Rajesh Kumar` · `Apollo Clinic` · `Cancelled` · `Patient did not arrive`

### `appointment_completed`

```
Hi {{1}}, your consultation with {{2}} at {{3}} is now complete.

Your prescription and reports are available in the app. Please follow the advice shared during your visit.

Thank you for choosing us.
```
`{{1}}` patient · `{{2}}` doctor · `{{3}}` clinic
Sample: `Asha Nair` · `Dr. Rajesh Kumar` · `Apollo Clinic`

### `appointment_followup`

```
Hi {{1}}, this is a reminder about your follow-up visit.

Doctor: {{2}}
Clinic: {{3}}
Date: {{4}}

Please contact the clinic if you need to reschedule.
```
`{{1}}` patient · `{{2}}` doctor · `{{3}}` clinic · `{{4}}` follow-up date
Sample: `Asha Nair` · `Dr. Rajesh Kumar` · `Apollo Clinic` · `Fri, 24 Jul 2026`

### `lab_report_ready`

Sent when a lab report PDF is attached to a completed test.

```
Hi {{1}}, your {{2}} report is ready.

Lab: {{3}}

You can download it here:
{{4}}

Please discuss the results with your doctor before acting on them.
```
`{{1}}` patient · `{{2}}` test name · `{{3}}` lab · `{{4}}` report PDF URL
Sample: `Asha Nair` · `Complete Blood Count` · `Apollo Diagnostics` · `https://<bucket>.s3.ap-south-1.amazonaws.com/lab-reports/<id>.pdf`

### `lab_payment_received`

Sent when a lab invoice is raised against a test.

```
Hi {{1}}, we have received your payment of {{2}}.

Test: {{3}}
Lab: {{4}}
Invoice: {{5}}

Thank you. Your report will be shared here once it is ready.
```
`{{1}}` patient · `{{2}}` amount · `{{3}}` test name · `{{4}}` lab · `{{5}}` invoice number
Sample: `Asha Nair` · `₹850.00` · `Complete Blood Count` · `Apollo Diagnostics` · `LAB-2026-000142`

### `pharmacy_invoice`

```
Hi {{1}}, your invoice from {{2}} is ready.

You can download it here:
{{3}}

For any queries about this bill, please contact the pharmacy.
```
`{{1}}` customer · `{{2}}` pharmacy · `{{3}}` invoice PDF URL
Sample: `Asha Nair` · `Apollo Pharmacy` · `https://<bucket>.s3.ap-south-1.amazonaws.com/pharmacy-sales-invoices/<id>.pdf`

> This one has no doctor — it comes from the pharmacy module, which has no appointment context.

> If Meta rejects the URL-in-body variable, recreate this one with a **dynamic URL button**: fixed prefix `https://<bucket>.s3.ap-south-1.amazonaws.com/` plus a `{{1}}` suffix, passing the S3 key rather than the full URL. Requires a matching `components` change in `WhatsAppService.sendTemplateMessage` (button component, `sub_type: 'url'`, `index: '0'`).

### After submitting

- Approval is usually **minutes**, occasionally up to **24h** if a human reviews it. Poll with the script (step 8) rather than the dashboard.
- Rejections show a reason in the dashboard. The most common is category set to Marketing instead of Utility.
- Meta sometimes **re-categorizes** on submission — the script flags any approved template that isn't Utility.
- **Body edits require re-approval.** Changing placeholder count or order means updating `WHATSAPP_TEMPLATES` in the same commit, or sends fail with `132000`.

## 6. Delivery-status webhook

Optional for sending, required to learn that a message **failed**. The code [only logs `failed`](../src/main/notifications/services/whatsappWebhook.service.ts) — `sent`/`delivered`/`read` are discarded, so silence after a good send is expected.

**First, get the App Secret:** App dashboard → **App settings → Basic** → **Show** next to App Secret → `WHATSAPP_APP_SECRET`. This is not the App ID and not the access token. Without it, the webhook rejects every payload with `401`.

**Pick a verify token yourself** — it is not issued by Meta. Any unguessable string: `openssl rand -hex 16` → `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Leaving it empty makes the check pass for anyone sending a blank token.

**Test locally before involving Meta** (server running on 5000):

```bash
# 1. Valid handshake → 200, body: test12345
curl -i "http://localhost:5000/api/v1/notifications/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=<YOUR_TOKEN>&hub.challenge=test12345"

# 2. Wrong token → 403
curl -i "http://localhost:5000/api/v1/notifications/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test12345"

# 3. Unsigned POST → 401
curl -i -X POST http://localhost:5000/api/v1/notifications/whatsapp-webhook \
  -H "Content-Type: application/json" -d '{"entry":[]}'
```

Use **Git Bash**, not `cmd.exe` — unquoted `&` splits the URL and only `hub.mode` arrives, producing a misleading `403`. In PowerShell use `curl.exe`, not `curl`.

A correctly signed POST (proves the HMAC path and failure logging):

```bash
BODY='{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"statuses":[{"id":"wamid.TEST","status":"failed","recipient_id":"919999999999","errors":[{"title":"Message undeliverable"}]}]},"field":"messages"}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "<APP_SECRET>" -r | cut -d' ' -f1)
printf '%s' "$BODY" | curl -s -X POST http://localhost:5000/api/v1/notifications/whatsapp-webhook \
  -H "Content-Type: application/json" -H "X-Hub-Signature-256: sha256=$SIG" --data-binary @-
```
Expect `200` and a `WhatsApp message wamid.TEST ... failed` line in the server log.

**Then register with Meta.** The URL must be public HTTPS — use `ngrok http 5000` or VS Code **Ports → Forward a Port → 5000**, then set visibility to **Public** (private ports serve a GitHub auth page and the handshake fails).

1. App dashboard → **WhatsApp** → **Configuration** → **Edit**
2. **Callback URL**: `https://<public-host>/api/v1/notifications/whatsapp-webhook`
3. **Verify Token**: the same string as `.env`
4. **Verify and Save** — Meta calls the GET endpoint immediately; the server must be running
5. **Webhook fields** → **Manage** → subscribe to **`messages`**

Step 5 is separate from step 4. Saving the URL alone subscribes to nothing.

## 7. `.env` reference

| Variable | Source | Required |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Step 2 — numeric ID, not the phone number | Yes |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Step 2 — must be the WABA holding your templates | Yes |
| `WHATSAPP_ACCESS_TOKEN` | Step 4 — permanent system-user token | Yes |
| `WHATSAPP_APP_SECRET` | Step 6 — App settings → Basic | Webhook only |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Step 6 — you invent it | Webhook only |
| `WHATSAPP_API_VERSION` | e.g. `v25.0` | Defaults `v20.0` |
| `WHATSAPP_LANGUAGE_CODE` | Must match the templates' language | Defaults `en` |
| `WHATSAPP_SENDING_ENABLED` | Kill switch | Defaults `true`, `false` in staging |
| `WHATSAPP_TEMPLATE_*` | Only if approved under a different name | Optional |

```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_API_VERSION=v25.0
WHATSAPP_LANGUAGE_CODE=en
```

Template name vars are omitted deliberately — the code defaults to the names in step 5. Set one only to override.

## 8. Verify end to end

### Status check

```bash
npx tsx src/scripts/testWhatsApp.ts
```

Validates config, then compares every expected template against what exists on the WABA:

```
Templates on this WABA (5 total)
  ✅ appointment_booked — APPROVED (UTILITY), 5 placeholder(s)
  ⏳ appointment_reminder — PENDING (UTILITY), 3 placeholder(s)
  ❌ pharmacy_invoice — not found (not created yet?)
```

It flags placeholder-count mismatches, wrong language, and non-Utility categories. Run it while waiting on approval.

### Send a test message

```bash
npx tsx src/scripts/testWhatsApp.ts --to=+919876543210 --template=appointmentBooked
```

Omit `--template` to send all nine, using the step-5 samples. To smoke-test credentials only, independent of your templates:

```bash
npx tsx src/scripts/testWhatsApp.ts --to=+919876543210 --hello
```

`hello_world` is pre-approved on every WABA, so a successful send proves token, phone number ID, and delivery in isolation.

### Real flow

1. Restart so `.env` is re-read: `npm run dev:instance`
2. Book an appointment for a clinic with `whatsappEnabled = true` in `clinic_settings`, using a real WhatsApp number
3. Expect `WhatsApp template "appointment_booked" sent to ... successfully — message id: wamid...`
4. Confirm on the handset. **Acceptance is not delivery** — only the handset or the webhook proves it arrived.

---

## Troubleshooting

| Error | Meaning | Fix |
|---|---|---|
| `190` subcode 467 | Temporary user token expired | Step 4 — system-user token |
| `190` other | Token lacks permissions | Re-generate with both `whatsapp_business_*` scopes |
| `no response from Meta` | Network/DNS/proxy, nothing reached Graph | Retry; check firewall on `graph.facebook.com` |
| `133010` Account not registered | Number verified but not registered | Step 3 |
| `132001` Template does not exist | Wrong name, wrong language, or wrong WABA | Compare script output; check `WHATSAPP_LANGUAGE_CODE` |
| `132000` Parameter mismatch | Placeholder count differs, or a param has newlines | Align template body with `WHATSAPP_TEMPLATES` |
| `131026` Message undeliverable | Recipient has no WhatsApp, or number invalid | Expected for test/invalid numbers |
| Webhook `403` | Verify token mismatch, or `&` eaten by `cmd.exe` | Compare `.env` to Meta; use Git Bash |
| Webhook `401` | Missing/invalid signature | Set `WHATSAPP_APP_SECRET` |
| Sends silently skipped | `WHATSAPP_SENDING_ENABLED=false` | Set explicitly (defaults off in staging) |
| Templates listed as "not found" but visible in Meta | Wrong WABA in `.env` | See below |
| Recipient sees the phone number, not the business name | `name_status` is `DECLINED`, or the recipient has the number saved | [Display name](#display-name--why-recipients-see-a-number) |

### Test number vs real number

| | Test number | Real number |
|---|---|---|
| Registered | Already | Needs step 3 |
| Recipients | 5, manually verified | Anyone (tier limits apply) |
| WABA | Its own | Yours |
| Templates | Only `hello_world` unless recreated there | Your nine |
| Production | Never | Yes |

Because templates are per-WABA, switching to the test number means recreating and re-approving all nine on that WABA. Use it only for `--hello` smoke tests.

### Confirming which WABA a number belongs to

```bash
curl -s "https://graph.facebook.com/v25.0/<WABA_ID>/phone_numbers?fields=id,display_phone_number,platform_type,status" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

If your templates appear in WhatsApp Manager but the script says "not found", `WHATSAPP_BUSINESS_ACCOUNT_ID` is pointing at a different WABA than the one holding them.

---

## Notes

- **Per-environment WABAs**: dev/staging/prod can share one WABA, but separate ones are recommended so a staging test can't surface in prod logs or costs. Repeat steps 2–6 per environment.
- **Messaging tiers**: new WABAs start at 250 unique recipients/24h, rising automatically with quality rating and volume. Bulk testing throttles early.
- **Template edits** create a pending new version; the approved version keeps working until the new one clears.
- **`WHATSAPP_APP_SECRET` must stay secret** — it is what lets the webhook reject spoofed calls. Never commit it.
- **Access tokens are per system user, not per WABA** — one token can manage several WABAs, which is exactly how a mismatched `WHATSAPP_BUSINESS_ACCOUNT_ID` goes unnoticed: the token works, it just reads the wrong account.
