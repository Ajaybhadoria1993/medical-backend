import { z } from 'zod';

const optionalTextField = (max: number) =>
  z.string().trim().max(max).optional();

export const createPharmacySchema = z.object({
  name: z.string().min(2),
  contactNumber: z.string().min(5),
  address: z.string().min(3),
  registrationNumber: optionalTextField(30),
  gstNumber: optionalTextField(20),
  panNumber: optionalTextField(10),
  licenseNumber: optionalTextField(30),
  fssaiNumber: optionalTextField(20),
});

export const assignPharmacyUserSchema = z.object({
  pharmacyId: z.string().uuid(),
  userId: z.string().uuid(),
  userRole: z.string().optional(),
});
export const updatePharmacySchema = z
  .object({
    name: z.string().min(2).optional(),
    contactNumber: z.string().min(5).optional(),
    address: z.string().min(3).optional(),
    registrationNumber: optionalTextField(30),
    gstNumber: optionalTextField(20),
    panNumber: optionalTextField(10),
    licenseNumber: optionalTextField(30),
    fssaiNumber: optionalTextField(20),
    status: z.enum(['active', 'deactive']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });
export const createPharmacyUserSchema = z.object({
  pharmacyId: z.string().uuid(),
  user: z.object({
    name: z.string().min(2),
    email: z.string().email().min(10).max(80),
    mobile: z.string().optional(),
    gender: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
  }),
});

// Body only schema for creating a pharmacy member via route param `:pharmacyId`
export const createPharmacyMemberSchema = z.object({
  name: z.string().min(2),
  contactNumber: z.string().min(5),
  email: z.string().email().min(10).max(80),
});

export const getPharmacyByIdParamsSchema = z.object({
  pharmacyId: z.string().uuid(),
});

export const getPharmacyUsersQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
});

export const getPharmaciesQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
});

export const updatePharmacyStatusSchema = z.object({
  status: z.enum(['active', 'deactive']),
});

export type UpdatePharmacyInput = z.infer<typeof updatePharmacySchema>;
