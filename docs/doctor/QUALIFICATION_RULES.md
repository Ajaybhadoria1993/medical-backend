# Doctor Qualifications — Rules Reference

Every rule now live in the **Education & Qualifications** section (Onboarding and Edit Profile).
Source: `doctor_qualifications_8.xlsx` (NMC / DCI / NCISM / NCH / NBEMS), plus the changes agreed while building.

**Golden rule:** apart from the save checks in section 1, every rule only **warns**. A doctor can always save.

---

## 1. Save checks (backend; these do block)

| # | Rule | What happens |
|---|---|---|
| S1 | Qualification Type must be a listed category | Otherwise: "Select a qualification type from the list" |
| S2 | Old category names are accepted | Saved under the new name (e.g. "Graduation (Under-Graduate)" → "Undergraduate (UG)") |
| S3 | Qualification Title is required, max 100 characters | Listed degrees are saved in the official spelling; custom ("Other") names are kept as typed |
| S4 | About 60 old degree spellings are corrected | e.g. "MS ENT" → "MS Otorhinolaryngology (ENT)" |
| S5 | University / Medical College: max 150 characters | A listed college is saved in its official spelling; anything else is kept as typed |
| S6 | Notes: max 300 characters | Unchanged |

## 2. Categories offered

Undergraduate (UG) · Postgraduate (PG) Degree · Postgraduate (PG) Diploma · Postgraduate (PG) – Pursuing ·
Super Speciality (DM / MCh / DrNB) · Post-Doctoral · Doctoral / Research · Medical MSc (Non-Clinical) ·
Fellowship & Certification · Certificate Courses · International Qualifications

- **Removed:** "Undergraduate (UG) – Pursuing / Intern". Students and interns cannot practise independently (NMC CRMI 2021).
- **"Pursuing" means PG / super speciality only.** These rows ask for an **Expected Year** (this year to +3).
- **Added:** "FMGE / NExT Passed" under International Qualifications.

