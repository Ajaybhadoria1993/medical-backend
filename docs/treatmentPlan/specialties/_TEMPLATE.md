# <Specialty> — end-to-end plan

Status: **plan only — nothing built.** Approve a step before code.
Parent: `../specialty-rollout-research.md` (Wave N). Clinical values need a <specialty>'s check.
Rule (2026-10-24): **Part A is built now** (appointment / prescription). **Part B waits** for the treatment-plan phase.

## 1. The doctor's flow today (checked in code)

| Stage | What exists | Where |
|---|---|---|
| Appointment clinical data | | |
| Prescription config (sections + lists) | | `utils/doctorSpecialtyConfig.ts` |
| Booking symptoms | | FE `constants/specialitySymptoms.ts` |
| Medicine panel / forms / instructions | | |
| Card / diagram on the prescription | | |
| Treatment plan templates / fields | | `seeds/libraryTemplates.json`, `treatment_specialty_configs` |

## Part A — appointment / prescription (now)

### 2. What's missing

| # | Gap | Why it matters | Fix | Build step (`prescription-first-plan.md`) |
|---|---|---|---|---|
| G1 | | | | |

Shared gaps → also add to `README.md` "Shared gaps".

### 3. Card / diagram

What the doctor clicks, what it saves, what prints. "None needed" is valid.

### 4. Prescription config

Sections, habits, allergy, pre-diagnosis, diagnosis, surgery, advice, diet; booking symptoms; medicine forms / instruction phrases.

### 5. Checklist (tick in browser)

- [ ]

## Part B — treatment plan (later)

### 6. Templates (4–5)

| Code | Template | Type / price | Steps or sessions | Keywords |
|---|---|---|---|---|

### 7. Plan config row

**Plan fields** · **Step fields** (no sensitive notes — reception reads plans)

### 8. Plan checklist

- [ ]

## 9. Questions

1.
