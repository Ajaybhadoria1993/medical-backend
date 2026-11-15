import { z } from 'zod';

export interface SpecialtyGroup {
  mainSpecialty: string;
  specialties: readonly string[];
  alsoPractises: readonly string[];
}

/** The doctor speciality catalog, served by `GET /api/v1/doctor/specialties`.
 *  A main speciality never appears in its own `specialties` or `alsoPractises`. */
export const SPECIALTY_CATALOG: readonly SpecialtyGroup[] = [
  {
    mainSpecialty: 'Cardiologist',
    specialties: [
      'Interventional Cardiologist',
      'Cardiac Electrophysiologist',
      'Pediatric Cardiologist',
      'Cardiothoracic Surgeon',
    ],
    alsoPractises: [
      'General Physician',
      'Intensivist (Critical Care)',
      'Vascular Specialist',
    ],
  },
  {
    mainSpecialty: 'General Physician',
    specialties: [
      'General Practitioner',
      'Family Medicine Physician',
      'Internal Medicine Specialist',
      'Infectious Disease Specialist',
    ],
    alsoPractises: [
      'Diabetologist',
      'Thyroid Specialist',
      'Geriatrician',
      'Chest Specialist',
    ],
  },
  {
    mainSpecialty: 'Emergency Medicine Specialist',
    specialties: ['Intensivist (Critical Care)'],
    alsoPractises: ['General Physician'],
  },
  {
    mainSpecialty: 'Anesthesiologist',
    specialties: ['Pain Management Specialist'],
    alsoPractises: ['General Physician', 'Intensivist (Critical Care)'],
  },
  {
    mainSpecialty: 'General Surgeon',
    specialties: [
      'Laparoscopic Surgeon',
      'Bariatric Surgeon',
      'Colorectal Surgeon',
      'Proctologist',
      'Gastrointestinal Surgeon',
      'Pediatric Surgeon',
    ],
    alsoPractises: [
      'General Physician',
      'Vascular Surgeon',
      'Surgical Oncologist',
    ],
  },
  {
    mainSpecialty: 'ENT Specialist',
    specialties: ['ENT Surgeon', 'Head and Neck Surgeon'],
    alsoPractises: [
      'General Physician',
      'Allergist',
      'Sleep Medicine Specialist',
      'Audiologist',
    ],
  },
  {
    mainSpecialty: 'Orthopedic Doctor',
    specialties: [
      'Orthopedic Surgeon',
      'Joint Replacement Surgeon',
      'Spine Specialist',
      'Sports Medicine Specialist',
    ],
    alsoPractises: ['General Physician', 'Pain Management Specialist'],
  },
  {
    mainSpecialty: 'Rheumatologist',
    specialties: [],
    alsoPractises: [
      'General Physician',
      'Immunologist',
      'Pain Management Specialist',
    ],
  },
  {
    mainSpecialty: 'Urologist',
    specialties: ['Urologic Surgeon', 'Andrologist', 'Uro-Oncologist'],
    alsoPractises: ['General Physician', 'Fertility Specialist'],
  },
  {
    mainSpecialty: 'Vascular Specialist',
    specialties: ['Vascular Surgeon'],
    alsoPractises: ['General Physician'],
  },
  {
    mainSpecialty: 'Endocrinologist',
    specialties: ['Diabetologist', 'Thyroid Specialist'],
    alsoPractises: ['General Physician', 'Fertility Specialist'],
  },
  {
    mainSpecialty: 'Gastroenterologist',
    specialties: ['Hepatologist'],
    alsoPractises: ['General Physician', 'Proctologist'],
  },
  {
    mainSpecialty: 'Pulmonologist',
    specialties: ['Chest Specialist', 'Sleep Medicine Specialist'],
    alsoPractises: [
      'General Physician',
      'Allergist',
      'Intensivist (Critical Care)',
      'Infectious Disease Specialist',
    ],
  },
  {
    mainSpecialty: 'Oncologist',
    specialties: [
      'Medical Oncologist',
      'Surgical Oncologist',
      'Radiation Oncologist',
      'Hemato-Oncologist',
    ],
    alsoPractises: [
      'General Physician',
      'Hematologist',
      'Pain Management Specialist',
    ],
  },
  {
    mainSpecialty: 'Dermatologist',
    specialties: ['Trichologist', 'Cosmetologist', 'Venereologist'],
    alsoPractises: [
      'General Physician',
      'Allergist',
      'Hair Transplant Surgeon',
    ],
  },
  {
    mainSpecialty: 'Gynecologist',
    specialties: [
      'Obstetrician',
      'Laparoscopic Gynecologist',
      'Maternal-Fetal Medicine Specialist',
    ],
    alsoPractises: [
      'General Physician',
      'Fertility Specialist',
      'IVF Specialist',
    ],
  },
  {
    mainSpecialty: 'Fertility Specialist',
    specialties: ['IVF Specialist', 'Reproductive Endocrinologist'],
    alsoPractises: ['General Physician', 'Gynecologist', 'Andrologist'],
  },
  {
    mainSpecialty: 'Dentist',
    specialties: [
      'Endodontist',
      'Orthodontist',
      'Periodontist',
      'Prosthodontist',
      'Pediatric Dentist (Pedodontist)',
      'Implantologist',
      'Oral and Maxillofacial Surgeon',
    ],
    alsoPractises: [],
  },
  {
    mainSpecialty: 'Plastic Surgeon',
    specialties: [
      'Cosmetic Surgeon',
      'Reconstructive Surgeon',
      'Hair Transplant Surgeon',
    ],
    alsoPractises: ['General Physician', 'Cosmetologist'],
  },
  {
    mainSpecialty: 'Psychiatrist',
    specialties: [
      'Child and Adolescent Psychiatrist',
      'Addiction Psychiatrist (De-addiction)',
    ],
    alsoPractises: [
      'General Physician',
      'Counsellor',
      'Sleep Medicine Specialist',
    ],
  },
  {
    mainSpecialty: 'Psychologist',
    specialties: ['Clinical Psychologist', 'Counsellor'],
    alsoPractises: [],
  },
  {
    mainSpecialty: 'Geriatrician',
    specialties: [],
    alsoPractises: ['General Physician'],
  },
  {
    mainSpecialty: 'Hematologist',
    specialties: [],
    alsoPractises: ['General Physician', 'Hemato-Oncologist'],
  },
  {
    mainSpecialty: 'Immunologist',
    specialties: ['Allergist'],
    alsoPractises: ['General Physician', 'Rheumatologist'],
  },
  {
    mainSpecialty: 'Nephrologist',
    specialties: [],
    alsoPractises: ['General Physician'],
  },
  {
    mainSpecialty: 'Neurologist',
    specialties: ['Neurosurgeon'],
    alsoPractises: [
      'General Physician',
      'Spine Specialist',
      'Pain Management Specialist',
      'Sleep Medicine Specialist',
    ],
  },
  {
    mainSpecialty: 'Ophthalmologist',
    specialties: [
      'Retina Specialist',
      'Cataract and Refractive (LASIK) Surgeon',
      'Optometrist',
    ],
    alsoPractises: ['General Physician'],
  },
  {
    mainSpecialty: 'Pediatrician',
    specialties: ['Neonatologist'],
    alsoPractises: ['General Physician', 'Allergist'],
  },
  {
    mainSpecialty: 'Physiotherapist',
    specialties: [
      'Occupational Therapist',
      'Sports Physiotherapist',
      'Neuro Physiotherapist',
      'Orthopedic Physiotherapist',
    ],
    alsoPractises: [],
  },
  {
    mainSpecialty: 'Speech Therapist',
    specialties: ['Audiologist'],
    alsoPractises: [],
  },
  {
    mainSpecialty: 'Dietitian / Nutritionist',
    specialties: ['Dietitian', 'Nutritionist'],
    alsoPractises: [],
  },
  {
    mainSpecialty: 'Ayurvedic Doctor',
    specialties: [
      'Panchakarma Specialist',
      'Ayurvedic Physician (Kayachikitsa)',
    ],
    alsoPractises: [],
  },
  {
    mainSpecialty: 'Homeopathic Doctor',
    specialties: [],
    alsoPractises: [],
  },
];

