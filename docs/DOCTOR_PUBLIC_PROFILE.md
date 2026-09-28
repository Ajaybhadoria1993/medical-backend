# Doctor Public Profile — Architecture & Integration Guide

A world-readable marketing profile for a doctor: credentials, clinics, timings, fees,
payment options and patient reviews, served by **one unauthenticated API call** and rendered
by a standalone public web page.

Reference product for the page structure: eka.care's doctor profile.

---

## 1. Design principles

These are the constraints the implementation was built against. Change them deliberately.

| # | Principle | Why |
| - | --------- | --- |
| 1 | **One call renders the page** | The page is a marketing/SEO surface. Waterfalls of requests delay first paint and hurt ranking. Everything above and below the fold ships in a single response. |
| 2 | **Reuse, don't fork** | The patient app already had a doctor-profile aggregate. The public endpoint composes it rather than re-querying the same tables. |
| 3 | **Allow-list, never spread** | The upstream aggregate carries `email`, `mobile`, `licenseNumber`, `alternateMobile` and patient identity. A public payload is built field-by-field so a new upstream column can never silently become public. |
| 4 | **No new tables** | Every field on the page already existed in `users`, `user_profiles`, `user_professionals`, `doctor_qualifications`, `clinics`, `clinic_settings`, `clinics_service`, `clinic_availability` and `doctor_reviews`. |
| 5 | **Two-layer cache with different TTLs** | The assembled response is cached 5 min (bounds review/timing staleness); the expensive profile/clinic/fee half is cached 2h underneath it. Writes drop both immediately. |

---

## 2. Where the data comes from

No table was added for this feature. The public payload is assembled from:

| Payload section | Source |
| --------------- | ------ |
| `doctor.name`, `isVerified` | `users` (`name`, `userStatus = 'Active'`) |
| `doctor.gender`, `profileImage` | `user_profiles` |
| `doctor.speciality`, `qualification`, `yearsOfExperience`, `about`, `registrationNumber` | `user_professionals` |
| `doctor.qualifications[]` | `doctor_qualifications` |
| `rating.average`, `rating.count` | `user_professionals.average_rating` / `review_count` (denormalised — no aggregation query) |
| `totalPatients` | `count(distinct patient_id)` over `appointments` |
| `clinics[]` | `clinic_assign` → `clinics` → `clinic_settings` |
| `clinics[].services[]` | `clinics_service` (`doctor_id`, `is_deleted = false`, `can_be_booked_by_patient = true`) |
| `clinics[].timings[]` | `clinic_availability` + `clinic_availability_break` |
| `reviews` | `doctor_reviews` (`status = 'approved'` only) |

---

## 3. Backend

### 3.1 Endpoint

```
GET /api/v1/doctor/public/:doctorId
```

- **Auth:** none. No `Authorization` header, no cookie, no clinic scoping.
- **Params:** `doctorId` — UUID, validated by `doctorPublicProfileParamsSchema`.
- **404:** returned when the doctor does not exist, is not `Active`, or is not a doctor-type
  user. A 404 (not 403) is deliberate so the endpoint never confirms the existence of a
  hidden record.

The route file is `src/main/doctor/routes/v1/public.route.ts`. Because `loadRoutes.ts` mounts
`{feature}/routes/{version}/{file}.ts` at `/api/{version}/{feature}/{kebab-filename}` whenever
the filename differs from the feature name, naming the file `public.route.ts` inside the
`doctor` feature is what produces the `/api/v1/doctor/public` prefix. **Renaming that file
changes the public URL.**

### 3.2 Call flow

```
public.route.ts
  └── validate(doctorPublicProfileParamsSchema, 'params')
      └── doctorPublic.controller.ts        → sendOk(...)
          └── DoctorPublicService.getPublicProfile(doctorId)
              ├── PatientService.getDoctorPublicProfile(id, undefined, { audience: 'web' })
              │     └── Redis: doctor_public_profile_web:{doctorId}  (TTL 7200s)
              ├── DoctorServices.getDoctorAvailability(id, clinicId)   ← per clinic, live
              └── DoctorReviewService.getDoctorReviews(id, {1, 5})     ← live
                  └── toPublicDoctorProfile(...)  ← the allow-list mapper
```

