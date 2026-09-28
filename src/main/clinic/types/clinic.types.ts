import { InferSelectModel } from 'drizzle-orm';
import { UserModel } from '../../users/models/user.model';
import {
  ClinicAssignModel,
  ClinicAvailability,
  ClinicModel,
  ClinicServiceModel,
} from '../models/clinic.model';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import { LabsModel } from '../../lab/models/lab.model';

export type ClinicRow = InferSelectModel<typeof ClinicModel>;
export type ClinicServiceRow = InferSelectModel<typeof ClinicServiceModel>;
export type ClinicAvailabilityRow = InferSelectModel<typeof ClinicAvailability>;
export type UserRow = InferSelectModel<typeof UserModel>;
export type ClinicAssignRow = InferSelectModel<typeof ClinicAssignModel>;
export type PharmacyRow = InferSelectModel<typeof PharmacyModel>;
export type LabRow = InferSelectModel<typeof LabsModel>;

export type FullClinicResponse = {
  clinic: ClinicRow;
  profile:
    | (Omit<UserRow, 'password' | 'passwordChangedAt'> & Record<string, any>)
    | null;
  subscription?: {
    planName: string;
    price: string;
    slug: string;
    expiresAt: Date | null;
    active: boolean;
  };
  subscriptionHistory?: any[];
  counts?: {
    totalUsers: number;
    totalPharmacies: number;
    totalLabs: number;
  };
  users?: UserRow[];
  pharmacies?: PharmacyRow[];
  labs?: LabRow[];
  payments?: any[];
};

export type ClinicServiceInput = {
  id?: string;
  serviceName?: string;
  price?: number;
  currency?: 'INR' | 'USD' | 'EUR';
  additionalServices?: string;
};
