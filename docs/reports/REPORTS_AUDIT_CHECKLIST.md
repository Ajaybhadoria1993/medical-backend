# Reports audit checklist

How to audit and fix one Reports tab (Patients, Appointments, Revenue, Medicines, Staff, Custom), so
each goes as fast as the Overview did (2026-10-07). It collects the rules agreed while fixing the
Overview. The playbooks stay the authority on *how code is written*; this file is the authority on
*what each report figure means*.

- Backend: `src/main/reportsOverview/` — one `*.service.ts` per tab, shared helpers in
  `utils/reportsPeriod.utils.ts` (periods, `firstVisitJoin`) and `utils/reportsTrend.utils.ts`
  (`serviceJoin`/`scopeFilter`, trend slots with real-date labels, `slotMeta`, `padSlots`),
  money fragments in `dashboard/utils/revenueSql.ts`. Reuse these; never copy them into a tab.
- Frontend trend selectors: `hooks/useTrendPeriods.ts` (`autoPeriod`, `periodOptions`).
- Done: Overview, Patients, Appointments, Revenue, Pharmacy (was "Medicines"; `/reports/pharmacy`, old URL redirects), Staff, Custom (2026-10-07). Time of day: `knownTimeOfDay` in `reportsTrend.utils.ts`.
- Frontend: `src/pages/reports/*.tsx`, shared cards in `src/components/reports/`
  (`DataTable`, `LineChart`, `DonutChart`, `PremiumFeatureCard`, `ReportFilterBar`).
- Playbook rules this builds on: BE `BACKEND_STANDARDS.md` §7 "Money figures" and "Appointment time of
  day"; FE `FRONTEND_STANDARDS.md` §10 "Table view", "Appointment time — token vs slot", "Dashboards".

---

## 1. How to run an audit (order matters)

1. **Read before judging.** The tab's FE page, its RTK slice in `redux/api/reportsOverviewApi.ts`,
   and the BE service function behind every card. Trace each number end to end.
2. **Check the numbers against real data.** Read-only queries on the **dev** DB only (a throwaway
   `tsx` script using `databaseConfig`, deleted after). Never write to any DB without explicit approval;
   never touch staging/prod.
3. **Compare with the Dashboard / Finance.** A figure another screen already shows must use the same
   rule (§2). If they disagree, the shared rule wins — say which screen is wrong.
4. **Report findings first, ranked, plain language.** List what is wrong, what is right, and what needs
   the owner's decision. No edits until approved ("let's do X" = plan only).
5. **Fix in the shared place.** If a helper or shared card is wrong, fix it once there, not per card.
6. **Verify with IDE diagnostics only.** No eslint / jest / tsc runs, no Prettier on the FE. Name the
   single test file the user can run if logic changed.
7. **Hand over:** what changed per card, files touched, anything left out of scope. Never commit.

**While verifying:** Reports cache TTLs may be set to 1s (`// TEMP: 1s` in each service). Restore to
120 before any commit — `grep -rn "TEMP: 1s" src/main/reportsOverview`.

---

## 2. What each figure means (the source of truth)