### 3.3 The `audience` flag

`PatientService.getDoctorPublicProfile(doctorId, patientId?, options?)` serves two consumers:

| | `audience: 'patient'` (default) | `audience: 'web'` |
| - | - | - |
| Consumer | Patient app booking directory | Public marketing profile |
| Clinics returned | Only where `clinic_assign.online_booking_enabled` **and** `clinic_settings.online_booking_enabled` are true | Every `Active` clinic |
| Bookability | Implied (all returned clinics are bookable) | Carried per clinic as `onlineBookingEnabled` so the UI can hide the CTA on a non-bookable clinic |
| Cache key | `doctor_public_profile:{id}` | `doctor_public_profile_web:{id}` |
| `isFavorite` | Computed when `patientId` is passed | Not applicable |

The two audiences produce different clinic sets, so **they must not share a cache key.**

### 3.4 Privacy contract

`toPublicDoctorProfile` in `src/main/doctor/utils/doctorPublicProfile.utils.ts` is the only
thing standing between internal data and the open internet. Rules:

- Build the response **field by field**. Never `...spread` an upstream object into it.
- **Never exposed:** `email`, `mobile`, `alternateMobile`, `licenseNumber`, `zipCode` of the
  doctor, doctor's home `address`, patient `id`, patient `profileImage`, `createdAt`,
  `userStatus`, `isAdminDoctorAccess`.
- **Deliberately exposed:** `registrationNumber` — a medical-council registration is public
  record and is the standard trust signal on doctor listings. This is *not* the same field as
  `licenseNumber`, which stays private.
- **Reviewer names are masked** to first name + last initial (`Rahul Sharma` → `Rahul S.`)
  by `maskReviewerName`. Empty/unknown → `Anonymous`.
- **Clinic phone honours `clinic_settings.show_clinic_number_publicly`** — when false the
  field is returned as `null` rather than omitted, so the shape stays stable.
- Only `status = 'approved'` reviews are ever returned (enforced upstream in
  `DoctorReviewService.getDoctorReviews`).

### 3.5 Caching & invalidation

Cache keys are declared in `src/utils/cache.util.ts` — per `docs/playbook/BACKEND_STANDARDS.md`,
never as inline template strings:

```ts
CacheKeys.doctorPublicProfile(doctorId)      // doctor_public_profile:{id}       patient app,  2h
CacheKeys.doctorPublicProfileWeb(doctorId)   // doctor_public_profile_web:{id}   web inner,    2h
CacheKeys.doctorPublicProfileFull(doctorId)  // doctor_public_profile_full:{id}  web response, 5m
CacheKeys.doctorPublicProfileAll(doctorId)   // all three, for invalidation
```

**Layering.** `DoctorPublicService.getPublicProfile` wraps the whole assembly in
`getOrSetCache(...doctorPublicProfileFull, 300)`. On a hit the request costs **one Redis GET and
zero SQL**. On a miss it rebuilds, which itself hits the 2h inner profile cache, so only the
timing/review queries actually run.

The response also carries
`Cache-Control: public, max-age=300, stale-while-revalidate=60` — the endpoint is unauthenticated
and byte-identical for every visitor, so browsers and any CDN/proxy in front can serve it too.
**If you ever make the payload visitor-specific, that header must change**, or one visitor's
response will be served to another.

`invalidateCacheMany(keys: string[])` deletes a set and swallows/logs Redis failures, so
callers need no try/catch.

Both keys are invalidated together on every write that feeds the payload:

| Write | Location |
| ----- | -------- |
| Doctor profile update (incl. availability rewrite) | `DoctorServices.updateUser` |
| Profile image update | `DoctorServices.updateProfileImage` |
| Service create / update / delete / toggle | `DoctorServices.*Service*` |
| Clinic core update | `ClinicService.updateClinicById` |

Reviews and timings are **not** cached, so no review or availability write needs invalidation.

### 3.6 Response shape

