import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  ne,
  or,
  sql,
  notInArray,
  ilike,
} from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import {
  buildPaginationMeta,
  getOffsetPagination,
  getTotalCount,
  buildSearchCondition,
} from '../../../utils/queryHelpers';
import { seedLabDepartmentCatalog } from '../../../drizzle/seeds/labDepartmentCatalog.seed';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { LabTestCatalogModel } from '../../test/models/labTestCatalog.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { LimitationService } from '../../subscription/services/limitation.service';
import {
  LabDepartmentsMasterModel,
  LabsModel,
  UserLabAssignmentsModel,
  LabDepartmentsModel,
} from '../models/lab.model';
import {
  LabReportTemplateParametersModel,
  LabReportTemplatesModel,
} from '../models/labResult.model';
import type {
  AddLabCustomFieldInput,
  LabCustomFieldSyncInput,
} from '../schemas/lab.schemas';
import { LabResultService } from './labResult.service';

export const DEPARTMENT_TEMPLATES_MAP: Record<string, string[]> = {
  HEMATOLOGY: ['CBC', 'HEMOGLOBIN', 'TLC', 'DLC', 'PLATELET_COUNT', 'ESR'],
  BIOCHEMISTRY: [
    'BLOOD_SUGAR',
    'LFT',
    'KFT',
    'LIPID_PROFILE',
    'URIC_ACID',
    'CREATININE',
  ],
  CLINICAL_PATHOLOGY: ['URINE_ROUTINE', 'STOOL_ROUTINE', 'PREGNANCY_TEST'],
  MICROBIOLOGY: ['BLOOD_CULTURE', 'URINE_CULTURE', 'SPUTUM_CULTURE'],
  SEROLOGY_IMMUNOLOGY: [
    'HIV',
    'HBSAG',
    'DENGUE',
    'TYPHOID',
    'CRP',
    'RA_FACTOR',
  ],
  COAGULATION: ['PT_INR', 'APTT', 'BLEEDING_TIME', 'CLOTTING_TIME'],
  PARASITOLOGY: ['MALARIA', 'STOOL_PARASITE'],
  HISTOPATHOLOGY: ['BIOPSY', 'FNAC'],
  CYTOLOGY: ['PAP_SMEAR', 'FLUID_CYTOLOGY'],
  MOLECULAR_DIAGNOSTICS: ['RT_PCR', 'HPV_DNA'],
  BLOOD_BANK: ['BLOOD_GROUPING', 'CROSS_MATCH'],
};