| Figure | Rule | Helper |
|---|---|---|
| Total patients / Unique patients | Distinct patients with an appointment in range, **any status** (Dashboard rule). Call it "Unique Patients", never "Patients Seen" | — |
| Appointments (headline) | Every appointment in range, any status | — |
| Appointments in a per-service / per-doctor table | Excludes Cancelled and NoShow — the subtitle must say so | — |
| New patient | **First-ever appointment at the clinic** (with that doctor if filtered) falls in range. Never "appointment created in range" | `firstVisitJoin` |
| Returning patient | Seen in range and had an earlier appointment | `firstVisitJoin` |
| Inactive patient | No visit in 90+ days as of the range end (or today), and none in range | — |
| Revenue | `RECEIVED_AMOUNT` on `HAS_RECEIVED_MONEY` rows, dated by `appointmentDate`, **no status filter** (a paid visit later cancelled still took the money) | `revenueSql.ts` |
| Pharmacy sales | Line `total` net of returns: after discount, **excluding GST**. Never `units × mrp`, never the invoice total. Label "Net Sales (excl. GST)" | `NET_AMOUNT` in `reportsMedicines.service.ts` |
| Prescriptions | One per report card, not per medicine line | — |
| Avg. rating | `doctor_reviews`, status `approved`, clinic via the appointment, dated by review `created_at`. `feedbacks` is an unused form. No reviews → "—" + "No change" | — |
| Time of day (busiest hour, slots) | IST check-in (`arrived_at` is UTC) else the booked slot; token bookings' `'23:59'` placeholder is never a time | `bucketRowsByHour`, `isTokenPlaceholderTime` |
| No-show rate | No-shows ÷ non-cancelled appointments (NoShow + Missed). Show only with ≥ 5 appointments and ≥ 2 no-shows | — |

**Token vs slot:** decide per appointment (`tokenNo` set = token). A clinic, even one day, can mix both.

**Money (Revenue tab, 2026-10-07)** — the Finance definitions, never `price`:

| Card | Rule |
|---|---|
| Total Revenue | `RECEIVED_AMOUNT` on `HAS_RECEIVED_MONEY` rows (after refunds) — equals Dashboard / Finance `netRevenue` |
| Gross Collected | `CLINIC_AMOUNT` on `HAS_RECEIVED_MONEY` rows (before refunds) |
| Refunds Issued | Gross − Total Revenue (Finance's `refundsIssued`), never `SUM(refunded_amount)` |
| Outstanding Dues | `CLINIC_AMOUNT` where `UNPAID_PAYMENT AND NOT NOT_ATTENDED` (a cancelled "Pay Later" owes nothing) |
| Paid Appointments / Avg. | rows with `HAS_RECEIVED_MONEY`; avg = Total Revenue ÷ that count |

- [ ] **Every money breakdown adds up to Total Revenue** (service, payment method, doctor, type, trend) and
      its subtitle says so. Verify by running the service on dev data and summing each list.
- [ ] Filter options (payment mode, appointment type) come from the clinic's own data, never a fixed list.
- [ ] No calendar-year / YTD / "monthly summary" cards — they break "every card follows the selected dates".
- [ ] **Staff:** appointments reference only the doctor, so the Role filter on workload means "Doctor" =
      anyone who sees patients (an Admin owner who practises included); any other role matches its
      account type and usually shows no workload. Staff counts and account status are "as of today".
- [ ] **The one exception is current stock** (catalogue size, low stock, expiring batches, stock value):
      it can only be "today". Those cards say "as of today" and the banner says "stock is as of today";
      they show no comparison arrow. Anything about sales or purchases follows the dates.
- [ ] Pharmacy sales/units are net of returns everywhere, including derived figures (fast/slow/dead stock),
      and scoped to the clinic's pharmacies. A medicine is fast **or** slow, never both.
- [ ] **"Already Paid" visits count their paid add-ons, never the consultation** (`revenueSql.ts`), in
      Dashboard, Reports, Finance, Custom and Payments History alike. Group money by `PAYMENT_MODE` (visit
      mode, else the add-on's), never the raw `payment_mode` column, so no received money shows as unknown.
- [ ] **"Busy" = visits that happened; "by day" = every booking.** Busiest hours/days (dashboard card,
      Overview alert) leave out `NOT_ATTENDED` and use `knownTimeOfDay`. The Appointments weekday chart
      counts every booking, cancelled included, and its subtitle says so. Busy windows are whole weeks.
- [ ] **Custom builder:** its metrics are raw SQL strings, so money must come from the shared drizzle
      fragments rendered by `onBaseAliases` (`reportsCustom.catalog.ts`), never `p.price`. "Collected" = paid
      only; "Pending" = the dues rule. One payment row per appointment is a DB `UNIQUE`, so counts never double.
- [ ] Any CSV exports every row (all pages) with the period on top, not just the visible page.

---

## 3. Periods and comparisons

- [ ] **Values cover the whole selected range** (future bookings included); **the % compares only the
      elapsed part** with the same part of the previous period. Wrap card groups in `wholeRangeValues`;
      rates and "as of" figures use `elapsed`.
- [ ] **Previous period** = the same number of days just before the range (whole months → the months
      before), from `buildComparisonRange`. Never a local copy of the maths.
- [ ] **Say which previous period, in two places.** The period banner shows the exact window ("compared
      with 24–30 Sept 2026"); metric cards use the short Dashboard-style label from
      `pages/reports/helpers/comparisonLabel.ts` ("vs previous 7 days", "vs last month", "vs selected
      period"). Never a bare "vs previous days", never full dates crammed into every card.
- [ ] **Previous period was zero** → "New" (grey, no arrow), never "+100%". Both zero → "No change".
- [ ] **A rate's change is in percentage points** (completion, no-show): 9% → 14% shows "+5 pts", never
      "+57%". Use `rateChange` (`reportsPeriod.utils.ts`); the card's change text ends in " pts".
- [ ] **Days are IST.** No `setHours`, no `new Date(y, m, d)` for day bounds.
- [ ] **Every card follows the selected dates only.** No card switches to a different window (calendar
      month, this week…) — the owner found that confusing even when labelled. A side-by-side comparison
      table uses the same selected/previous periods, values and % as the metric cards.
- [ ] **Every number on screen explains its %.** If the % uses a window the columns don't show, fix the columns.

## 4. Trend charts

- [ ] Period options follow the range: **Daily ≤ 92 days, Weekly ≥ 14, Monthly ≥ 60**; hide the selector
      when only one fits. Default selection mirrors the backend's auto bucket.
- [ ] Every option re-fetches **the filter's own range and filters** (Doctor + Service), never "current
      week/month". Changing the filters resets a picked period.
- [ ] Axis labels are real dates ("Thu 1", "1–4 Oct", "Oct 2026"), never "Week 1".
- [ ] Legend names both windows; the tooltip names **each line's own date** (previous ≠ same weekday).
- [ ] **Every chart tooltip names the real date(s) behind the bar or point**, never just the axis label —
      the backend sends a `detail` per bucket ("Wed, 7 Oct 2026", "1–4 Oct 2026"). Weekday bars list
      their dates ("Wednesdays: 1, 8, 15 Oct 2026"; a weekday not in the range says so).
- [ ] A shorter previous period pads with **zero**, never a copy of its last bucket.
- [ ] A headline total above a chart comes from the same query as the bars; regrouping must not change it.

## 5. Filters

- [ ] **Every card honours Service and Doctor.** Use `serviceJoin` + `scopeFilter`; where
      `clinic_services` is already joined, add only the filter.
- [ ] Data with no doctor/service link (pharmacy sales) ignores them — the subtitle says so.
- [ ] Ratings and other side tables reach the filters through their appointment.

## 6. Card UI

- [ ] **Use the shared `ReportFilterBar`** — never a hand-built bar. Its layout rules (row 1 fixed, compare
      opens as row 2, actions keep their space) are in FE `FRONTEND_STANDARDS.md` §10 "Filter bars".
- [ ] **A period banner** under the filter bar on every tab ("Showing … · compared with …").

- [ ] **Subtitle states the period and the basis** ("For 1–7 Oct 2026 · money received").
- [ ] Labels in Title Case; units named ("₹", "excl. GST", "Units Sold").
- [ ] **Info hint only where the label alone is ambiguous** (e.g. "Bookings per Patient" — a ratio whose
      basis isn't obvious). Use `PatientMetricCard`'s `tooltip`; a self-explanatory card gets none, so the
      icon keeps its meaning. Never truncate a label — let it wrap.
- [ ] **Empty state:** `StateCard compact border="none"`, title "Nothing recorded in this period"
      (alerts: "Nothing to flag in this period") + one line on what fills it. Never a blank table, flat zero
      line, ₹0 bars or a list of zeros. A trend stays drawn if only the previous period has data.
- [ ] **Bucket tables (frequency, recency, age bands) read like sentences:**
      - Title says what it answers ("How Often Patients Booked", "When Patients Last Came"), not the column.
      - Rows in plain words ("Once", "2–3 times", "31–90 days ago"), not "1 Appointment" / "31–90 Days".
      - **Every bucket always shown, zeros included** — the backend returns a fixed list; a missing row reads as a gap.
      - Subtitle states the total that is 100% ("14 patients in 1–7 Oct 2026 · …") and the as-of date if any.
      - Percent column is headed by what it is a share of ("% of Patients"), never "Share" or "%".
      - Where a bucket matches another card, say so in the row or subtitle ("over 90 days = Inactive"),
        so the two figures can be checked against each other.
      - All buckets zero → pass an empty list so the shared empty state shows, not a list of zeros.
      - **Bucket charts too** (weekday, hour): a plain title ("Appointments by Day of the Week"), a
        one-line question as subtitle ("How many of the 35 appointments in … fell on each day"), and the
        **answer stated in words above the chart** ("Busiest: Friday · 12 appointments") with that bar
        highlighted. Never explain the maths in the subtitle — the tooltip carries the dates.
      - Table columns keep a gap (`px-2`, built into `DataTable`); a long header is shortened and defined
        in the subtitle, never run together.
      - **A quarter-width card holds at most 3 columns.** Fold a 4th into a neighbour ("5 (14%)") rather
        than letting the table scroll or cut. Number columns never wrap; only the name column may.
- [ ] **Long lists scroll inside the card** after ~10 rows (`max-h-[440px] overflow-auto`, sticky header).
- [ ] **Change colours follow meaning:** more no-shows/cancellations is red, fewer is green (`PatientMetricCard goodWhen="down"`).
- [ ] **Alerts carry their numbers** in `detail` ("7 of 8 appointments (88%) · period average 75%") and
      stay hidden below a 5-appointment sample.
- [ ] **No fake numbers.** Remove anything hard-coded (e.g. `meta.accuracy: 98.6`). An unbuilt feature
      gets `comingSoon`, not a button that only logs.
- [ ] CSV export uses the same labels and units as the screen.

## 7. Per-tab checklist (copy into the hand-over)

```
Tab: ____________      BE: services/reports____.service.ts      FE: pages/reports/____.tsx
[ ] Every card traced FE → BE; numbers checked on dev data
[ ] Each figure matches §2 (and the Dashboard where both show it)
[ ] Periods / % / previous-period label per §3
[ ] Trends per §4 (options, labels, tooltip dates, padding)
[ ] Service + Doctor filters on every card (§5)
[ ] Subtitles, units, empty states, scrolling, colours, no fake numbers (§6)
[ ] Token '23:59' never read as a time
[ ] CSV export matches the screen
[ ] IDE diagnostics clean; nothing committed; TEMP cache noted
```

## 8. Known open items going into the other tabs

- Patients / Appointments / Revenue footers likely pass the fake `meta.accuracy` — remove.
- Appointments tab: Top Doctors and Time Slots are hand-built lists without the shared empty state.
- Other tabs' trend data (`reportsPatients`, `reportsRevenue`, …) has no real-date labels yet — reuse the
  Overview's `slotMeta` / `spanLabel` approach.
- Medicines tab: sales now net excl. GST; check its remaining cards (inventory value still uses MRP/cost by design).
- 14 non-report screens still print the token `'23:59'` as 11:59 PM (deferred; list in the team's notes).
- Timezone: dev Postgres runs Asia/Calcutta (`created_at` = IST); staging/prod not yet checked. Don't
  pin a zone until they are.
- Billing question for the owner: pharmacy sales add GST on top of MRP (MRP is GST-inclusive in India).
