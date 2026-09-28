import {
  and,
  eq,
  sql,
  or,
  ilike,
  desc,
  ne,
  isNotNull,
  gte,
  lt,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import ExcelJS from 'exceljs';
import {
  CreateSupplierInput,
  UpdateSupplierInput,
} from '../schemas/supplier.schema';
import {
  PharmacyAssignModel,
  PharmacyModel,
} from '../../pharmacy/models/pharmacy.model';
import { PharmacySupplierModel } from '../models/pharmacySupplier.model';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models';

export class PharmacySupplierService {
  static async getUserPharmacyId(userId: string): Promise<string> {
    const [user] = await database
      .select({
        userType: UserModel.userType,
      })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    const [pharmacyAssign] = await database
      .select({
        pharmacyId: PharmacyAssignModel.pharmacyId,
        clinicId: PharmacyAssignModel.clinicId,
      })
      .from(PharmacyAssignModel)
      .where(eq(PharmacyAssignModel.userId, userId))
      .limit(1);

    if (pharmacyAssign) {
      return pharmacyAssign.pharmacyId;
    }

    if (user.userType === 'Admin') {
      // Get the user's clinic assignment
      const [clinicAssign] = await database
        .select({
          clinicId: ClinicAssignModel.clinicId,
        })
        .from(ClinicAssignModel)
        .where(eq(ClinicAssignModel.userId, userId))
        .limit(1);

      if (clinicAssign) {
        const [pharmacy] = await database
          .select({
            id: PharmacyModel.id,
          })
          .from(PharmacyModel)
          .where(
            and(
              eq(PharmacyModel.clinicId, clinicAssign.clinicId),
              eq(PharmacyModel.isDeleted, false)
            )
          )
          .limit(1);

        if (pharmacy) {
          await database
            .insert(PharmacyAssignModel)
            .values({
              userId: userId,
              pharmacyId: pharmacy.id,
              clinicId: clinicAssign.clinicId,
              userRole: 'Admin',
            })
            .onConflictDoNothing({
              target: [
                PharmacyAssignModel.userId,
                PharmacyAssignModel.pharmacyId,
              ],
            });

          return pharmacy.id;
        }
      }
    }

    throw new HttpError(403, 'No pharmacy assigned to this user');
  }

  static async createSupplier(
    payload: CreateSupplierInput,
    pharmacyId: string
  ) {
    return await database.transaction(async (tx) => {
      const [pharmacy] = await tx
        .select({ id: PharmacyModel.id })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.id, pharmacyId),
            eq(PharmacyModel.isDeleted, false)
          )
        )
        .limit(1);

      if (!pharmacy) {
        throw new HttpError(404, 'Pharmacy not found');
      }

      const [existingSupplier] = await tx
        .select({ id: PharmacySupplierModel.id })
        .from(PharmacySupplierModel)
        .where(
          and(
            eq(PharmacySupplierModel.pharmacyId, pharmacyId),
            eq(PharmacySupplierModel.supplierName, payload.supplierName)
          )
        )
        .limit(1);

      if (existingSupplier) {
        throw new HttpError(
          400,
          'Supplier with this name already exists in this pharmacy'
        );
      }

      if (payload.email) {
        const [existingEmail] = await tx
          .select({ id: PharmacySupplierModel.id })
          .from(PharmacySupplierModel)
          .where(
            and(
              eq(PharmacySupplierModel.email, payload.email),
              eq(PharmacySupplierModel.pharmacyId, pharmacyId)
            )
          )
          .limit(1);

        if (existingEmail) {
          throw new HttpError(
            400,
            'Supplier with this email already exists in this pharmacy'
          );
        }
      }

      const [supplier] = await tx
        .insert(PharmacySupplierModel)
        .values({
          pharmacyId: pharmacyId,
          supplierName: payload.supplierName,
          contactPerson: payload.contactPerson,
          phone: payload.phone,
          email: payload.email,
          address: payload.address,
          gstNumber: payload.gstNumber,
          panNumber: payload.panNumber,
          creditDays: payload.creditDays,
          status: 'active',
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      return supplier;
    });
  }

  static async getSuppliers(
    pharmacyId: string,
    query: {
      pageNumber?: number;
      pageSize?: number;
      search?: string;
      status?: 'active' | 'inactive';
    }
  ) {
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const pageSize = Math.max(Number(query.pageSize) || 10, 1);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    const { limit, offset } = pagination(pageNumber, pageSize);

    const conditions: any[] = [
      eq(PharmacySupplierModel.pharmacyId, pharmacyId),
    ];

    if (query.status) {
      conditions.push(eq(PharmacySupplierModel.status, query.status));
    }

    if (query.search && query.search.trim()) {
      const searchPattern = `%${query.search.trim()}%`;
      const searchConditions = [
        ilike(PharmacySupplierModel.supplierName, searchPattern),
        ilike(PharmacySupplierModel.contactPerson, searchPattern),
        ilike(PharmacySupplierModel.phone, searchPattern),
        ilike(PharmacySupplierModel.email, searchPattern),
      ].filter((condition) => condition !== undefined);

      if (searchConditions.length > 0) {
        conditions.push(or(...searchConditions));
      }
    }

    const totalCountResult = await database
      .select({ count: sql`COUNT(*)` })
      .from(PharmacySupplierModel)
      .where(and(...conditions));

    const totalCount = Number(totalCountResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    const suppliers = await database
      .select({
        id: PharmacySupplierModel.id,
        pharmacyId: PharmacySupplierModel.pharmacyId,
        supplierName: PharmacySupplierModel.supplierName,
        contactPerson: PharmacySupplierModel.contactPerson,
        phone: PharmacySupplierModel.phone,
        email: PharmacySupplierModel.email,
        address: PharmacySupplierModel.address,
        gstNumber: PharmacySupplierModel.gstNumber,
        panNumber: PharmacySupplierModel.panNumber,
        creditDays: PharmacySupplierModel.creditDays,
        status: PharmacySupplierModel.status,
        createdAt: PharmacySupplierModel.createdAt,
        updatedAt: PharmacySupplierModel.updatedAt,
      })
      .from(PharmacySupplierModel)
      .where(and(...conditions))
      .orderBy(desc(PharmacySupplierModel.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      suppliers,
      pagination: {
        totalRecords: totalCount,
        totalPages,
        currentPage: pageNumber,
        pageSize,
      },
    };
  }

  static async getSupplierById(id: string, pharmacyId: string) {
    const [supplier] = await database
      .select({
        id: PharmacySupplierModel.id,
        pharmacyId: PharmacySupplierModel.pharmacyId,
        supplierName: PharmacySupplierModel.supplierName,
        contactPerson: PharmacySupplierModel.contactPerson,
        phone: PharmacySupplierModel.phone,
        email: PharmacySupplierModel.email,
        address: PharmacySupplierModel.address,
        gstNumber: PharmacySupplierModel.gstNumber,
        panNumber: PharmacySupplierModel.panNumber,
        creditDays: PharmacySupplierModel.creditDays,
        status: PharmacySupplierModel.status,
        createdAt: PharmacySupplierModel.createdAt,
        updatedAt: PharmacySupplierModel.updatedAt,
      })
      .from(PharmacySupplierModel)
      .where(
        and(
          eq(PharmacySupplierModel.id, id),
          eq(PharmacySupplierModel.pharmacyId, pharmacyId)
        )
      )
      .limit(1);

    if (!supplier) {
      throw new HttpError(404, 'Supplier not found');
    }

    return supplier;
  }

  static async updateSupplier(
    id: string,
    payload: UpdateSupplierInput,
    pharmacyId: string
  ) {
    return await database.transaction(async (tx) => {
      const [existingSupplier] = await tx
        .select({
          id: PharmacySupplierModel.id,
          pharmacyId: PharmacySupplierModel.pharmacyId,
          supplierName: PharmacySupplierModel.supplierName,
          email: PharmacySupplierModel.email,
        })
        .from(PharmacySupplierModel)
        .where(
          and(
            eq(PharmacySupplierModel.id, id),
            eq(PharmacySupplierModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);

      if (!existingSupplier) {
        throw new HttpError(404, 'Supplier not found');
      }

      if (
        payload.supplierName &&
        payload.supplierName !== existingSupplier.supplierName
      ) {
        const [duplicateName] = await tx
          .select({ id: PharmacySupplierModel.id })
          .from(PharmacySupplierModel)
          .where(
            and(
              eq(PharmacySupplierModel.pharmacyId, existingSupplier.pharmacyId),
              eq(PharmacySupplierModel.supplierName, payload.supplierName),
              ne(PharmacySupplierModel.id, id)
            )
          )
          .limit(1);

        if (duplicateName) {
          throw new HttpError(
            400,
            'Supplier with this name already exists in this pharmacy'
          );
        }
      }

      if (payload.email && payload.email !== existingSupplier.email) {
        const [duplicateEmail] = await tx
          .select({ id: PharmacySupplierModel.id })
          .from(PharmacySupplierModel)
          .where(
            and(
              eq(PharmacySupplierModel.email, payload.email),
              eq(PharmacySupplierModel.pharmacyId, existingSupplier.pharmacyId),
              ne(PharmacySupplierModel.id, id)
            )
          )
          .limit(1);

        if (duplicateEmail) {
          throw new HttpError(
            400,
            'Supplier with this email already exists in this pharmacy'
          );
        }
      }

      const [updatedSupplier] = await tx
        .update(PharmacySupplierModel)
        .set({
          ...payload,
          updatedAt: new Date(),
        })
        .where(eq(PharmacySupplierModel.id, id))
        .returning();

      return updatedSupplier;
    });
  }

  static async generateSupplierSampleTemplate() {
    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet('Supplier Upload');

    sheet.columns = [
      {
        header: 'Supplier Name *',
        key: 'supplierName',
        width: 30,
      },
      {
        header: 'Contact Person *',
        key: 'contactPerson',
        width: 25,
      },
      {
        header: 'Phone *',
        key: 'phone',
        width: 20,
      },
      {
        header: 'Email (Optional)',
        key: 'email',
        width: 30,
      },
      {
        header: 'Address (Optional)',
        key: 'address',
        width: 40,
      },
      {
        header: 'GST Number (Optional)',
        key: 'gstNumber',
        width: 25,
      },
      {
        header: 'PAN Number (Optional)',
        key: 'panNumber',
        width: 25,
      },
      {
        header: 'Credit Days (Optional)',
        key: 'creditDays',
        width: 25,
      },
    ];

    sheet.getRow(1).font = {
      bold: true,
    };

    const mandatoryHeaderFill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: '92D050' },
    };

    const optionalHeaderFill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFD966' },
    };

    const headerBorder = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    };

    ['A1', 'B1', 'C1'].forEach((cell) => {
      sheet.getCell(cell).fill = mandatoryHeaderFill;
      sheet.getCell(cell).border = headerBorder;
    });

    ['D1', 'E1', 'F1', 'G1', 'H1'].forEach((cell) => {
      sheet.getCell(cell).fill = optionalHeaderFill;
      sheet.getCell(cell).border = headerBorder;
    });

    sheet.getRow(1).alignment = {
      vertical: 'middle',
      horizontal: 'left',
    };

    sheet.views = [
      {
        state: 'frozen',
        ySplit: 1,
      },
    ];

    sheet.getCell('A1').note =
      'Required. Supplier Name must be unique within pharmacy.';

    sheet.getCell('B1').note = 'Required. Contact person name.';

    sheet.getCell('C1').note = 'Required. Phone number.';

    sheet.getCell('D1').note = 'Optional. Valid email address.';

    sheet.getCell('H1').note =
      'Optional. Integer value greater than or equal to 0.';

    for (let row = 2; row <= 1000; row++) {
      sheet.getCell(`H${row}`).dataValidation = {
        type: 'whole',
        operator: 'greaterThanOrEqual',
        allowBlank: true,
        formulae: [0],
        showErrorMessage: true,
        errorTitle: 'Invalid Credit Days',
        error: 'Credit Days must be 0 or greater.',
      };
    }

    for (let i = 0; i < 100; i++) {
      sheet.addRow({
        supplierName: '',
        contactPerson: '',
        phone: '',
        email: '',
        address: '',
        gstNumber: '',
        panNumber: '',
        creditDays: '',
      });
    }

    return workbook;
  }

  static async importSuppliersFromExcel(
    pharmacyId: string,
    fileBuffer: Buffer
  ) {
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);

    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new HttpError(400, 'Excel sheet not found');
    }

    const expectedHeaders = [
      'Supplier Name *',
      'Contact Person *',
      'Phone *',
      'Email (Optional)',
      'Address (Optional)',
      'GST Number (Optional)',
      'PAN Number (Optional)',
      'Credit Days (Optional)',
    ];

    const headerRow = worksheet.getRow(1);

    const actualHeaders = expectedHeaders.map((_, index) =>
      String(headerRow.getCell(index + 1).value ?? '').trim()
    );

    const isValid = expectedHeaders.every(
      (header, index) => header === actualHeaders[index]
    );

    if (!isValid) {
      throw new HttpError(
        400,
        'Invalid template. Please use the downloaded supplier import template.'
      );
    }

    const insertedSuppliers: string[] = [];
    const updatedSuppliers: string[] = [];
    const skippedSuppliers: string[] = [];
    const errors: string[] = [];

    const processedSuppliers = new Set<string>();

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);

      const supplierName = String(row.getCell(1).value ?? '').trim();

      const contactPerson = String(row.getCell(2).value ?? '').trim();

      const phone = String(row.getCell(3).value ?? '').trim();

      const email = String(row.getCell(4).text ?? '')
        .replace(/\u00A0/g, ' ')
        .trim();

      const address = String(row.getCell(5).value ?? '').trim();

      const gstNumber = String(row.getCell(6).value ?? '').trim();

      const panNumber = String(row.getCell(7).value ?? '').trim();

      const creditDaysValue = String(row.getCell(8).value ?? '').trim();

      if (
        !supplierName &&
        !contactPerson &&
        !phone &&
        !email &&
        !address &&
        !gstNumber &&
        !panNumber &&
        !creditDaysValue
      ) {
        continue;
      }

      if (!supplierName) {
        errors.push(`Row ${rowNumber}: Supplier Name is required`);
        continue;
      }

      const supplierKey = supplierName.toLowerCase().trim();

      if (processedSuppliers.has(supplierKey)) {
        errors.push(
          `Row ${rowNumber}: Supplier "${supplierName}" is duplicated in the upload file`
        );
        continue;
      }

      processedSuppliers.add(supplierKey);

      if (!contactPerson) {
        errors.push(`Row ${rowNumber}: Contact Person is required`);
        continue;
      }

      if (!phone) {
        errors.push(`Row ${rowNumber}: Phone is required`);
        continue;
      }

      const phoneRegex = /^[0-9]{10}$/;

      if (!phoneRegex.test(phone)) {
        errors.push(
          `Row ${rowNumber}: Phone must be exactly 10 digits and numeric`
        );
        continue;
      }

      if (supplierName.length > 100) {
        errors.push(
          `Row ${rowNumber}: Supplier Name cannot exceed 100 characters`
        );
        continue;
      }

      if (contactPerson.length > 50) {
        errors.push(
          `Row ${rowNumber}: Contact Person cannot exceed 50 characters`
        );
        continue;
      }

      if (phone.length > 20) {
        errors.push(`Row ${rowNumber}: Phone cannot exceed 20 characters`);
        continue;
      }

      if (email.length > 60) {
        errors.push(`Row ${rowNumber}: Email cannot exceed 60 characters`);
        continue;
      }

      if (gstNumber.length > 30) {
        errors.push(`Row ${rowNumber}: GST Number cannot exceed 30 characters`);
        continue;
      }

      if (panNumber.length > 20) {
        errors.push(`Row ${rowNumber}: PAN Number cannot exceed 20 characters`);
        continue;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

      if (email && !emailRegex.test(email)) {
        errors.push(`Row ${rowNumber}: Invalid Email`);
        continue;
      }

      let creditDays = 0;

      if (creditDaysValue) {
        creditDays = Number(creditDaysValue);

        if (!Number.isInteger(creditDays) || creditDays < 0) {
          errors.push(
            `Row ${rowNumber}: Credit Days must be a positive whole number`
          );
          continue;
        }
      }

      const [existingSupplier] = await database
        .select()
        .from(PharmacySupplierModel)
        .where(
          and(
            eq(PharmacySupplierModel.pharmacyId, pharmacyId),
            eq(PharmacySupplierModel.supplierName, supplierName)
          )
        )
        .limit(1);

      if (email) {
        const [existingEmailSupplier] = await database
          .select({
            id: PharmacySupplierModel.id,
            supplierName: PharmacySupplierModel.supplierName,
          })
          .from(PharmacySupplierModel)
          .where(eq(PharmacySupplierModel.email, email))
          .limit(1);

        if (
          existingEmailSupplier &&
          existingEmailSupplier.id !== existingSupplier?.id
        ) {
          errors.push(
            `Row ${rowNumber}: Email "${email}" is already used by supplier "${existingEmailSupplier.supplierName}"`
          );
          continue;
        }
      }

      if (existingSupplier) {
        const hasChanges =
          existingSupplier.contactPerson !== contactPerson ||
          existingSupplier.phone !== phone ||
          (existingSupplier.email ?? '') !== (email || '') ||
          (existingSupplier.address ?? '') !== (address || '') ||
          (existingSupplier.gstNumber ?? '') !== (gstNumber || '') ||
          (existingSupplier.panNumber ?? '') !== (panNumber || '') ||
          (existingSupplier.creditDays ?? 0) !== creditDays;

        if (!hasChanges) {
          skippedSuppliers.push(
            `Row ${rowNumber}: ${supplierName} (No changes found)`
          );
          continue;
        }

        await database
          .update(PharmacySupplierModel)
          .set({
            contactPerson,
            phone,
            email: email || null,
            address: address || null,
            gstNumber: gstNumber || null,
            panNumber: panNumber || null,
            creditDays,
            updatedAt: new Date(),
          })
          .where(eq(PharmacySupplierModel.id, existingSupplier.id));

        updatedSuppliers.push(`Row ${rowNumber}: ${supplierName}`);

        continue;
      }

      await database.insert(PharmacySupplierModel).values({
        pharmacyId,
        supplierName,
        contactPerson,
        phone,
        email: email || null,
        address: address || null,
        gstNumber: gstNumber || null,
        panNumber: panNumber || null,
        creditDays,
      });

      insertedSuppliers.push(`Row ${rowNumber}: ${supplierName}`);
    }

    return {
      totalInserted: insertedSuppliers.length,
      totalUpdated: updatedSuppliers.length,
      totalSkipped: skippedSuppliers.length,
      totalErrors: errors.length,

      insertedSuppliers,
      updatedSuppliers,
      skippedSuppliers,
      errors,
    };
  }

  static async exportAllSuppliers(pharmacyId: string) {
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const suppliers = await database
      .select({
        id: PharmacySupplierModel.id,
        supplierName: PharmacySupplierModel.supplierName,
        contactPerson: PharmacySupplierModel.contactPerson,
        phone: PharmacySupplierModel.phone,
        email: PharmacySupplierModel.email,
        address: PharmacySupplierModel.address,
        gstNumber: PharmacySupplierModel.gstNumber,
        panNumber: PharmacySupplierModel.panNumber,
        creditDays: PharmacySupplierModel.creditDays,
        status: PharmacySupplierModel.status,
      })
      .from(PharmacySupplierModel)
      .where(and(eq(PharmacySupplierModel.pharmacyId, pharmacyId)))
      .orderBy(desc(PharmacySupplierModel.createdAt));

    return suppliers;
  }

  static async getSupplierStats(pharmacyId: string) {
    // Verify pharmacy exists
    const [pharmacy] = await database
      .select({ id: PharmacyModel.id })
      .from(PharmacyModel)
      .where(
        and(
          eq(PharmacyModel.id, pharmacyId),
          eq(PharmacyModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!pharmacy) {
      throw new HttpError(404, 'Pharmacy not found');
    }

    const now = new Date();

    // Current week
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - 7);

    // Previous week
    const previousWeekStart = new Date(now);
    previousWeekStart.setDate(now.getDate() - 14);

    const [
      totalResult,
      gstResult,
      activeResult,
      inactiveResult,
      currentWeekResult,
      previousWeekResult,
    ] = await Promise.all([
      // Total suppliers
      database
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(PharmacySupplierModel)
        .where(eq(PharmacySupplierModel.pharmacyId, pharmacyId)),

      // GST registered suppliers
      database
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(PharmacySupplierModel)
        .where(
          and(
            eq(PharmacySupplierModel.pharmacyId, pharmacyId),
            isNotNull(PharmacySupplierModel.gstNumber)
          )
        ),

      // Active suppliers
      database
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(PharmacySupplierModel)
        .where(
          and(
            eq(PharmacySupplierModel.pharmacyId, pharmacyId),
            eq(PharmacySupplierModel.status, 'active')
          )
        ),

      // Inactive suppliers
      database
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(PharmacySupplierModel)
        .where(
          and(
            eq(PharmacySupplierModel.pharmacyId, pharmacyId),
            eq(PharmacySupplierModel.status, 'inactive')
          )
        ),

      // Current week suppliers
      database
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(PharmacySupplierModel)
        .where(
          and(
            eq(PharmacySupplierModel.pharmacyId, pharmacyId),
            gte(PharmacySupplierModel.createdAt, currentWeekStart)
          )
        ),

      // Previous week suppliers
      database
        .select({
          count: sql<number>`COUNT(*)`,
        })
        .from(PharmacySupplierModel)
        .where(
          and(
            eq(PharmacySupplierModel.pharmacyId, pharmacyId),
            gte(PharmacySupplierModel.createdAt, previousWeekStart),
            lt(PharmacySupplierModel.createdAt, currentWeekStart)
          )
        ),
    ]);

    const totalSuppliers = Number(totalResult[0]?.count ?? 0);
    const gstRegisteredSuppliers = Number(gstResult[0]?.count ?? 0);
    const activeSuppliers = Number(activeResult[0]?.count ?? 0);
    const inactiveSuppliers = Number(inactiveResult[0]?.count ?? 0);

    const currentWeekSuppliers = Number(currentWeekResult[0]?.count ?? 0);

    const previousWeekSuppliers = Number(previousWeekResult[0]?.count ?? 0);

    let percentageChange = 0;

    if (previousWeekSuppliers > 0) {
      percentageChange =
        ((currentWeekSuppliers - previousWeekSuppliers) /
          previousWeekSuppliers) *
        100;
    } else if (currentWeekSuppliers > 0) {
      percentageChange = 100;
    }

    return {
      totalSuppliers: {
        count: totalSuppliers,
        percentageChange: Number(percentageChange.toFixed(2)),
        trend: percentageChange >= 0 ? 'increase' : 'decrease',
      },

      gstRegisteredSuppliers: {
        count: gstRegisteredSuppliers,
        percentageOfTotal:
          totalSuppliers > 0
            ? Number(
                ((gstRegisteredSuppliers / totalSuppliers) * 100).toFixed(2)
              )
            : 0,
      },

      activeSuppliers: {
        count: activeSuppliers,
        percentageOfTotal:
          totalSuppliers > 0
            ? Number(((activeSuppliers / totalSuppliers) * 100).toFixed(2))
            : 0,
      },

      inactiveSuppliers: {
        count: inactiveSuppliers,
        percentageOfTotal:
          totalSuppliers > 0
            ? Number(((inactiveSuppliers / totalSuppliers) * 100).toFixed(2))
            : 0,
      },
    };
  }
}