```json
{
  "success": true,
  "message": "Doctor public profile fetched successfully",
  "data": {
    "doctor": {
      "id": "…uuid…",
      "name": "Ebony Rogers",
      "gender": "Female",
      "profileImage": "https://…",
      "speciality": "Cardiologist",
      "qualification": "MBBS, MD",
      "yearsOfExperience": 14,
      "about": "…",
      "isVerified": true,
      "registrationNumber": "13033",
      "qualifications": [
        {
          "qualificationType": "PG",
          "qualificationTitle": "MD",
          "specialization": "Cardiology",
          "boardOrUniversity": "MPMC",
          "yearOfCompletion": 2012
        }
      ]
    },
    "rating": { "average": 4.6, "count": 23 },
    "totalPatients": 14,
    "clinics": [
      {
        "id": "…uuid…",
        "clinicName": "Infinity Medisetu",
        "tagline": "…",
        "clinicAddress": "115, Ward 35, Ratna Lok Colony",
        "clinicPhone": "9966553322",
        "city": "Indore",
        "state": "Madhya Pradesh",
        "zipCode": 452010,
        "clinicLogo": "https://…",
        "latitude": 22.71, "longitude": 75.85,
        "onlineBookingEnabled": true,
        "maxAdvanceBookingDays": 7,
        "payOnlineEnabled": true,
        "payAtClinicEnabled": true,
        "services": [
          { "id": "…", "serviceName": "Consultation", "price": 500, "currency": "INR", "durationDays": null }
        ],
        "timings": [
          {
            "dayOfWeek": "Monday",
            "startTime": "18:00",
            "endTime": "20:00",
            "isAvailable": true,
            "breaks": [{ "startTime": "19:00", "endTime": "19:15" }]
          }
        ]
      }
    ],
    "reviews": {
      "total": 23,
      "items": [
        {
          "id": "…uuid…",
          "rating": 5,
          "reviewText": "…",
          "replyText": "Thank you!",
          "replyAt": "2026-01-04T10:00:00.000Z",
          "createdAt": "2026-01-02T09:00:00.000Z",
          "patientName": "Rahul S."
        }
      ]
    }
  }
}
```

### 3.7 Backend file map

| File | Role |
| ---- | ---- |
| `main/doctor/routes/v1/public.route.ts` | Route (no auth middleware) — **filename determines the URL** |
| `main/doctor/controllers/doctorPublic.controller.ts` | `asyncHandler` + `sendOk` |
| `main/doctor/services/doctorPublic.service.ts` | Composes the three upstream calls |
| `main/doctor/utils/doctorPublicProfile.utils.ts` | Allow-list mapper, reviewer masking, timing normalisation |
| `main/doctor/types/doctorPublicProfile.types.ts` | Response contract |
| `main/doctor/schemas/doctorPublic.schemas.ts` | Zod params |
| `main/patient/services/patient.service.ts` | Shared aggregate + `audience` flag |
| `utils/cache.util.ts` | `CacheKeys.doctorPublicProfile*`, `invalidateCacheMany` |

---

## 4. Frontend

### 4.1 Route

```
/doctor/:doctorId
```

Registered in `src/routes/routes.ts` inside the `authRequired: false` group, following the
`publicLabBarcode` precedent.

> **Do not add `public: true` to this route.** In this codebase that flag means *guest-only* —
> `AppRoutes.tsx` renders `<Navigate to={authedRedirect} />` for a `public` route when a user
> is authenticated, which would make the profile invisible to every logged-in visitor.

The page renders **outside** `MainLayout`, so it carries its own header and footer rather than
the app sidebar/shell.

### 4.2 Theme & styling rules

Per `docs/playbook/UI_CONVENTIONS.md`, this page uses **semantic tokens only**:

| Use | Token |
| --- | ----- |
| Card / panel background | `bg-surface` |
| Page background, chips, skeletons | `bg-surface-muted` |
| Primary text | `text-text` |
| Secondary text | `text-text-muted` |
| De-emphasised text, icons | `text-text-subtle` |
| Borders, dividers | `border-line` |
| Brand actions | `bg-primary`, `hover:bg-primary-hover`, `text-primary` |
| Brand tint background | `bg-secondarybtn` |
| Rating stars | `text-warning` / `fill-warning` |

