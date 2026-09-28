import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabResultService } from '../services/labResult.service';
import { LabService } from '../services/lab.service';

export const createLabController = asyncHandler(
  async (req: Request, res: Response) => {
    const lab = await LabService.createLab(
      req.validatedBody ?? req.body,
      req.clinicId,
      req.user.id
    );
    sendCreated(res, 'Lab created successfully', lab);
  }
);

export const updateLabController = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const lab = await LabService.updateLab(
      id,
      req.validatedBody ?? req.body,
      req.user.id,
      req.clinicId
    );
    sendOk(res, 'Lab updated successfully', lab);
  }
);

export const getDepartmentsController = asyncHandler(
  async (_req: Request, res: Response) => {
    const departments = await LabService.getDepartments();
    sendOk(res, 'Departments fetched successfully', departments);
  }
);

export const createDepartmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const department = await LabService.createDepartment(
      req.user.id,
      req.clinicId,
      req.validatedBody.name,
      {
        labId: req.labId,
        userRole: req.user.userType,
      }
    );
    sendCreated(res, 'Department added successfully', department);
  }
);

export const getLabCatalogForAdminController = asyncHandler(
  async (req: Request, res: Response) => {
    const { labId } = req.validatedParams;
    const tests = await LabService.getLabCatalogForAdmin(labId, req.clinicId);
    sendOk(res, 'Lab catalog fetched successfully', tests);
  }
);

export const getMyLabCatalogController = asyncHandler(
  async (req: Request, res: Response) => {
    const { tests, pagination } = await LabService.getMyLabCatalog(
      req.user.id,
      req.clinicId,
      req.validatedQuery ?? req.query,
      {
        labId: req.labId,
        userRole: req.user.userType,
      }
    );
    res.status(200).json({
      success: true,
      message: 'Lab catalog fetched successfully',
      data: tests,
      pagination,
    });
  }
);

export const addMyLabTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const test = await LabService.addCustomLabTestByAssistant(
      req.user.id,
      req.clinicId,
      req.validatedBody,
      {
        labId: req.labId,
        userRole: req.user.userType,
      }
    );
    sendCreated(res, 'Lab test added successfully', test);
  }
);

export const updateLabCatalogTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const { testId } = req.validatedParams;
    const test = await LabService.updateLabCatalogTest(
      testId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );
    sendOk(res, 'Lab test updated successfully', test);
  }
);

export const getLabCatalogTestCustomFieldsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { testId } = req.validatedParams;
    const fields = await LabService.getLabCatalogTestCustomFields(testId, {
      clinicId: req.clinicId,
      userId: req.user.id,
      userRole: req.user.userType,
    });
    sendOk(res, 'Lab test result fields fetched successfully', fields);
  }
);

export const deactivateLabCatalogTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const { testId } = req.validatedParams;
    const test = await LabService.deactivateLabCatalogTest(testId, {
      clinicId: req.clinicId,
      userId: req.user.id,
      userRole: req.user.userType,
    });
    sendOk(res, 'Lab test deactivated successfully', test);
  }
);

export const getLabByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const lab = await LabService.getLabById(id, req.clinicId);
    sendOk(res, 'Lab fetched successfully', lab);
  }
);

export const getLabsByClinicIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.params.clinicId as string;
    const { labs, pagination } = await LabService.getLabsByClinicId(clinicId);
    res.status(200).json({
      success: true,
      message: 'Labs fetched successfully',
      data: labs,
      pagination,
    });
  }
);

export const getTestsByLabAssistantController = asyncHandler(
  async (req: Request, res: Response) => {
    const labAssistent = req.params.labAssistent as string;
    const tests =
      await LabService.getTestsByLabAssistantController(labAssistent);
    sendOk(res, 'Tests fetched successfully', tests);
  }
);

export const getTestsByLabAssistantIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const labId = req.params.labId as string;
    const tests = await LabService.getTestsByLabId(labId);
    sendOk(res, 'Tests fetched successfully', tests);
  }
);

export const getUsersByLabIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const labId = req.params.labId as string;
    const users = await LabService.getUsersByLabId(labId);
    sendOk(res, 'Users fetched successfully', users);
  }
);

export const getDetailsBylabAssistent = asyncHandler(
  async (req: Request, res: Response) => {
    const labAssistent = req.params.labAssistent as string;
    const details = await LabService.getdetailsBylabAssistent(labAssistent);
    sendOk(res, 'Details fetched successfully', details);
  }
);

export const getActiveReportTemplatesController = asyncHandler(
  async (req: Request, res: Response) => {
    const templates = await LabResultService.getActiveReportTemplates({
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
      userRole: req.user.userType,
    });
    sendOk(res, 'Report templates fetched successfully', templates);
  }
);

