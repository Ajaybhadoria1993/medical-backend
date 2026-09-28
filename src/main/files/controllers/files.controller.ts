import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import {
  readClinicDocument,
  signClinicDocument,
  signPatientDocument,
} from '../services/fileAccess.service';
import { attachmentDisposition } from '../utils/s3Ref.utils';
import type {
  DownloadDocumentQuery,
  SignDocumentQuery,
  SignPatientDocumentQuery,
} from '../schemas/files.schema';

export const signDocumentController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) throw new HttpError(403, 'No clinic selected for this user');

    const query = req.validatedQuery as SignDocumentQuery;
    const result = await signClinicDocument(query, clinicId);

    return sendOk(res, 'Signed URL generated', result);
  }
);

export const downloadDocumentController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    if (!clinicId) throw new HttpError(403, 'No clinic selected for this user');

    const query = req.validatedQuery as DownloadDocumentQuery;
    const file = await readClinicDocument(query, clinicId);

    // A binary body, so the JSON envelope helpers don't apply.
    res.setHeader('Content-Disposition', attachmentDisposition(file.fileName));
    res.type(file.contentType).send(file.bytes);
  }
);

export const signPatientDocumentController = asyncHandler(
  async (req: Request, res: Response) => {
    const patientId = req.user?.id;
    if (!patientId) throw new HttpError(401, 'Authentication required');

    const query = req.validatedQuery as SignPatientDocumentQuery;
    const result = await signPatientDocument(query, patientId);

    return sendOk(res, 'Signed URL generated', result);
  }
);