interface PaginationQueryDto {
  pageNumber?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type ReportTemplate = typeof LabReportTemplatesModel.$inferSelect;

type LabStatus = 'Active' | 'Inactive' | 'Blocked' | 'New';
type LabCatalogStatus = 'active' | 'inactive' | 'deactive';
type DepartmentTestSelection = Record<string, string[]>;

type CreateLabPayload = {
  clinicId?: string;
  name?: string;
  labName?: string;
  address: string;
  contactNo?: string;
  phone?: string;
  email?: string | null;
  logo?: string | null;
  gstNumber?: string | null;
  reportFooter?: string | null;
  labStatus?: LabStatus;
  departmentIds?: string[];
};

type UpdateLabPayload = Partial<{
  name: string;
  labName: string;
  address: string;
  contactNo: string;
  phone: string;
  email: string;
  logo: string | null;
  gstNumber: string | null;
  reportFooter: string | null;
  labStatus: LabStatus;
  departmentIds: string[];
}>;

type CreateCustomLabTestPayload = {
  departmentId: string;
  testName: string;
  testCode?: string | null;
  sampleType: string;
  price: number;
  status?: LabCatalogStatus;
  masterTestId?: string | null;
  customFields?: AddLabCustomFieldInput[];
};

type LabPanelContext = {
  labId?: string;
  userRole?: string;
};

type UpdateLabCatalogTestPayload = Partial<{
  departmentId: string;
  testName: string;
  testCode: string | null;
  sampleType: string;
  price: number;
  status: LabCatalogStatus;
  masterTestId?: string | null;
}>;

function normalizeCatalogStatus(status?: LabCatalogStatus) {
  if (!status) return 'active';
  return status === 'deactive' ? 'inactive' : status;
}

function normalizeReportTemplateCode(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

function buildCustomReportTemplateCode(testName: string) {
  const normalizedName =
    normalizeReportTemplateCode(testName).replace(/_/g, '') || 'TEST';

  return `CUSTOM_${normalizedName}`.slice(0, 50);
}

function attachReportTemplateToTest<
  T extends typeof LabTestCatalogModel.$inferSelect,
>(test: T, template: ReportTemplate) {
  return {
    ...test,
    templateId: template.id,
    reportTemplateId: template.id,
    resultTemplateId: template.id,
    reportTemplate: {
      id: template.id,
      name: template.name,
      code: template.code,
      sampleType: template.sampleType,
    },
  };
}

function uniqueIds(ids: string[] = []) {
  return Array.from(new Set(ids));
}

function normalizeDepartmentTestSelection(
  departmentTestIds?: DepartmentTestSelection
) {
  if (!departmentTestIds) return undefined;

  return Object.fromEntries(
    Object.entries(departmentTestIds).map(([departmentId, testIds]) => [
      departmentId,
      uniqueIds(testIds),
    ])
  );
}

export const DEPARTMENT_CODES = [
  'HEMATOLOGY',
  'BIOCHEMISTRY',
  'CLINICAL_PATHOLOGY',
  'MICROBIOLOGY',
  'SEROLOGY_IMMUNOLOGY',
  'COAGULATION',
  'PARASITOLOGY',
  'HISTOPATHOLOGY',
  'CYTOLOGY',
  'MOLECULAR_DIAGNOSTICS',
  'BLOOD_BANK',
];

function getTemplateCodesForDepartment(departmentCode: string) {
  return DEPARTMENT_TEMPLATES_MAP[departmentCode] || [];
}

// Global catalog departments (lab_id null) plus the custom ones this lab created.
function departmentVisibleToLab(labId: string | null) {
  return or(
    isNull(LabDepartmentsMasterModel.labId),
    labId ? eq(LabDepartmentsMasterModel.labId, labId) : undefined
  );
}

function normalizeLabPayload(payload: CreateLabPayload) {
  return {
    ...payload,
    name: payload.name ?? payload.labName,
    contactNo: payload.contactNo ?? payload.phone,
    departmentIds: uniqueIds(payload.departmentIds),
  };
}

function normalizeLabUpdatePayload(payload: UpdateLabPayload) {
  const updatePayload: Partial<{
    name: string;
    address: string;
    contactNo: string;
    email: string;
    logo: string | null;
    gstNumber: string | null;
    reportFooter: string | null;
    labStatus: LabStatus;
  }> = {};

  const name = payload.name ?? payload.labName;
  const contactNo = payload.contactNo ?? payload.phone;

  if (name !== undefined) updatePayload.name = name;
  if (payload.address !== undefined) updatePayload.address = payload.address;
  if (contactNo !== undefined) updatePayload.contactNo = contactNo;
  if (payload.email !== undefined) updatePayload.email = payload.email;
  if (payload.logo !== undefined) updatePayload.logo = payload.logo;
  if (payload.gstNumber !== undefined) {
    updatePayload.gstNumber = payload.gstNumber;
  }
  if (payload.reportFooter !== undefined) {
    updatePayload.reportFooter = payload.reportFooter;
  }
  if (payload.labStatus !== undefined) {
    updatePayload.labStatus = payload.labStatus;
  }

  return {
    updatePayload,
    departmentIds: payload.departmentIds
      ? uniqueIds(payload.departmentIds)
      : undefined,
  };
}
function mapLabStatusToUserStatus(
  labStatus: LabStatus
): 'Active' | 'Inactive' | 'Blocked' {
  switch (labStatus) {
    case 'Blocked':
      return 'Blocked';
    case 'Inactive':
      return 'Inactive';
    case 'Active':
    case 'New':
    default:
      return 'Active';
  }
}

export class LabService {
  static async createLab(
    payload: CreateLabPayload,
    clinicIdFromRequest?: string,
    adminUserId?: string
  ) {
    const lab = await database.transaction(async (tx) => {
      const normalizedPayload = normalizeLabPayload(payload);
      const clinicId = normalizedPayload.clinicId ?? clinicIdFromRequest;
      if (!clinicId) {
        throw new HttpError(400, 'clinicId is required');
      }

      if (!normalizedPayload.name || !normalizedPayload.contactNo) {
        throw new HttpError(400, 'Lab name and contact number are required');
      }

      const duplicateConditions = [
        eq(LabsModel.contactNo, normalizedPayload.contactNo),
      ];
      if (normalizedPayload.email) {
        duplicateConditions.push(eq(LabsModel.email, normalizedPayload.email));
      }

      const existingLab = await tx
        .select()
        .from(LabsModel)
        .where(or(...duplicateConditions))
        .limit(1);

      if (existingLab.length > 0) {
        throw new HttpError(
          409,
          'Lab already exists with the same contact number or email'
        );
      }

      const [createdLab] = await tx
        .insert(LabsModel)
        .values({
          clinicId,
          name: normalizedPayload.name,
          address: normalizedPayload.address,
          contactNo: normalizedPayload.contactNo,
          email: normalizedPayload.email,
          logo: normalizedPayload.logo,
          gstNumber: normalizedPayload.gstNumber,
          reportFooter: normalizedPayload.reportFooter,
          labStatus: normalizedPayload.labStatus ?? 'New',
        })
        .returning();

      return createdLab;
    });

    // The limits overview counts labs; cleared after commit so it can't re-cache the old count.
    await LimitationService.invalidateClinicCache(lab.clinicId);

    if (lab && adminUserId) {
      setImmediate(async () => {
        try {
          const { ClinicModel } =
            await import('../../clinic/models/clinic.model');
          const { UserModel } = await import('../../users/models/user.model');
          const { sendEmail } = await import('../../../utils/email');
          const { labCreationNotificationTemplate } =
            await import('../../../htmltamplates/labCreationNotification');

          const [clinic] = await database
            .select()
            .from(ClinicModel)
            .where(eq(ClinicModel.id, lab.clinicId))
            .limit(1);

          const [adminUser] = await database
            .select()
            .from(UserModel)
            .where(eq(UserModel.id, adminUserId))
            .limit(1);

          if (adminUser && adminUser.email) {
            await sendEmail(
              adminUser.email,
              `Infinity Medisetu - Lab Created: ${lab.name} at ${clinic?.clinicName || 'Clinic'}`,
              labCreationNotificationTemplate({
                adminName: adminUser.name ?? '',
                labName: lab.name,
                clinicName: clinic?.clinicName || 'Clinic',
                address: lab.address,
                contactNo: lab.contactNo,
                email: lab.email,
              })
            );
          }
        } catch (error) {
          logger.error('Error sending welcome email to lab creator:', error);
        }
      });
    }

    return lab;
  }

  static async updateLab(
    labId: string,
    payload: UpdateLabPayload,
    actorUserId?: string,
    clinicId?: string
  ) {
    return await database.transaction(async (tx) => {
      const { updatePayload } = normalizeLabUpdatePayload(payload);
      // 1️⃣ Check lab exists
      const [existingLab] = await tx
        .select({
          id: LabsModel.id,
          clinicId: LabsModel.clinicId,
          labStatus: LabsModel.labStatus,
        })
        .from(LabsModel)
        .where(eq(LabsModel.id, labId))
        .limit(1);

      if (!existingLab) {
        throw new HttpError(404, 'Lab not found');
      }

      if (clinicId && existingLab.clinicId !== clinicId) {
        throw new HttpError(403, 'Lab does not belong to this clinic');
      }

      // 4️⃣ If labStatus changed → update users linked to this lab

      if (
        updatePayload.labStatus &&
        updatePayload.labStatus !== existingLab.labStatus
      ) {
        // 🔴 When lab becomes Inactive or Blocked
        if (
          updatePayload.labStatus === 'Inactive' ||
          updatePayload.labStatus === 'Blocked'
        ) {
          const labUsers = await tx
            .select({ userId: UserLabAssignmentsModel.userId })
            .from(UserLabAssignmentsModel)
            .where(eq(UserLabAssignmentsModel.labId, labId));

          if (labUsers.length > 0) {
            const userIds = labUsers.map((u) => u.userId);

            await tx
              .update(UserModel)
              .set({
                userStatus: updatePayload.labStatus,
                updatedAt: new Date(),
              })
              .where(inArray(UserModel.id, userIds));
          }
        }

        // 🟢 When lab becomes Active
        if (updatePayload.labStatus === 'Active') {
          const labUsers = await tx
            .select({ userId: UserLabAssignmentsModel.userId })
            .from(UserLabAssignmentsModel)
            .where(eq(UserLabAssignmentsModel.labId, labId));

          if (labUsers.length > 0) {
            const userIds = labUsers.map((u) => u.userId);

            await tx
              .update(UserModel)
              .set({
                userStatus: 'Active',
                updatedAt: new Date(),
              })
              .where(inArray(UserModel.id, userIds));
          }
        }
      }
      // 2️⃣ Duplicate email / contact check
      const duplicateConditions = [];

      if (updatePayload.email) {
        duplicateConditions.push(eq(LabsModel.email, updatePayload.email));
      }

      if (updatePayload.contactNo) {
        duplicateConditions.push(
          eq(LabsModel.contactNo, updatePayload.contactNo)
        );
      }

      if (duplicateConditions.length) {
        const [duplicate] = await tx
          .select({
            id: LabsModel.id,
            email: LabsModel.email,
            contactNo: LabsModel.contactNo,
          })
          .from(LabsModel)
          .where(and(ne(LabsModel.id, labId), or(...duplicateConditions)))
          .limit(1);

        if (duplicate) {
          if (updatePayload.email && duplicate.email === updatePayload.email) {
            throw new HttpError(400, 'Email already in use by another lab');
          }

          if (
            updatePayload.contactNo &&
            duplicate.contactNo === updatePayload.contactNo
          ) {
            throw new HttpError(
              400,
              'Contact number already in use by another lab'
            );
          }
        }
      }

      // 3️⃣ Update lab
      const [updatedLab] = await tx
        .update(LabsModel)
        .set({
          ...updatePayload,
          updatedAt: new Date(),
        })
        .where(eq(LabsModel.id, labId))
        .returning();

      // 4️⃣ 🔥 If labStatus changed → update users linked to this lab
      if (
        updatePayload.labStatus &&
        updatePayload.labStatus !== existingLab.labStatus
      ) {
        const newUserStatus = mapLabStatusToUserStatus(updatePayload.labStatus);

        // get all users assigned to this lab
        const labUsers = await tx
          .select({ userId: UserLabAssignmentsModel.userId })
          .from(UserLabAssignmentsModel)
          .where(eq(UserLabAssignmentsModel.labId, labId));

        if (labUsers.length) {
          const userIds = labUsers.map((u) => u.userId);

          await tx
            .update(UserModel)
            .set({
              userStatus: newUserStatus,
              updatedAt: new Date(),
            })
            .where(inArray(UserModel.id, userIds));
        }
      }

      return updatedLab;
    });
  }

  private static async getAssignedLabForUser(
    tx: DbTransaction,
    userId: string,
    clinicId?: string
  ) {
    const conditions = [eq(UserLabAssignmentsModel.userId, userId)];
    if (clinicId) {
      conditions.push(eq(UserLabAssignmentsModel.clinicId, clinicId));
    }

    const [assignment] = await tx
      .select({
        labId: UserLabAssignmentsModel.labId,
        clinicId: UserLabAssignmentsModel.clinicId,
      })
      .from(UserLabAssignmentsModel)
      .where(and(...conditions))
      .limit(1);

    if (!assignment) {
      throw new HttpError(403, 'Lab Assistant not assigned to any lab');
    }

    return assignment;
  }

  private static async ensureLabBelongsToClinic(
    tx: DbTransaction,
    labId: string,
    clinicId: string
  ) {
    const [lab] = await tx
      .select({ id: LabsModel.id })
      .from(LabsModel)
      .where(and(eq(LabsModel.id, labId), eq(LabsModel.clinicId, clinicId)))
      .limit(1);

    if (!lab) {
      throw new HttpError(403, 'Lab does not belong to this clinic');
    }
  }

  private static isClinicLabAdmin(userRole?: string) {
    return (
      userRole === 'Admin' ||
      userRole === 'Super_Admin' ||
      userRole === 'Receptionist'
    );
  }

  private static async getLabAccessForUser(
    tx: DbTransaction,
    userId: string,
    clinicId?: string,
    context?: LabPanelContext
  ) {
    if (this.isClinicLabAdmin(context?.userRole)) {
      if (!clinicId || !context?.labId) {
        throw new HttpError(403, 'Lab access denied');
      }

      await this.ensureLabBelongsToClinic(tx, context.labId, clinicId);
      return { labId: context.labId, clinicId };
    }

    return await this.getAssignedLabForUser(tx, userId, clinicId);
  }

  private static async attachTestsToDepartments<T extends { code: string }>(
    tx: DbTransaction | typeof database,
    departments: T[]
  ) {
    if (departments.length === 0) return departments;

    const globalTemplates = await tx
      .select({
        id: LabReportTemplatesModel.id,
        name: LabReportTemplatesModel.name,
        code: LabReportTemplatesModel.code,
        sampleType: LabReportTemplatesModel.sampleType,
        description: LabReportTemplatesModel.description,
      })
      .from(LabReportTemplatesModel)
      .where(
        and(
          isNull(LabReportTemplatesModel.labId),
          eq(LabReportTemplatesModel.isActive, true)
        )
      );

    const templateMap = new Map(globalTemplates.map((t) => [t.code, t]));

    return departments.map((dept) => {
      const allCodesForDept = getTemplateCodesForDepartment(dept.code);
      const tests = allCodesForDept
        .map((code) => templateMap.get(code))
        .filter((t): t is Exclude<typeof t, undefined> => !!t);

      return {
        ...dept,
        tests,
      };
    });
  }

  static async getDepartments() {
    // Global catalog only — a lab's custom departments come via getLabDepartmentsByLabId.
    const globalActive = and(
      eq(LabDepartmentsMasterModel.status, 'active'),
      isNull(LabDepartmentsMasterModel.labId)
    );
    let departments = await database
      .select()
      .from(LabDepartmentsMasterModel)
      .where(globalActive)
      .orderBy(LabDepartmentsMasterModel.name);

    if (departments.length === 0) {
      await seedLabDepartmentCatalog();
      departments = await database
        .select()
        .from(LabDepartmentsMasterModel)
        .where(globalActive)
        .orderBy(LabDepartmentsMasterModel.name);
    }

    return await this.attachTestsToDepartments(database, departments);
  }

  static async createDepartment(
    userId: string,
    clinicId: string,
    name: string,
    context?: LabPanelContext
  ) {
    return await database.transaction(async (tx) => {
      const { labId } = await this.getLabAccessForUser(
        tx,
        userId,
        clinicId,
        context
      );

      const [existing] = await tx
        .select()
        .from(LabDepartmentsMasterModel)
        .where(
          and(
            eq(LabDepartmentsMasterModel.status, 'active'),
            departmentVisibleToLab(labId),
            sql`lower(${LabDepartmentsMasterModel.name}) = lower(${name})`
          )
        )
        .limit(1);

      // Retry-safe: a same-name department is reused rather than duplicated.
      // code is globally unique while names are only unique per lab, hence the suffix.
      const slug =
        name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .replace(/^_|_$/g, '') || 'CUSTOM';
      const [department] = existing
        ? [existing]
        : await tx
            .insert(LabDepartmentsMasterModel)
            .values({
              labId,
              name,
              code: `${slug}_${randomBytes(3).toString('hex').toUpperCase()}`,
            })
            .returning();

      // Link it to the lab now — catalog sync soft-deletes tests in unlinked departments.
      await tx
        .insert(LabDepartmentsModel)
        .values({ labId, departmentId: department.id })
        .onConflictDoNothing();

      return { ...department, tests: [] };
    });
  }

  private static async getLabCatalogByLabId(tx: DbTransaction, labId: string) {
    return await tx
      .select({
        id: LabTestCatalogModel.id,
        labId: LabTestCatalogModel.labId,
        departmentId: LabTestCatalogModel.departmentId,
        departmentName: LabDepartmentsMasterModel.name,
        testCode: LabTestCatalogModel.testCode,
        testName: LabTestCatalogModel.name,
        name: LabTestCatalogModel.name,
        category: LabTestCatalogModel.category,
        sampleType: LabTestCatalogModel.sampleType,
        price: LabTestCatalogModel.price,
        status: LabTestCatalogModel.status,
        source: LabTestCatalogModel.source,
        createdBy: LabTestCatalogModel.createdBy,
        updatedBy: LabTestCatalogModel.updatedBy,
        createdAt: LabTestCatalogModel.createdAt,
        updatedAt: LabTestCatalogModel.updatedAt,
      })
      .from(LabTestCatalogModel)
      .leftJoin(
        LabDepartmentsMasterModel,
        eq(LabTestCatalogModel.departmentId, LabDepartmentsMasterModel.id)
      )
      .where(
        and(
          eq(LabTestCatalogModel.labId, labId),
          eq(LabTestCatalogModel.status, 'active'),
          isNull(LabTestCatalogModel.deletedAt),
          notInArray(LabTestCatalogModel.testCode, DEPARTMENT_CODES)
        )
      )
      .orderBy(desc(LabTestCatalogModel.updatedAt));
  }

  static async getLabCatalogForAdmin(labId: string, clinicId?: string) {
    return await database.transaction(async (tx) => {
      if (clinicId) {
        await this.ensureLabBelongsToClinic(tx, labId, clinicId);
      }

      return await this.getLabCatalogByLabId(tx, labId);
    });
  }

  private static async getPaginatedLabCatalog(
    tx: DbTransaction,
    labId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: any = {}
  ) {
    const pageNumber = Math.max(Number(query?.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query?.limit) || 10, 1), 1000);
    const offset = (pageNumber - 1) * pageSize;

    const whereConditions = [
      eq(LabTestCatalogModel.labId, labId),
      isNull(LabTestCatalogModel.deletedAt),
      notInArray(LabTestCatalogModel.testCode, DEPARTMENT_CODES),
    ];

    // Status filter - defaults to 'active' if not specified
    if (query?.status) {
      whereConditions.push(eq(LabTestCatalogModel.status, query.status));
    } else {
      whereConditions.push(eq(LabTestCatalogModel.status, 'active'));
    }

    // Department filter if provided
    if (query?.departmentId) {
      whereConditions.push(
        eq(LabTestCatalogModel.departmentId, query.departmentId)
      );
    }

    // Search filter across name, testCode, or department name
    if (query?.search) {
      const searchCondition = buildSearchCondition(
        query.search,
        [
          LabTestCatalogModel.name,
          LabTestCatalogModel.testCode,
          LabDepartmentsMasterModel.name,
        ],
        5
      );
      if (searchCondition) {
        whereConditions.push(searchCondition);
      }
    }

    const finalWhereCondition = and(...whereConditions);

    // Total Count query
    const totalRecords = await getTotalCount(
      tx,
      LabTestCatalogModel,
      finalWhereCondition,
      [
        {
          table: LabDepartmentsMasterModel,
          on: eq(
            LabTestCatalogModel.departmentId,
            LabDepartmentsMasterModel.id
          ),
          type: 'left',
        },
      ]
    );

    // Fetch tests
    const tests = await tx
      .select({
        id: LabTestCatalogModel.id,
        labId: LabTestCatalogModel.labId,
        departmentId: LabTestCatalogModel.departmentId,
        departmentName: LabDepartmentsMasterModel.name,
        testCode: LabTestCatalogModel.testCode,
        testName: LabTestCatalogModel.name,
        name: LabTestCatalogModel.name,
        category: LabTestCatalogModel.category,
        sampleType: LabTestCatalogModel.sampleType,
        price: LabTestCatalogModel.price,
        status: LabTestCatalogModel.status,
        source: LabTestCatalogModel.source,
        createdBy: LabTestCatalogModel.createdBy,
        updatedBy: LabTestCatalogModel.updatedBy,
        createdAt: LabTestCatalogModel.createdAt,
        updatedAt: LabTestCatalogModel.updatedAt,
      })
      .from(LabTestCatalogModel)
      .leftJoin(
        LabDepartmentsMasterModel,
        eq(LabTestCatalogModel.departmentId, LabDepartmentsMasterModel.id)
      )
      .where(finalWhereCondition)
      .orderBy(desc(LabTestCatalogModel.updatedAt))
      .limit(pageSize)
      .offset(offset);

    const pagination = buildPaginationMeta(totalRecords, pageNumber, pageSize);

    return {
      tests,
      pagination,
    };
  }

  static async getMyLabCatalog(
    userId: string,
    clinicId?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query?: any,
    context?: LabPanelContext
  ) {
    return await database.transaction(async (tx) => {
      const assignment = await this.getLabAccessForUser(
        tx,
        userId,
        clinicId,
        context
      );
      return await this.getPaginatedLabCatalog(tx, assignment.labId, query);
    });
  }

  private static async findMatchingMasterTemplate(
    tx: DbTransaction,
    departmentId: string,
    testName: string,
    masterTestId?: string | null
  ) {
    if (masterTestId) {
      const [template] = await tx
        .select()
        .from(LabReportTemplatesModel)
        .where(
          and(
            eq(LabReportTemplatesModel.id, masterTestId),
            isNull(LabReportTemplatesModel.labId),
            eq(LabReportTemplatesModel.isActive, true)
          )
        )
        .limit(1);
      if (template) return template;
    }

    // Otherwise, match by name under the selected department
    const [dept] = await tx
      .select({ code: LabDepartmentsMasterModel.code })
      .from(LabDepartmentsMasterModel)
      .where(eq(LabDepartmentsMasterModel.id, departmentId))
      .limit(1);

    if (!dept) return null;

    const allCodesForDept = getTemplateCodesForDepartment(dept.code);

    const [template] = await tx
      .select()
      .from(LabReportTemplatesModel)
      .where(
        and(
          inArray(LabReportTemplatesModel.code, allCodesForDept),
          isNull(LabReportTemplatesModel.labId),
          eq(LabReportTemplatesModel.isActive, true),
          ilike(LabReportTemplatesModel.name, testName)
        )
      )
      .limit(1);

    return template || null;
  }

  private static getExplicitReportTemplateCode(testCode?: string | null) {
    const code = testCode?.trim();
    if (!code) return null;

    if (code.length > 50) {
      throw new HttpError(
        400,
        'Test code must be 50 characters or less to manage result fields'
      );
    }

    return code;
  }

  private static async getActiveReportTemplateByCode(
    tx: DbTransaction,
    code: string,
    labId: string
  ) {
    const [template] = await tx
      .select()
      .from(LabReportTemplatesModel)
      .where(
        and(
          eq(LabReportTemplatesModel.code, code),
          eq(LabReportTemplatesModel.isActive, true),
          or(
            eq(LabReportTemplatesModel.labId, labId),
            isNull(LabReportTemplatesModel.labId)
          )
        )
      )
      .orderBy(
        sql`CASE WHEN ${LabReportTemplatesModel.labId} = ${labId} THEN 0 ELSE 1 END`
      )
      .limit(1);

    return template || null;
  }

  // The code a catalog test's report template is filed under: its own test
  // code, a known template for its name, or CUSTOM_<NAME>.
  private static getCatalogTestTemplateCode(payload: {
    testName: string;
    testCode?: string | null;
    category?: string | null;
  }) {
    const explicitCode = this.getExplicitReportTemplateCode(payload.testCode);
    const knownTemplateCode =
      !explicitCode && payload.category
        ? LabResultService.resolveTemplateCode(
            payload.testName,
            payload.category
          )
        : null;
    return (
      explicitCode ??
      knownTemplateCode ??
      buildCustomReportTemplateCode(payload.testName)
    );
  }

  private static async ensureReportTemplateForCatalogTest(
    tx: DbTransaction,
    payload: {
      labId: string;
      testName: string;
      testCode?: string | null;
      category?: string | null;
      sampleType?: string | null;
      matchingTemplate?: ReportTemplate | null;
    }
  ) {
    if (payload.matchingTemplate) {
      return payload.matchingTemplate;
    }

    const templateCode = this.getCatalogTestTemplateCode(payload);

    const existingTemplate = await this.getActiveReportTemplateByCode(
      tx,
      templateCode,
      payload.labId
    );

    if (existingTemplate) {
      return existingTemplate;
    }

    const [createdTemplate] = await tx
      .insert(LabReportTemplatesModel)
      .values({
        labId: payload.labId,
        name: payload.testName,
        code: templateCode,
        sampleType: payload.sampleType ?? payload.category ?? 'Other',
        description: `Auto-created template for ${payload.testName}`,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning();

    if (createdTemplate) {
      return createdTemplate;
    }

    const conflictTemplate = await this.getActiveReportTemplateByCode(
      tx,
      templateCode,
      payload.labId
    );

    if (!conflictTemplate) {
      throw new HttpError(
        500,
        'Report template could not be created for this lab test'
      );
    }

    return conflictTemplate;
  }

  private static async insertCustomFields(
    tx: DbTransaction,
    target: { templateId: string; labId: string; userId: string },
    fields: AddLabCustomFieldInput[]
  ) {
    if (!fields.length) return;
    // Same row shape LabResultService.addCustomField writes.
    await tx.insert(LabReportTemplateParametersModel).values(
      fields.map((field) => ({
        templateId: target.templateId,
        labId: target.labId,
        sectionName: field.sectionName,
        parameterName: field.parameterName,
        unit: field.unit,
        referenceRange: field.referenceRange,
        inputType: field.inputType,
        sortOrder: field.sortOrder,
        isRequired: field.isRequired,
        isActive: true,
        sourceType: 'CUSTOM' as const,
        isCustom: true,
        createdBy: target.userId,
        updatedBy: target.userId,
      }))
    );
  }

  private static activeCustomFieldsWhere(templateId: string, labId: string) {
    return and(
      eq(LabReportTemplateParametersModel.templateId, templateId),
      eq(LabReportTemplateParametersModel.labId, labId),
      eq(LabReportTemplateParametersModel.isCustom, true),
      eq(LabReportTemplateParametersModel.isActive, true)
    );
  }

  /**
   * Makes the lab's custom fields on a template match `fields`: listed ids are
   * updated, rows without one inserted, and unlisted ones deactivated — the
   * same soft delete LabResultService.deleteCustomField uses.
   */
  private static async syncCustomFields(
    tx: DbTransaction,
    target: { templateId: string; labId: string; userId: string },
    fields: LabCustomFieldSyncInput[]
  ) {
    const existing = await tx
      .select({ id: LabReportTemplateParametersModel.id })
      .from(LabReportTemplateParametersModel)
      .where(this.activeCustomFieldsWhere(target.templateId, target.labId));
    const existingIds = new Set(existing.map((row) => row.id));
    const keptIds = new Set<string>();
    const newFields: AddLabCustomFieldInput[] = [];

    for (const { id, ...field } of fields) {
      // An id from another template or lab is never updated — it becomes a new field.
      if (id && existingIds.has(id)) {
        keptIds.add(id);
        await tx
          .update(LabReportTemplateParametersModel)
          .set({ ...field, updatedBy: target.userId, updatedAt: new Date() })
          .where(eq(LabReportTemplateParametersModel.id, id));
      } else {
        newFields.push(field);
      }
    }

    await this.insertCustomFields(tx, target, newFields);

    const removedIds = [...existingIds].filter((id) => !keptIds.has(id));
    if (removedIds.length) {
      await tx
        .update(LabReportTemplateParametersModel)
        .set({
          isActive: false,
          updatedBy: target.userId,
          updatedAt: new Date(),
        })
        .where(inArray(LabReportTemplateParametersModel.id, removedIds));
    }
  }

  /** The lab's own result fields on a catalog test, for the Edit Test screen. */
  static async getLabCatalogTestCustomFields(
    testId: string,
    context: { clinicId: string; userId: string; userRole: string }
  ) {
    return await database.transaction(async (tx) => {
      const test = await this.getScopedLabTest(tx, testId, context);
      // Read-only: look the template up, never create one just by opening Edit.
      const template = await this.getActiveReportTemplateByCode(
        tx,
        this.getCatalogTestTemplateCode({
          testName: test.name,
          testCode: test.testCode,
          category: test.category,
        }),
        test.labId!
      );
      if (!template) return [];

      return await tx
        .select({
          id: LabReportTemplateParametersModel.id,
          parameterName: LabReportTemplateParametersModel.parameterName,
          inputType: LabReportTemplateParametersModel.inputType,
          unit: LabReportTemplateParametersModel.unit,
          referenceRange: LabReportTemplateParametersModel.referenceRange,
          isRequired: LabReportTemplateParametersModel.isRequired,
          sortOrder: LabReportTemplateParametersModel.sortOrder,
        })
        .from(LabReportTemplateParametersModel)
        .where(this.activeCustomFieldsWhere(template.id, test.labId!))
        .orderBy(LabReportTemplateParametersModel.sortOrder)
        .limit(50);
    });
  }

  static async addCustomLabTestByAssistant(
    userId: string,
    clinicId: string,
    payload: CreateCustomLabTestPayload,
    context?: LabPanelContext
  ) {
    return await database.transaction(async (tx) => {
      const assignment = await this.getLabAccessForUser(
        tx,
        userId,
        clinicId,
        context
      );

      const departmentId = payload.departmentId;

      // Check if this departmentId exists in global departments and is active
      const [globalDept] = await tx
        .select()
        .from(LabDepartmentsMasterModel)
        .where(
          and(
            eq(LabDepartmentsMasterModel.id, departmentId),
            eq(LabDepartmentsMasterModel.status, 'active'),
            departmentVisibleToLab(assignment.labId)
          )
        )
        .limit(1);

      if (!globalDept) {
        throw new HttpError(404, 'Department not found or inactive');
      }

      const department = {
        departmentId,
        departmentName: globalDept.name,
      };

      const [duplicate] = await tx
        .select({ id: LabTestCatalogModel.id })
        .from(LabTestCatalogModel)
        .where(
          and(
            eq(LabTestCatalogModel.labId, assignment.labId),
            eq(LabTestCatalogModel.departmentId, departmentId),
            ilike(LabTestCatalogModel.name, payload.testName),
            isNull(LabTestCatalogModel.deletedAt)
          )
        )
        .limit(1);

      if (duplicate) {
        throw new HttpError(409, 'Lab test already exists for this department');
      }

      const matchingTemplate = await this.findMatchingMasterTemplate(
        tx,
        departmentId,
        payload.testName,
        payload.masterTestId
      );

      const source = matchingTemplate ? 'master' : 'custom';
      const testCode = matchingTemplate
        ? matchingTemplate.code
        : payload.testCode;
      const sampleType = matchingTemplate
        ? payload.sampleType || matchingTemplate.sampleType
        : payload.sampleType;
      const reportTemplate = await this.ensureReportTemplateForCatalogTest(tx, {
        labId: assignment.labId,
        testName: payload.testName,
        testCode,
        category: department.departmentName,
        sampleType,
        matchingTemplate,
      });

      const [test] = await tx
        .insert(LabTestCatalogModel)
        .values({
          clinicId: assignment.clinicId,
          labId: assignment.labId,
          departmentId: departmentId,
          name: payload.testName,
          testCode: testCode,
          category: department.departmentName,
          sampleType: sampleType,
          price: payload.price,
          status: normalizeCatalogStatus(payload.status),
          source: source,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();

      // Inside this tx so the test and its fields save (or fail) together.
      await this.insertCustomFields(
        tx,
        { templateId: reportTemplate.id, labId: assignment.labId, userId },
        payload.customFields ?? []
      );

      return attachReportTemplateToTest(test, reportTemplate);
    });
  }

  private static async getScopedLabTest(
    tx: DbTransaction,
    testId: string,
    context: {
      clinicId: string;
      userId: string;
      userRole: string;
    }
  ) {
    const [test] = await tx
      .select()
      .from(LabTestCatalogModel)
      .where(
        and(
          eq(LabTestCatalogModel.id, testId),
          isNull(LabTestCatalogModel.deletedAt)
        )
      )
      .limit(1);

    if (!test) {
      throw new HttpError(404, 'Lab test not found');
    }

    if (!test.labId) {
      throw new HttpError(400, 'Lab test is missing labId');
    }

    if (context.userRole === 'Lab_Assistant') {
      const assignment = await this.getAssignedLabForUser(
        tx,
        context.userId,
        context.clinicId
      );
      if (assignment.labId !== test.labId) {
        throw new HttpError(403, 'You are not authorized for this lab test');
      }
      return test;
    }

    await this.ensureLabBelongsToClinic(tx, test.labId, context.clinicId);
    return test;
  }

  static async updateLabCatalogTest(
    testId: string,
    payload: UpdateLabCatalogTestPayload & {
      customFields?: LabCustomFieldSyncInput[];
    },
    context: {
      clinicId: string;
      userId: string;
      userRole: string;
    }
  ) {
    return await database.transaction(async (tx) => {
      const existingTest = await this.getScopedLabTest(tx, testId, context);
      const departmentId = payload.departmentId ?? existingTest.departmentId;

      if (!departmentId) {
        throw new HttpError(400, 'departmentId is required');
      }

      const [department] = await tx
        .select({
          id: LabDepartmentsMasterModel.id,
          name: LabDepartmentsMasterModel.name,
        })
        .from(LabDepartmentsMasterModel)
        .where(
          and(
            eq(LabDepartmentsMasterModel.id, departmentId),
            eq(LabDepartmentsMasterModel.status, 'active'),
            departmentVisibleToLab(existingTest.labId)
          )
        )
        .limit(1);

      if (!department) {
        throw new HttpError(404, 'Department not found or inactive');
      }

      const nextName = payload.testName ?? existingTest.name;
      if (!nextName) {
        throw new HttpError(400, 'testName is required');
      }

      if (payload.testName || payload.departmentId) {
        const [duplicate] = await tx
          .select({ id: LabTestCatalogModel.id })
          .from(LabTestCatalogModel)
          .where(
            and(
              eq(LabTestCatalogModel.labId, existingTest.labId!),
              eq(LabTestCatalogModel.departmentId, departmentId),
              ilike(LabTestCatalogModel.name, nextName),
              ne(LabTestCatalogModel.id, testId),
              isNull(LabTestCatalogModel.deletedAt)
            )
          )
          .limit(1);

        if (duplicate) {
          throw new HttpError(
            409,
            'Lab test already exists for this department'
          );
        }
      }

      let source = existingTest.source;
      let testCode = existingTest.testCode;
      let sampleType = existingTest.sampleType;
      let matchingTemplate: ReportTemplate | null = null;

      if (
        payload.testName ||
        payload.departmentId ||
        payload.masterTestId !== undefined
      ) {
        matchingTemplate = await this.findMatchingMasterTemplate(
          tx,
          departmentId,
          nextName,
          payload.masterTestId
        );

        source = matchingTemplate ? 'master' : 'custom';
        testCode = matchingTemplate
          ? matchingTemplate.code
          : payload.testCode !== undefined
            ? payload.testCode
            : null;
        sampleType = matchingTemplate
          ? (payload.sampleType ?? matchingTemplate.sampleType)
          : (payload.sampleType ?? existingTest.sampleType);
      } else {
        if (payload.testCode !== undefined) testCode = payload.testCode;
        if (payload.sampleType !== undefined) sampleType = payload.sampleType;
      }

      const reportTemplate = await this.ensureReportTemplateForCatalogTest(tx, {
        labId: existingTest.labId!,
        testName: nextName,
        testCode,
        category: department.name,
        sampleType,
        matchingTemplate,
      });

      const [updatedTest] = await tx
        .update(LabTestCatalogModel)
        .set({
          departmentId,
          name: nextName,
          testCode,
          category: department.name,
          sampleType,
          price: payload.price ?? existingTest.price,
          status:
            payload.status !== undefined
              ? normalizeCatalogStatus(payload.status)
              : existingTest.status,
          source,
          updatedBy: context.userId,
          updatedAt: new Date(),
        })
        .where(eq(LabTestCatalogModel.id, testId))
        .returning();

      // Omitted means "leave the fields alone"; a list (even empty) is the full set.
      if (payload.customFields) {
        await this.syncCustomFields(
          tx,
          {
            templateId: reportTemplate.id,
            labId: existingTest.labId!,
            userId: context.userId,
          },
          payload.customFields
        );
      }

      return attachReportTemplateToTest(updatedTest, reportTemplate);
    });
  }

  static async deactivateLabCatalogTest(
    testId: string,
    context: {
      clinicId: string;
      userId: string;
      userRole: string;
    }
  ) {
    return await database.transaction(async (tx) => {
      await this.getScopedLabTest(tx, testId, context);

      const [updatedTest] = await tx
        .update(LabTestCatalogModel)
        .set({
          status: 'inactive',
          updatedBy: context.userId,
          updatedAt: new Date(),
        })
        .where(eq(LabTestCatalogModel.id, testId))
        .returning();

      return updatedTest;
    });
  }

  static async getLabById(labId: string, clinicId?: string) {
    return await database.transaction(async (trx) => {
      // 1️⃣ Fetch Lab Details
      const [lab] = await trx
        .select()
        .from(LabsModel)
        .where(eq(LabsModel.id, labId));

      if (!lab) throw new HttpError(404, 'Lab not found');

      if (clinicId && lab.clinicId !== clinicId) {
        throw new HttpError(403, 'Lab does not belong to this clinic');
      }

      // 2️⃣ Compute analytics using DB-side aggregation (no unbounded fetch)
      const [analytics] = await trx
        .select({
          totalTests: sql<number>`COUNT(*)::int`,
          pendingTestsCount: sql<number>`COUNT(*) FILTER (WHERE ${LabOrderModel.paymentStatus}::text IN ('pending', 'PENDING') AND ${LabOrderModel.reportPdf} IS NULL)::int`,
          completedTestsCount: sql<number>`COUNT(*) FILTER (WHERE ${LabOrderModel.reportStatus} = 'Completed')::int`,
          totalRevenue: sql<number>`COALESCE(SUM(${TestCatalogModel.price}) FILTER (WHERE ${LabOrderModel.reportStatus} = 'Completed'), 0)::int`,
        })
        .from(LabOrderModel)
        .innerJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
        .innerJoin(
          UserLabAssignmentsModel,
          eq(LabOrderModel.labAssistantId, UserLabAssignmentsModel.userId)
        )
        .where(eq(UserLabAssignmentsModel.labId, labId));

      return {
        ...lab,
        analytics: {
          totalTests: analytics?.totalTests ?? 0,
          pendingTestsCount: analytics?.pendingTestsCount ?? 0,
          completedTestsCount: analytics?.completedTestsCount ?? 0,
          totalRevenue: analytics?.totalRevenue ?? 0,
        },
      };
    });
  }

  static async getLabsByClinicId(
    clinicId: string,
    query: PaginationQueryDto = {}
  ) {
    return await database.transaction(async (trx) => {
      const { limit, offset, pageSize, pageNumber } = getOffsetPagination(
        query,
        100
      );

      const whereCondition = eq(LabsModel.clinicId, clinicId);

      // 🔹 TOTAL COUNT
      const totalRecords = await getTotalCount(trx, LabsModel, whereCondition);

      // 🔹 FETCH LABS
      const labs = await trx
        .select()
        .from(LabsModel)
        .where(whereCondition)
        .orderBy(desc(LabsModel.createdAt))
        .limit(limit)
        .offset(offset);

      const pagination = buildPaginationMeta(
        totalRecords,
        pageNumber,
        pageSize
      );

      return {
        labs,
        pagination,
      };
    });
  }

  static async updateLabUser(userId: string, clinicId: string, labId?: string) {
    if (!labId) {
      throw new HttpError(400, 'labId is required for Lab Assistant');
    }

    // verify lab exists and belongs to clinic
    const [lab] = await database
      .select()
      .from(LabsModel)
      .where(eq(LabsModel.id, labId));

    if (!lab) {
      throw new HttpError(404, 'Lab not found');
    }

    // Assign user to lab
    const [assignment] = await database
      .insert(UserLabAssignmentsModel)
      .values({
        userId,
        labId,
        clinicId,
      })
      .returning();

    return assignment;
  }

  static async getTestsByLabAssistantController(labAssistantId: string) {
    return await database.transaction(async (trx) => {
      return await trx
        .select({
          id: LabOrderModel.id,
          reportStatus: LabOrderModel.reportStatus,
          patientName: UserModel.name,
          doctorName: sql<string>`doctor_user.name`,
          testName: TestCatalogModel.name,
          appointmentDate: AppointmentModel.appointmentDate,
          reportPdf: LabOrderModel.reportPdf,
        })
        .from(LabOrderModel)

        // join appointment to fetch date + clinic info
        .innerJoin(
          AppointmentModel,
          eq(LabOrderModel.appointmentId, AppointmentModel.id)
        )

        // join test table
        .innerJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )

        // join patient user
        .leftJoin(UserModel, eq(LabOrderModel.patientId, UserModel.id))

        // join doctor user alias
        .leftJoin(
          sql`${UserModel} as doctor_user`,
          eq(LabOrderModel.doctorId, sql`doctor_user.id`)
        )

        // ⭐ Now filter by assigned Lab Assistant ID
        .where(eq(LabOrderModel.labAssistantId, labAssistantId))

        .orderBy(desc(LabOrderModel.createdAt));
    });
  }

  static async getTestsByLabId(labId: string) {
    return await database.transaction(async (trx) => {
      return await trx
        .select()
        .from(LabOrderModel)
        .innerJoin(
          UserLabAssignmentsModel,
          eq(LabOrderModel.labAssistantId, UserLabAssignmentsModel.userId)
        )
        .where(eq(UserLabAssignmentsModel.labId, labId));
    });
  }

  static async getUsersByLabId(labId: string) {
    const users = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        userType: UserModel.userType,
        userStatus: UserModel.userStatus,
        createdAt: UserModel.createdAt,
      })
      .from(UserLabAssignmentsModel)
      .innerJoin(UserModel, eq(UserLabAssignmentsModel.userId, UserModel.id))
      .where(eq(UserLabAssignmentsModel.labId, labId));

    return users;
  }

  static async getdetailsBylabAssistent(userId: string) {
    return await database.transaction(async (trx) => {
      // 1️⃣ Get Lab Assignment
      const [assignment] = await trx
        .select()
        .from(UserLabAssignmentsModel)
        .where(eq(UserLabAssignmentsModel.userId, userId));

      if (!assignment) {
        throw new HttpError(404, 'Lab Assistant not assigned to any lab');
      }

      const labId = assignment.labId;

      // 2️⃣ Get Lab → Clinic ID
      const [lab] = await trx
        .select()
        .from(LabsModel)
        .where(eq(LabsModel.id, labId));

      if (!lab) throw new HttpError(404, 'Lab not found');

      const clinicId = lab.clinicId;
      const clinicName = lab.name;
      // -------------------------------
      // FETCH DETAILED TESTS FOR THE LAB
      // -------------------------------
      // Instead of filtering by specific user, we filter by the Lab ID (finding all tests assigned to any user in this lab) OR Initiated tests in the clinic (unassigned)
      const detailedTests = await trx
        .select({
          testId: LabOrderModel.id,
          reportStatus: LabOrderModel.reportStatus,
          reportPdf: LabOrderModel.reportPdf,
          price: LabOrderModel.price,
          paymentStatus: LabOrderModel.paymentStatus,
          workflowStatus: LabOrderModel.workflowStatus,
          sampleStatus: LabOrderModel.sampleStatus,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
          appointmentType: AppointmentModel.appointmentType,
          createdAt: LabOrderModel.createdAt,
          updatedAt: LabOrderModel.updatedAt,
          clinicId: AppointmentModel.clinicId,

          // Patient info
          patientId: UserModel.id,
          patientName: UserModel.name,

          // Doctor info
          doctorId: sql`doctor_user.id`,
          doctorName: sql`doctor_user.name`,

          // Lab Assistant info (The one assigned to the test)
          labAssistantId: sql`lab_assistant_user.id`,
          labAssistantName: sql`lab_assistant_user.name`,

          // Test info
          testName: TestCatalogModel.name,
        })
        .from(LabOrderModel)
        .innerJoin(
          AppointmentModel,
          eq(LabOrderModel.appointmentId, AppointmentModel.id)
        )
        .innerJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
        .leftJoin(UserModel, eq(LabOrderModel.patientId, UserModel.id))
        .leftJoin(
          sql`${UserModel} as doctor_user`,
          eq(LabOrderModel.doctorId, sql`doctor_user.id`)
        )
        .leftJoin(
          sql`${UserModel} as lab_assistant_user`,
          eq(LabOrderModel.labAssistantId, sql`lab_assistant_user.id`)
        )
        // JOIN with UserAssignments to ensure we only get tests for this LAB
        .leftJoin(
          UserLabAssignmentsModel,
          eq(LabOrderModel.labAssistantId, UserLabAssignmentsModel.userId)
        )
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            or(
              eq(UserLabAssignmentsModel.labId, labId),
              eq(LabOrderModel.reportStatus, 'Initiated')
            ) // Ensure tests belong to the user's Lab OR are Initiated (unassigned)
          )
        );

      // -------------------------------
      // PROCESS & SORT DATA
      // -------------------------------

      // Sort helper
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sortByDateDesc = (a: any, b: any) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        if (dateA !== dateB) return dateB - dateA; // sort by createdAt
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ); // then updatedAt
      };

      const allVisibleTests = detailedTests.sort(sortByDateDesc);

      // Filter lists based on status
      const initiatedTests = allVisibleTests.filter(
        (t) => t.reportStatus === 'Initiated' && t.clinicId === clinicId
      );

      // Counts Logic
      // Pending: Initiated + Pending Payment + No Report (Matches original logic intent but now includes correctly fetched initiated tests)
      const pendingTestsCount = allVisibleTests.filter(
        (t) =>
          t.reportStatus === 'Initiated' &&
          ['pending', 'PENDING'].includes(t.paymentStatus) &&
          !t.reportPdf
      ).length;

      const completedWithoutPdf = allVisibleTests.filter(
        (t) => t.reportStatus === 'Completed' && !t.reportPdf
      );
      const completedWithPdf = allVisibleTests.filter(
        (t) => t.reportStatus === 'Completed' && t.reportPdf
      );

      // Assigned Tests (Exclude Initiated)
      const assignedTests = allVisibleTests.filter(
        (t) => t.reportStatus !== 'Initiated'
      );

      // -------------------------------
      // FINAL RESPONSE
      // -------------------------------
      return {
        labId,
        clinicName,
        clinicId,
        initiatedTestsCount: initiatedTests.length,
        assignedTestsCount: assignedTests.length, // Only tests truly assigned (not just initiated)
        pendingTestsCount: pendingTestsCount,
        completedWithoutPdfCount: completedWithoutPdf.length,
        completedWithPdfCount: completedWithPdf.length,
        initiatedTests,
        testsAssigned: assignedTests,
      };
    });
  }

  static async getLabDepartmentsByLabId(labId: string, clinicId?: string) {
    return await database.transaction(async (tx) => {
      if (clinicId) {
        await this.ensureLabBelongsToClinic(tx, labId, clinicId);
      }
      const departments = await tx
        .select({
          id: LabDepartmentsMasterModel.id,
          name: LabDepartmentsMasterModel.name,
          code: LabDepartmentsMasterModel.code,
          status: LabDepartmentsMasterModel.status,
          createdAt: LabDepartmentsMasterModel.createdAt,
          updatedAt: LabDepartmentsMasterModel.updatedAt,
        })
        .from(LabDepartmentsMasterModel)
        .innerJoin(
          LabDepartmentsModel,
          eq(LabDepartmentsMasterModel.id, LabDepartmentsModel.departmentId)
        )
        .where(
          and(
            eq(LabDepartmentsModel.labId, labId),
            eq(LabDepartmentsMasterModel.status, 'active')
          )
        )
        .orderBy(LabDepartmentsMasterModel.name);

      return await this.attachTestsToDepartments(tx, departments);
    });
  }

  static async updateLabDepartments(
    labId: string,
    departmentIds: string[],
    departmentTestIds?: DepartmentTestSelection,
    clinicId?: string
  ) {
    return await database.transaction(async (tx) => {
      const selectedDepartmentIds = uniqueIds(departmentIds);
      const selectedDepartmentTestIds =
        normalizeDepartmentTestSelection(departmentTestIds);

      const [lab] = await tx
        .select({ id: LabsModel.id, clinicId: LabsModel.clinicId })
        .from(LabsModel)
        .where(eq(LabsModel.id, labId))
        .limit(1);

      if (!lab) {
        throw new HttpError(404, 'Lab not found');
      }

      if (clinicId && lab.clinicId !== clinicId) {
        throw new HttpError(403, 'Lab does not belong to this clinic');
      }

      if (selectedDepartmentIds.length > 0) {
        const activeDepts = await tx
          .select({ id: LabDepartmentsMasterModel.id })
          .from(LabDepartmentsMasterModel)
          .where(
            and(
              inArray(LabDepartmentsMasterModel.id, selectedDepartmentIds),
              eq(LabDepartmentsMasterModel.status, 'active'),
              departmentVisibleToLab(labId)
            )
          );

        if (activeDepts.length !== selectedDepartmentIds.length) {
          throw new HttpError(
            400,
            'One or more department IDs are invalid or inactive'
          );
        }
      }

      await tx
        .delete(LabDepartmentsModel)
        .where(eq(LabDepartmentsModel.labId, labId));

      if (selectedDepartmentIds.length > 0) {
        await tx.insert(LabDepartmentsModel).values(
          selectedDepartmentIds.map((deptId) => ({
            labId,
            departmentId: deptId,
          }))
        );
      }

      await this.syncLabCatalogByLabId(
        tx,
        labId,
        lab.clinicId,
        selectedDepartmentTestIds
      );

      return await tx
        .select({
          id: LabDepartmentsMasterModel.id,
          name: LabDepartmentsMasterModel.name,
          code: LabDepartmentsMasterModel.code,
          status: LabDepartmentsMasterModel.status,
          createdAt: LabDepartmentsMasterModel.createdAt,
          updatedAt: LabDepartmentsMasterModel.updatedAt,
        })
        .from(LabDepartmentsMasterModel)
        .innerJoin(
          LabDepartmentsModel,
          eq(LabDepartmentsMasterModel.id, LabDepartmentsModel.departmentId)
        )
        .where(
          and(
            eq(LabDepartmentsModel.labId, labId),
            eq(LabDepartmentsMasterModel.status, 'active')
          )
        )
        .orderBy(LabDepartmentsMasterModel.name);
    });
  }

  private static async getTemplatesForDepartmentSelection(
    tx: DbTransaction,
    departmentCode: string,
    selectedTemplateIds?: string[]
  ) {
    const allCodesForDept = getTemplateCodesForDepartment(departmentCode);

    if (selectedTemplateIds && selectedTemplateIds.length === 0) {
      return [];
    }

    const templates = await tx
      .select()
      .from(LabReportTemplatesModel)
      .where(
        selectedTemplateIds
          ? and(
              inArray(LabReportTemplatesModel.id, selectedTemplateIds),
              inArray(LabReportTemplatesModel.code, allCodesForDept),
              isNull(LabReportTemplatesModel.labId),
              eq(LabReportTemplatesModel.isActive, true)
            )
          : and(
              inArray(LabReportTemplatesModel.code, allCodesForDept),
              isNull(LabReportTemplatesModel.labId),
              eq(LabReportTemplatesModel.isActive, true)
            )
      );

    if (
      selectedTemplateIds &&
      templates.length !== selectedTemplateIds.length
    ) {
      throw new HttpError(
        400,
        'One or more master test IDs are invalid for the selected department'
      );
    }

    return templates;
  }

  private static async deactivateUnselectedMasterTests(
    tx: DbTransaction,
    labId: string,
    departmentId: string,
    selectedTemplateCodes: string[]
  ) {
    const deactivationPayload = {
      deletedAt: new Date(),
      status: 'inactive' as const,
      updatedAt: new Date(),
    };

    await tx
      .update(LabTestCatalogModel)
      .set(deactivationPayload)
      .where(
        selectedTemplateCodes.length > 0
          ? and(
              eq(LabTestCatalogModel.labId, labId),
              eq(LabTestCatalogModel.departmentId, departmentId),
              eq(LabTestCatalogModel.source, 'master'),
              notInArray(LabTestCatalogModel.testCode, selectedTemplateCodes),
              isNull(LabTestCatalogModel.deletedAt)
            )
          : and(
              eq(LabTestCatalogModel.labId, labId),
              eq(LabTestCatalogModel.departmentId, departmentId),
              eq(LabTestCatalogModel.source, 'master'),
              isNull(LabTestCatalogModel.deletedAt)
            )
      );
  }

  private static async getPreservedMasterTestCodes(
    tx: DbTransaction,
    labId: string,
    departmentId: string
  ) {
    const existingMasterTests = await tx
      .select({
        testCode: LabTestCatalogModel.testCode,
        status: LabTestCatalogModel.status,
        deletedAt: LabTestCatalogModel.deletedAt,
      })
      .from(LabTestCatalogModel)
      .where(
        and(
          eq(LabTestCatalogModel.labId, labId),
          eq(LabTestCatalogModel.departmentId, departmentId),
          eq(LabTestCatalogModel.source, 'master')
        )
      );

    const hasDeselectedTests = existingMasterTests.some(
      (test) => test.deletedAt || test.status !== 'active'
    );

    if (!hasDeselectedTests) return undefined;

    return existingMasterTests
      .filter(
        (test) => test.testCode && !test.deletedAt && test.status === 'active'
      )
      .map((test) => test.testCode!);
  }

  private static async getTemplatesForDepartmentCodes(
    tx: DbTransaction,
    departmentCode: string,
    selectedTemplateCodes?: string[]
  ) {
    if (!selectedTemplateCodes) {
      return await this.getTemplatesForDepartmentSelection(tx, departmentCode);
    }

    const allCodesForDept = getTemplateCodesForDepartment(departmentCode);
    const validTemplateCodes = selectedTemplateCodes.filter((code) =>
      allCodesForDept.includes(code)
    );

    if (validTemplateCodes.length === 0) return [];

    return await tx
      .select()
      .from(LabReportTemplatesModel)
      .where(
        and(
          inArray(LabReportTemplatesModel.code, validTemplateCodes),
          isNull(LabReportTemplatesModel.labId),
          eq(LabReportTemplatesModel.isActive, true)
        )
      );
  }

  private static async upsertSyncedMasterTest(
    tx: DbTransaction,
    payload: {
      clinicId: string;
      labId: string;
      departmentId: string;
      departmentName: string;
      template: typeof LabReportTemplatesModel.$inferSelect;
    }
  ) {
    const [existing] = await tx
      .select({ id: LabTestCatalogModel.id })
      .from(LabTestCatalogModel)
      .where(
        and(
          eq(LabTestCatalogModel.labId, payload.labId),
          eq(LabTestCatalogModel.testCode, payload.template.code),
          eq(LabTestCatalogModel.source, 'master')
        )
      )
      .orderBy(desc(LabTestCatalogModel.updatedAt))
      .limit(1);

    const updatePayload = {
      clinicId: payload.clinicId,
      labId: payload.labId,
      departmentId: payload.departmentId,
      name: payload.template.name,
      testCode: payload.template.code,
      category: payload.departmentName,
      sampleType: payload.template.sampleType,
      source: 'master' as const,
      status: 'active' as const,
      deletedAt: null,
      updatedAt: new Date(),
    };

    if (existing) {
      await tx
        .update(LabTestCatalogModel)
        .set(updatePayload)
        .where(eq(LabTestCatalogModel.id, existing.id));
      return;
    }

    await tx.insert(LabTestCatalogModel).values({
      ...updatePayload,
      price: 0,
    });
  }

  static async syncLabCatalogByLabId(
    tx: DbTransaction,
    labId: string,
    clinicId: string,
    departmentTestIds?: DepartmentTestSelection,
    preserveDeselectedMasterTests = false
  ) {
    const assignedDepts = await tx
      .select({
        id: LabDepartmentsMasterModel.id,
        code: LabDepartmentsMasterModel.code,
        name: LabDepartmentsMasterModel.name,
      })
      .from(LabDepartmentsMasterModel)
      .innerJoin(
        LabDepartmentsModel,
        eq(LabDepartmentsMasterModel.id, LabDepartmentsModel.departmentId)
      )
      .where(
        and(
          eq(LabDepartmentsModel.labId, labId),
          eq(LabDepartmentsMasterModel.status, 'active')
        )
      );

    const assignedDeptIds = assignedDepts.map((d) => d.id);

    if (departmentTestIds) {
      const invalidDepartmentIds = Object.keys(departmentTestIds).filter(
        (departmentId) => !assignedDeptIds.includes(departmentId)
      );

      if (invalidDepartmentIds.length > 0) {
        throw new HttpError(
          400,
          'departmentTestIds contains departments that are not selected'
        );
      }
    }

    if (!assignedDepts.length) {
      // If no departments are assigned, soft-delete all tests of this lab that are linked to a department
      await tx
        .update(LabTestCatalogModel)
        .set({
          deletedAt: new Date(),
          status: 'inactive',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(LabTestCatalogModel.labId, labId),
            isNotNull(LabTestCatalogModel.departmentId),
            isNull(LabTestCatalogModel.deletedAt)
          )
        );
      return [];
    }

    // Soft-delete tests of departments that are no longer assigned
    await tx
      .update(LabTestCatalogModel)
      .set({
        deletedAt: new Date(),
        status: 'inactive',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(LabTestCatalogModel.labId, labId),
          isNotNull(LabTestCatalogModel.departmentId),
          notInArray(LabTestCatalogModel.departmentId, assignedDeptIds),
          isNull(LabTestCatalogModel.deletedAt)
        )
      );

    for (const dept of assignedDepts) {
      const selectedTemplateIds = departmentTestIds
        ? (departmentTestIds[dept.id] ?? [])
        : undefined;
      const preservedTemplateCodes =
        !departmentTestIds && preserveDeselectedMasterTests
          ? await this.getPreservedMasterTestCodes(tx, labId, dept.id)
          : undefined;
      const templates = preservedTemplateCodes
        ? await this.getTemplatesForDepartmentCodes(
            tx,
            dept.code,
            preservedTemplateCodes
          )
        : await this.getTemplatesForDepartmentSelection(
            tx,
            dept.code,
            selectedTemplateIds
          );

      if (departmentTestIds || preservedTemplateCodes) {
        await this.deactivateUnselectedMasterTests(
          tx,
          labId,
          dept.id,
          templates.map((template) => template.code)
        );
      }

      for (const template of templates) {
        if (template.code === dept.code) continue;

        await this.upsertSyncedMasterTest(tx, {
          clinicId,
          labId,
          departmentId: dept.id,
          departmentName: dept.name,
          template,
        });
      }
    }
  }

  static async syncLabCatalogPublic(labId: string, clinicId?: string) {
    return await database.transaction(async (tx) => {
      const [lab] = await tx
        .select({ id: LabsModel.id, clinicId: LabsModel.clinicId })
        .from(LabsModel)
        .where(eq(LabsModel.id, labId))
        .limit(1);

      if (!lab) {
        throw new HttpError(404, 'Lab not found');
      }

      if (clinicId && lab.clinicId !== clinicId) {
        throw new HttpError(403, 'Lab does not belong to this clinic');
      }

      await this.syncLabCatalogByLabId(
        tx,
        labId,
        lab.clinicId,
        undefined,
        true
      );
      return await this.getLabCatalogByLabId(tx, labId);
    });
  }
}