**Checked against the source (2026-10-21):** MD, MS, DM and MCh match NMC's course list on its
[College and Course Search](https://www.nmc.org.in/information-desk-college-and-course-search) page.
- **14 NMC PG diplomas** missing from the sheet were added (e.g. Diploma in Forensic Medicine (DFM), Diploma in Virology (D.Vir)).
- **"DM Gastroenterology"** is now **"DM Medical Gastroenterology"**, as NMC names it; old rows map automatically.
- **"DM Pulmonary, Critical Care & Sleep Medicine"** keeps the PGMER 2023 name (NMC's search still says "Pulmonary Medicine").
- **MD Infectious Diseases and MD Medical Genetics** are in the sheet but not on NMC's search (it lists only courses a college runs today).
- **DNB broad specialties:** all 30 match NBEMS's [DNB Broad Specialty](https://natboard.edu.in/dnbbroad) page.
- **Not yet checked against their regulators:** DNB (Post-Diploma), DrNB and FNB (NBEMS), MDS (DCI), AYUSH (NCISM), Homoeopathy (NCH), international qualifications.

## 3. Smart picker behaviour

| # | Rule | Example |
|---|---|---|
| P1 | **Next step first** in Qualification Type, tagged "Next Step" | Nothing yet → UG, International · UG done → PG Degree / Diploma / Pursuing · Medical PG → Super Speciality, PG Pursuing, Fellowship, PhD · MDS / AYUSH PG → Fellowship, PhD, Certificate · Super Speciality → Post-Doctoral, Fellowship |
| P2 | **Speciality-based suggestions first** in Qualification Title, tagged "Suggested" | Dentist → BDS, MDS, dental fellowships · Cardiologist → MBBS, MD General Medicine, DM Cardiology |
| P3 | Suggestions stay within the doctor's system of medicine | A Dentist is never suggested MBBS; an Orthopedic Doctor is never suggested MDS Orthodontics |
| P4 | Type a degree in Qualification Type (Edit Profile only) | "bds" → BDS · Undergraduate (UG); picking it fills both fields |
| P5 | Impossible titles are hidden | BDS completed → "BDS (Pursuing)" not offered; MD Pathology completed → "MD Pathology (Pursuing)" not offered |
| P6 | Every degree stays selectable; "Other" allows free text | — |

## 4. Warnings shown under a row (never block)

**System of medicine** — streams: Modern Medicine, Dental, Ayurveda, Unani, Siddha, Sowa-Rigpa, Homoeopathy, Naturopathy & Yoga (each AYUSH system is separate).

| # | When | Message (example) |
|---|---|---|
| W1 | Degree doesn't fit the doctor's speciality | BUMS is a Unani degree; Dermatologist needs Modern Medicine. |
| W2 | PG / super speciality from a different stream than the UG | MD Pathology is a Modern Medicine course, but your undergraduate degree BUMS is Unani. |

Specialities that need no medical degree are never checked: Physiotherapist, Speech Therapist, Dietitian / Nutritionist, Psychologist.

**Order of study**

| # | When | Message (example) |
|---|---|---|
| W3 | PG / super speciality / post-doctoral with no UG | Add your undergraduate degree (e.g. MBBS) before MD Anaesthesiology. |
| W4 | Super speciality while the PG is still pursuing | Complete MD General Medicine before DM Cardiology. |
| W5 | Super speciality with no PG | DM Cardiology needs a completed PG degree (MD / MS / DNB); add it first. |
| W6 | Super speciality whose feeder PG doesn't match (NEET-SS groups) | DM Cardiology needs a PG in General Medicine or Paediatrics or Respiratory Medicine; your PG is MS General Surgery. |
| W7 | Post-Diploma DNB without the matching PG Diploma | DNB (Post-Diploma) Psychiatry needs a PG Diploma in Psychiatry; add the Diploma first. |
| W8 | Foreign medical degree without FMGE / NExT | Add your FMGE / NExT result as a separate qualification to practise in India. |

The 6-year MCh (post-MBBS) needs no PG, so W4 to W6 skip it.

**Duplicates and status**

| # | When | Message (example) |
|---|---|---|
| W9 | Same qualification twice | MBBS is already added. |
| W10 | Same renewable certificate twice (BLS, ACLS, PALS, ATLS) | BLS … is already added; keep only your latest certificate. |
| W11 | Same course as completed and pursuing | MD Pathology is already added as both completed and pursuing. |
| W12 | Two courses pursued at the same level | You are already pursuing MD Pathology (Pursuing); only one course at this level at a time. |

**Years**

| # | When | Message (example) |
|---|---|---|
| W13 | Completion year in the future | Completion year 2028 is in the future. |
| W14 | Expected year already passed (pursuing) | Expected year 2024 has passed; choose 2026 or later. |
| W15 | Year earlier than the qualification it builds on | MD Pathology (2020) is before MBBS (2022); check the years. |
| W16 | Gap shorter than the minimum | MD Pathology (2022) is only 1 year after BUMS (2021); a PG degree takes at least 3 years. |

**Minimum gaps used by W16**

| Qualification | Measured from | Minimum |
|---|---|---|
| PG Degree (MD / MS / DNB / MDS / AYUSH MD-MS) | UG | 3 years |
| PG Diploma | UG | 2 years |
| DNB (Post-Diploma) | PG Diploma | 2 years |
| Super Speciality (DM / MCh / DrNB) | PG Degree | 3 years |
| 6-year MCh | MBBS | 6 years |
| Post-Doctoral (PDCC / PDF) | Super Speciality | 1 year |
| FNB | PG Degree | 2 years |
| PhD | PG Degree or Medical MSc | 3 years |
| FMGE / NExT | Foreign medical degree | 0 years (not before the degree) |

## 5. Saving with warnings

| # | Rule |
|---|---|
| C1 | First Save with unresolved warnings does not save. It shows a summary of all warnings above the buttons, with a **Review** button. |
| C2 | The button changes to **Save Anyway**; the next click saves. |
| C3 | Any edit that changes the warnings resets the confirmation. |
| C4 | No warnings → Save works as normal. |

## 6. University / Medical College field

| # | Rule |
|---|---|
| U1 | Type-ahead over 857 official colleges: 834 NMC MBBS colleges + AIIMS (20), JIPMER (2), PGIMER Chandigarh |
| U2 | Search: exact → starts with → word starts with → contains → initials ("kgmu") → state → every word ("aiims delhi"); max 25 results; starts at 2 characters |
| U3 | Colleges of the degree's system of medicine are ranked first |
| U4 | **International Qualifications:** plain text, no Indian college list (e.g. "Kazan State Medical University, Russia") |
| U5 | **Fellowship & Certification / Certificate Courses:** label changes to **"Awarding Body / Institute"**, plain text |
| U6 | A college that isn't listed can always be typed and saved |
| U7 | Allowed characters: letters, spaces and `. , & ' ( ) -` |

## 7. Not included (decided)

- **Admission-year rules** (sheet Y03–Y07): need a database change, which was skipped.
- **Feeder groups for DM Critical Care and DM Medical Oncology:** the sheet lists no feeder PGs, so these are not checked.
- **Dental, AYUSH and Homoeopathy college lists:** pending manual export from DCI, NCISM and NCH.
- **UG Pursuing / Intern:** removed (see section 2).

## 8. Where the code lives

| Area | Backend (`Medi_Arogya_BE`) | Frontend (`Medi_Arogya_FE`) |
|---|---|---|
| Categories, degrees, old names (S1–S4) | `src/utils/qualificationCatalog.ts`, `GET /api/v1/doctor/qualifications` | `src/hooks/useQualificationCatalog.ts` |
| Warnings (W1–W16) | — | `src/utils/qualificationWarnings.ts`, `src/hooks/useQualificationWarnings.ts`, `src/components/shared/QualificationRuleWarnings.tsx` |
| Picker suggestions (P1–P6), institute field (U4–U5) | — | `src/utils/qualificationSuggestions.ts`, `src/components/shared/SuggestedDegreeTag.tsx` |
| Save confirmation (C1–C4) | — | `src/components/shared/QualificationWarningsSummary.tsx` |
| Colleges (S5, U1–U3, U6–U7) | `src/utils/collegeCatalog.ts`, `GET /api/v1/doctor/colleges` | `src/components/shared/CollegeAutocomplete.tsx` |
| Qualification row (one component for Onboarding and Edit Profile) | `src/main/doctor/schemas/doctor.schemas.ts` (validation) | `src/components/shared/QualificationItemRow.tsx`, helpers in `src/utils/qualificationForm.ts` |

## 9. Work experience and languages spoken

Edit Profile only (not onboarding); saved directly with the rest of the profile.

| # | Rule |
|---|---|
| E1 | Hospital / Clinic required (max 150), Role required (max 100), City optional (max 100) |
| E2 | From month and year required; To month and year required unless **Currently working here** |
| E3 | To must not be before From; years 1950 to the current year |
| E4 | At most 15 rows; the whole list is replaced on save (rows left out are removed) |
| L1 | Languages Spoken: up to 8, saved as language codes (`en`, `hi`, `mr`): the same list and codes as the prescription language setting |
| L2 | Public profile: "Speaks: …" in the header and Languages in the at-a-glance list; Experience timeline after Education, newest first (current role on top) |

**API** (`PUT /api/v1/doctor/`, read back from `GET /doctor/user` → `doctorProfile`, the clinic profile and the public profile):

```json
{
  "doctorProfile": { "languagesSpoken": ["en", "hi"] },
  "experiences": [
    { "organisation": "Apollo Hospitals", "role": "Consultant Cardiologist", "city": "Chennai",
      "startMonth": 6, "startYear": 2016, "endMonth": 3, "endYear": 2021, "isCurrent": false },
    { "organisation": "AIIMS", "role": "Senior Resident", "startMonth": 4, "startYear": 2021, "isCurrent": true }
  ]
}
```

| Area | Backend | Frontend |
|---|---|---|
| Model | `user_professionals.languages_spoken`, table `doctor_experiences` | — |
| Validation | `src/utils/indianLanguages.ts` (shared with prescriptions), `doctorExperienceSchema` in `doctor.schemas.ts` | `src/constants/prescriptionLanguages.ts`, `pages/profile/components/WorkExperienceRow.tsx` |
| Save | `DoctorServices.updateDoctorProfile` → `replaceExperiences` | `ProfileUpdateRequestModal.tsx`, `src/utils/workExperience.ts` |
| Public profile | `doctorPublicProfile.utils.ts` allow-list | `CredentialsSection.tsx`, `DoctorHero.tsx` |
