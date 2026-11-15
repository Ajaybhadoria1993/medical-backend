import { Request } from 'express';

export const getLabControllerContext = (req: Request) => ({
  labId: req.labId,
  userId: req.user.id,
  userRole: req.user.userType,
});