/** Per group: at most 5 sub-specialties and 5 "also practises". */
export const MAX_SPECIALIZATIONS_PER_GROUP = 5;
export const MAX_CUSTOM_SPECIALIZATION_LENGTH = 50;

const groupByMain = new Map(
  SPECIALTY_CATALOG.map((g) => [g.mainSpecialty.toLowerCase(), g])
);

// Every catalog name keyed by lower case, so input is saved in the catalog's spelling.
const canonicalName = new Map(
  SPECIALTY_CATALOG.flatMap((g) =>
    [g.mainSpecialty, ...g.specialties, ...g.alsoPractises].map((n) => [
      n.toLowerCase(),
      n,
    ])
  )
);

export function findSpecialtyGroup(main?: string | null) {
  return main ? groupByMain.get(main.trim().toLowerCase()) : undefined;
}

/** Custom entries count as sub-specialties; the main speciality itself is not counted. */
export function splitSpecializations(
  main: string | null | undefined,
  list: readonly string[]
) {
  const group = findSpecialtyGroup(main);
  const also = new Set(group?.alsoPractises.map((n) => n.toLowerCase()));
  const own = main?.trim().toLowerCase();
  const items = list.filter((n) => n.toLowerCase() !== own);
  return {
    subSpecialties: items.filter((n) => !also.has(n.toLowerCase())),
    alsoPractises: items.filter((n) => also.has(n.toLowerCase())),
  };
}

/** A main speciality from the catalog, saved in its spelling; '' passes through unchanged. */
export const specialitySchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (!value) return value;
    const group = findSpecialtyGroup(value);
    if (!group) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select a speciality from the list',
      });
      return z.NEVER;
    }
    return group.mainSpecialty;
  });

export const specializationSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(
        MAX_CUSTOM_SPECIALIZATION_LENGTH,
        `Each specialization can be at most ${MAX_CUSTOM_SPECIALIZATION_LENGTH} characters`
      )
  )
  .max(MAX_SPECIALIZATIONS_PER_GROUP * 2)
  .transform((list) => {
    const seen = new Set<string>();
    return list
      .map(
        (n) =>
          canonicalName.get(n.toLowerCase()) ??
          n
            .replace(/\s+/g, ' ')
            .replace(/(^|\s)(\S)/g, (_, s, c) => s + c.toUpperCase())
      )
      .filter((n) => {
        const key = n.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });

/** Per-group caps need the main speciality; without it only the schema's total cap applies. */
export function checkSpecializationLimits(
  data: { speciality?: string | null; specialization?: string[] },
  ctx: z.RefinementCtx,
  path: (string | number)[] = []
) {
  if (!data.specialization || !data.speciality) return;
  const { subSpecialties, alsoPractises } = splitSpecializations(
    data.speciality,
    data.specialization
  );
  const max = MAX_SPECIALIZATIONS_PER_GROUP;
  if (subSpecialties.length > max) {
    ctx.addIssue({
      code: 'custom',
      message: `Pick at most ${max} sub-specialties`,
      path: [...path, 'specialization'],
    });
  }
  if (alsoPractises.length > max) {
    ctx.addIssue({
      code: 'custom',
      message: `Pick at most ${max} "also practises" fields`,
      path: [...path, 'specialization'],
    });
  }
}
