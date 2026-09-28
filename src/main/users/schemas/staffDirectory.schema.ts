import { z } from 'zod';

export const staffDirectoryQuerySchema = z.object({
  role: z.enum([
    'Doctor',
    'Receptionist',
    'Nurse',
    'Lab_Assistant',
    'Pharmacist',
  ]),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().optional(),
  // Constrained to the user_status enum so an unknown value is a 400 here
  // rather than a type error deeper in the query.
  status: z
    .enum([
      'Active',
      'Inactive',
      'Blocked',
      'New',
      'Pending',
      'Reviewing',
      'Rejected',
    ])
    .optional(),
  speciality: z.string().trim().optional(),
  assignedDoctorId: z.string().uuid().optional(),
  location: z.string().trim().optional(),
  labId: z.string().uuid().optional(),
  pharmacyId: z.string().uuid().optional(),
});

export type StaffDirectoryQueryDto = z.infer<typeof staffDirectoryQuerySchema>;