export const getManageableTemplateParametersController = asyncHandler(
  async (req: Request, res: Response) => {
    const { templateId } = req.validatedParams;
    const result = await LabResultService.getManageableTemplateParameters(
      templateId,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Template parameters fetched successfully', result);
  }
);

export const getResultTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const { labOrderId } = req.validatedParams;
    const result = await LabResultService.getResultTemplate(labOrderId, {
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
      userRole: req.user.userType,
    });

    sendOk(res, 'Result template fetched successfully', result);
  }
);

export const saveLabResultController = asyncHandler(
  async (req: Request, res: Response) => {
    const { labOrderId } = req.validatedParams;
    const result = await LabResultService.saveResult(
      labOrderId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendCreated(res, 'Lab result saved successfully', result);
  }
);

export const addLabCustomFieldController = asyncHandler(
  async (req: Request, res: Response) => {
    const { templateId } = req.validatedParams;
    const result = await LabResultService.addCustomField(
      templateId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendCreated(res, 'Custom field added successfully', result);
  }
);

export const updateLabCustomFieldController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fieldId } = req.validatedParams;
    const result = await LabResultService.updateCustomField(
      fieldId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Custom field updated successfully', result);
  }
);

export const deleteLabCustomFieldController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fieldId } = req.validatedParams;
    const result = await LabResultService.deleteCustomField(fieldId, {
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
      userRole: req.user.userType,
    });

    sendOk(res, 'Custom field deleted successfully', result);
  }
);

export const overrideLabDefaultFieldController = asyncHandler(
  async (req: Request, res: Response) => {
    const { parameterId } = req.validatedParams;
    const result = await LabResultService.overrideDefaultField(
      parameterId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Default field override saved successfully', result);
  }
);

export const hideLabDefaultFieldController = asyncHandler(
  async (req: Request, res: Response) => {
    const { parameterId } = req.validatedParams;
    const result = await LabResultService.hideDefaultField(
      parameterId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Default field visibility updated successfully', result);
  }
);

export const unhideLabDefaultFieldController = asyncHandler(
  async (req: Request, res: Response) => {
    const { parameterId } = req.validatedParams;
    const result = await LabResultService.unhideDefaultField(
      parameterId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Default field unhidden successfully', result);
  }
);

export const resetLabDefaultFieldOverrideController = asyncHandler(
  async (req: Request, res: Response) => {
    const { parameterId } = req.validatedParams;
    const result = await LabResultService.resetDefaultFieldOverride(
      parameterId,
      req.validatedBody ?? {},
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Default field override reset successfully', result);
  }
);

export const getSavedLabResultController = asyncHandler(
  async (req: Request, res: Response) => {
    const { resultId } = req.validatedParams;
    const result = await LabResultService.getSavedResult(resultId, {
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
      userRole: req.user.userType,
    });

    sendOk(res, 'Lab result fetched successfully', result);
  }
);

export const updateLabResultController = asyncHandler(
  async (req: Request, res: Response) => {
    const { resultId } = req.validatedParams;
    const result = await LabResultService.updateResult(
      resultId,
      req.validatedBody,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Lab result updated successfully', result);
  }
);

export const verifyLabResultController = asyncHandler(
  async (req: Request, res: Response) => {
    const { resultId } = req.validatedParams;
    const result = await LabResultService.verifyResult(resultId, {
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
      userRole: req.user.userType,
    });

    sendOk(res, 'Lab result verified successfully', result);
  }
);

export const getLabResultReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const { resultId } = req.validatedParams;
    const result = await LabResultService.getReport(resultId, {
      clinicId: req.clinicId,
      labId: req.labId,
      userId: req.user.id,
      userRole: req.user.userType,
    });

    sendOk(res, 'Lab report fetched successfully', result);
  }
);

export const uploadLabResultReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const { resultId } = req.validatedParams;
    const reportFileUrl = (req.file as { location?: string } | undefined)
      ?.location;
    const result = await LabResultService.uploadReportFile(
      resultId,
      reportFileUrl,
      {
        clinicId: req.clinicId,
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Lab report file uploaded successfully', result);
  }
);

export const getLabDepartmentsByLabIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const labId = req.params.labId as string;
    const departments = await LabService.getLabDepartmentsByLabId(
      labId,
      req.clinicId
    );
    sendOk(res, 'Lab departments fetched successfully', departments);
  }
);

export const updateLabDepartmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const labId = req.params.labId as string;
    const body = req.validatedBody ?? req.body;
    const departments = await LabService.updateLabDepartments(
      labId,
      body.departmentIds,
      body.departmentTestIds,
      req.clinicId
    );
    sendOk(res, 'Lab departments updated successfully', departments);
  }
);

export const syncLabCatalogController = asyncHandler(
  async (req: Request, res: Response) => {
    const labId = req.params.labId as string;
    const catalog = await LabService.syncLabCatalogPublic(labId, req.clinicId);
    sendOk(res, 'Lab catalog synced successfully', catalog);
  }
);