Consequences to preserve when editing:

- **No `dark:` overrides anywhere on this page.** The `.dark` block in `index.css` remaps these
  token variables, so light/dark both work from one class list. Adding `dark:` hex pairs here
  re-introduces the exact bug the playbook warns about.
- **No `bg-white`** — it never inverts and would stay white in dark mode.
- Touch targets are `min-h-12` on mobile CTAs and `h-10` (→ `lg:h-9`) on the header icon
  button; the share button carries an `aria-label`.

### 4.3 Page structure

Two-column on `lg` (`minmax(0,1fr)_320px`), single column below. Sidebar is `lg:sticky`;
on mobile it is replaced by a fixed bottom CTA bar.

| Order | Section | Source data | Hidden when |
| ----- | ------- | ----------- | ----------- |
| — | Platform header — brand logo, marketing nav (About / Pricing / Blogs / FAQ), share, Book CTA | static | never |
| 1 | Hero — avatar/initial, name, verified badge, speciality, qualification, rating, experience, patients treated, city, in-clinic indicator | `doctor`, `rating`, `totalPatients` | never |
| 2 | Specialisations chips | speciality + qualification specialisations, de-duped | no specialisations |
| 3 | About | `doctor.about` | empty |
| 4 | Education & registration | `qualifications[]`, `registrationNumber` | both empty |
| 5 | Clinics — logo, de-duplicated address + map link, phone, **embedded map**, day-wise hours, payment options, fees, per-clinic CTA | `clinics[]` | no clinics |
| 6 | Patient reviews — masked name, stars, text, doctor reply | `reviews` | no reviews |
| 7 | FAQ — auto-generated accordion | derived | no derivable FAQs |
| — | Sidebar — "from ₹X", Book, Call clinic, advance-booking window, payment options | `clinics[]` | — |
| — | Platform footer — copyright, Home / Guidelines / Privacy | static | never |

Every section is conditional, so a sparse profile degrades to a clean short page instead of
rendering empty headings.

### 4.4 Derived content & SEO

`helpers/doctorPublicContent.ts` derives display content from the payload — nothing here needs
new API fields:

- `getDoctorDisplayName` — prefixes `Dr.` unless already present.
- `getSpecializations` — merges speciality + qualification specialisations, case-insensitively de-duped.
- `getPaymentMethods` / `getLowestFee` — from `payOnlineEnabled`, `payAtClinicEnabled`, service prices.
- `buildFaqs` — generates the FAQ block (specialisation, experience, location, timings, fees,
  how to book, rating) from whatever data exists.
- `buildJsonLd` — schema.org `Physician` markup including `aggregateRating` and `PostalAddress`.

`hooks/usePublicProfileSeo.ts` applies `document.title`, a `meta[name="description"]`, and the
JSON-LD `<script>` on mount, and **restores the previous values on unmount** (the app is a SPA
with no head manager, so leaking a title into the next route would be a real bug).

### 4.5 Timing format gotcha

`clinic_availability.start_time` / `end_time` are **free-text `varchar`**, not `time`. Real data
contains both `"18:00"` and `"6:00 PM"`. `formatTime` therefore detects an existing AM/PM suffix
and passes it through, converting only the 24-hour form. Removing that check reproduces the
`6:00 AM AM` bug.

### 4.6 Booking hand-off

`handleBook` sends unauthenticated visitors to `/login` with `state.from` set to the profile
URL, and authenticated ones to `/appointment/new` with `state.doctorId`.

### 4.7 Frontend file map

