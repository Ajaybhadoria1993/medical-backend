import { LabUpdatedActivityModel } from '../models/labUpdated.model';
import type { DbTransaction } from '../services/labCatalog.service';

export type LabOrderActivityInput = {
  labId: string;
  labOrderId: string;
  activity: string;
  performedBy: string;
  createdAt?: Date;
};

export const logLabOrderActivity = async (
  trx: DbTransaction,
  activity: LabOrderActivityInput
) => {
  await trx.insert(LabUpdatedActivityModel).values({
    labId: activity.labId,
    labOrderId: activity.labOrderId,
    activity: activity.activity,
    performedBy: activity.performedBy,
    createdAt: activity.createdAt ?? new Date(),
  });
};