```
src/pages/doctorPublic/
├─ DoctorPublicProfile.tsx          # page: query, SEO hook, share/book handlers, composition
├─ components/
│  ├─ PublicPageHeader.tsx          # platform bar (logo + share)
│  ├─ PublicPageFooter.tsx          # platform footer
│  ├─ DoctorHero.tsx                # identity + stat row
│  ├─ CredentialsSection.tsx        # education timeline + council registration
│  ├─ ClinicCard.tsx                # address, map, hours, payments, fees, CTA
│  ├─ BookingSidebar.tsx            # sticky desktop booking panel
│  ├─ ReviewItem.tsx                # single review + doctor reply
│  ├─ FaqSection.tsx                # <details> accordion
│  ├─ SectionCard.tsx               # shared panel wrapper
│  └─ Stars.tsx                     # rating stars
├─ helpers/
│  ├─ doctorPublicFormatters.ts     # time/day/address/map formatting
│  └─ doctorPublicContent.ts        # display names, chips, FAQs, JSON-LD
└─ hooks/
   └─ usePublicProfileSeo.ts        # title, meta description, JSON-LD lifecycle

src/redux/api/publicDoctorApi.ts     # RTK Query slice (registered in apiRoot.ts)
src/types/doctor/publicProfile.ts    # response types (exported via src/types/doctor/index.ts)
```

Types live in `src/types/doctor/`, not inline in the API slice, per the FE `CLAUDE.md`.
The slice is registered in `apiRoot.ts` — without that its reducer and middleware are never wired.

### 4.8 Owner entry point

`src/pages/profile/Overview.tsx` renders **Copy link** and **View public profile** actions in
`ProfilePageHeader` for doctor-type users, pointing at `${window.location.origin}/doctor/{userId}`.

---

## 5. Operational notes

### Verifying the endpoint

```bash
# No auth header — must return 200 with the full payload
curl -s http://localhost:5000/api/v1/doctor/public/<doctorId> | jq

# Privacy assertion: all of these must return null/empty
curl -s http://localhost:5000/api/v1/doctor/public/<doctorId> \
  | jq '.data.doctor | {email, mobile, licenseNumber}'
```

Swagger UI: `http://localhost:5000/api-docs`.

### Plan Gating & Subscription Integration

The Public Profile + Booking Page is gated by the clinic's active subscription plan via `FEATURE_KEYS.PUBLIC_BOOKING_PAGE`:

| Plan | Feature Status | Behavior on `/api/v1/doctor/public/:doctorId` |
| ---- | -------------- | --------------------------------------------- |
| **Free / Trial (₹0/mo)** | ❌ Disabled | Returns `404 Not Found` (Option A). Free clinics are excluded. |
| **Basic (₹499/mo)** | ✅ Enabled | Returns public profile with practice info and direct booking. |
| **Pro (₹999/mo)** | ✅ Enabled | Returns public profile with practice info and direct booking. |

*Multi-clinic behavior:* If a doctor practices across multiple clinics, only clinics with `public_booking_page` enabled in their plan are rendered on the public page. If no assigned clinics are on an enabled plan, a `404 Not Found` is returned.

### Current limitations

| Limitation | Impact | Fix when needed |
| ---------- | ------ | --------------- |
| URL uses the doctor **UUID**, not a slug | Not SEO-friendly; the reference product uses `/doctor/name-id` | One nullable `slug` column on `user_professionals`; the service resolver becomes slug-or-UUID. Nothing else changes. |
| Reviews capped at 5, no pagination | Long review lists are truncated | Add `?page` to the public endpoint or a `/reviews` sub-route |
| Languages, awards, memberships not modelled | Sections the reference product has cannot be rendered | Requires new columns — deliberately deferred |
| No SSR | JSON-LD and meta description are applied client-side; crawlers that don't execute JS see the shell | Pre-render or SSR this route if organic search becomes a priority |

### Verification status at time of writing

- Backend: `tsc --noEmit` clean, ESLint clean on all new files.
- Frontend: `tsc -b` and ESLint were clean as of the pre-redesign revision; the richer
  layout (sections 2, 4, 7, sidebar, header/footer, SEO hook) was added afterwards and its
  typecheck/lint run has **not** been completed. Run `npm run build` and `npm run lint`
  in `InfinityMedisetuWeb_FE` before shipping.
- The existing `patient.service.test.ts` suite covering `getDoctorPublicProfile` was **not**
  successfully run against the `audience` change. Run
  `npx jest src/main/patient/tests/patient.service.test.ts -t "getDoctorPublicProfile"`.
