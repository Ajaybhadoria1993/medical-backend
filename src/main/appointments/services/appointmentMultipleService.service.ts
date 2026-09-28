import { and, eq, ne, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';
import { appointmentMultipleService } from '../models/appointmentMultipleService.model';
import { AppointmentModel } from '../models/appointment.model';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import { AddMultipleServicesDto } from '../schemas/appointment.schemas';
import { isAppointmentInClinic } from '../../../utils/clinicOwnership';
import { signalAppointmentChange } from '../../realtime';

export class AppointmentMultipleServiceService {
  static async addMultipleServices(
    appointmentId: string,
    payload: AddMultipleServicesDto
  ) {
    // Get appointment
    const appointment = await database
      .select()
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment.length) {
      throw new HttpError(404, 'Appointment not found');
    }

    const { serviceIds, paymentMode, payment_notes } = payload;

    // Check for duplicate service IDs in the request payload
    const uniqueServiceIds = [...new Set(serviceIds)];
    if (uniqueServiceIds.length !== serviceIds.length) {
      const duplicates = serviceIds.filter(
        (id, index) => serviceIds.indexOf(id) !== index
      );
      throw new HttpError(
        400,
        `Duplicate services found in request: ${duplicates.join(', ')}`
      );
    }

    // Get existing multiple services for this appointment
    const existingMultipleServices = await database
      .select({
        serviceId: appointmentMultipleService.serviceId,
      })
      .from(appointmentMultipleService)
      .where(eq(appointmentMultipleService.appointmentId, appointmentId));

    const existingServiceIds = existingMultipleServices.map(
      (ms) => ms.serviceId
    );

    // Also get the main clinic service ID from the appointment
    const mainServiceId = appointment[0].clinicServiceId;

    // Check which requested services already exist
    const duplicateServiceIds = serviceIds.filter(
      (id) => existingServiceIds.includes(id) || id === mainServiceId
    );

    if (duplicateServiceIds.length > 0) {
      // Fetch the names of duplicate services
      const duplicateServices = await database
        .select({
          id: ClinicServiceModel.id,
          name: ClinicServiceModel.serviceName,
        })
        .from(ClinicServiceModel)
        .where(
          and(
            eq(ClinicServiceModel.isDeleted, false),
            sql`${ClinicServiceModel.id} IN (${sql.join(duplicateServiceIds, sql`, `)})`
          )
        );

      const duplicateNames = duplicateServices.map((s) => s.name);

      throw new HttpError(
        409,
        `Selected service is already added to this appointment: ${duplicateNames.join(', ')}`
      );
    }

    // Fetch services with prices
    const services = await database
      .select({
        id: ClinicServiceModel.id,
        price: ClinicServiceModel.price,
        serviceName: ClinicServiceModel.serviceName,
      })
      .from(ClinicServiceModel)
      .where(
        and(
          eq(ClinicServiceModel.isDeleted, false),
          sql`${ClinicServiceModel.id} IN (${sql.join(serviceIds, sql`, `)})`
        )
      );

    // Check if all requested services exist
    const foundServiceIds = services.map((s) => s.id);
    const missingServiceIds = serviceIds.filter(
      (id) => !foundServiceIds.includes(id)
    );

    if (missingServiceIds.length > 0) {
      throw new HttpError(
        404,
        `Services not found: ${missingServiceIds.join(', ')}`
      );
    }

    // Validate prices
    const validServices = services.filter(
      (
        service
      ): service is { id: string; price: number; serviceName: string } =>
        service.price !== null && service.price !== undefined
    );

    if (validServices.length !== services.length) {
      const servicesWithoutPrice = services
        .filter((s) => s.price === null || s.price === undefined)
        .map((s) => s.serviceName);
      throw new HttpError(
        400,
        `The following services have no price configured: ${servicesWithoutPrice.join(', ')}`
      );
    }

    const serviceMap = new Map(
      validServices.map((s) => [s.id, { price: s.price, name: s.serviceName }])
    );

    // Calculate total price and prepare entries
    let newServicesTotal = 0;
    const entries = serviceIds.map((serviceId) => {
      const service = serviceMap.get(serviceId);
      if (!service) {
        throw new HttpError(400, `Service with ID ${serviceId} not found`);
      }
      newServicesTotal += service.price;
      return {
        appointmentId,
        serviceId,
        price: service.price.toString(),
        paymentMode,
        payment_notes: payment_notes || null,
      };
    });

    // Insert multiple entries
    const result = await database
      .insert(appointmentMultipleService)
      .values(entries)
      .returning();

    // Update appointment total price
    const [paymentRecord] = await database
      .select()
      .from(AppointmentPaymentModel)
      .where(eq(AppointmentPaymentModel.appointmentId, appointmentId))
      .limit(1);

    const currentAppointmentPrice =
      parseFloat(paymentRecord?.price ?? '0') || 0;
    const updatedPrice = currentAppointmentPrice + newServicesTotal;

    if (paymentRecord) {
      await database
        .update(AppointmentPaymentModel)
        .set({ price: updatedPrice.toString(), updatedAt: new Date() })
        .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));
    } else {
      await database.insert(AppointmentPaymentModel).values({
        appointmentId,
        price: updatedPrice.toString(),
      });
    }

    // The price moved, so revenue and dues on every open dashboard are stale.
    signalAppointmentChange(appointment[0], 'billing.payment_updated');

    // Fetch the names of added services for response
    const addedServiceNames = validServices
      .filter((s) => serviceIds.includes(s.id))
      .map((s) => s.serviceName);

    return {
      success: true,
      message: `Successfully added ${addedServiceNames.length} service(s): ${addedServiceNames.join(', ')}`,
      addedServices: result.map((r, index) => ({
        ...r,
        serviceName: addedServiceNames[index],
      })),
      appointment: {
        id: appointmentId,
        previousPrice: currentAppointmentPrice,
        addedAmount: newServicesTotal,
        updatedPrice: updatedPrice,
      },
    };
  }

  static async getMultipleServicesByAppointmentId(
    appointmentId: string,
    clinicId: string
  ) {
    const belongsToClinic = await isAppointmentInClinic(
      appointmentId,
      clinicId
    );
    if (!belongsToClinic) {
      throw new HttpError(404, 'Appointment not found');
    }

    return AppointmentMultipleServiceService.listByAppointmentId(appointmentId);
  }

  // No clinic check: callers must have already scoped the appointment.
  static async listByAppointmentId(appointmentId: string) {
    return database
      .select({
        id: appointmentMultipleService.id,
        appointmentId: appointmentMultipleService.appointmentId,
        serviceId: appointmentMultipleService.serviceId,
        price: appointmentMultipleService.price,
        paymentMode: appointmentMultipleService.paymentMode,
        payment_notes: appointmentMultipleService.payment_notes,
        createdAt: appointmentMultipleService.createdAt,
        updatedAt: appointmentMultipleService.updatedAt,
        serviceName: ClinicServiceModel.serviceName,
        currency: ClinicServiceModel.currency,
        durationDays: ClinicServiceModel.durationDays,
      })
      .from(appointmentMultipleService)
      .leftJoin(
        ClinicServiceModel,
        eq(appointmentMultipleService.serviceId, ClinicServiceModel.id)
      )
      .where(eq(appointmentMultipleService.appointmentId, appointmentId));
  }

  static async getRemainingServices(appointmentId: string) {
    const appointment = await database
      .select()
      .from(AppointmentModel)
      .where(and(eq(AppointmentModel.id, appointmentId)))
      .limit(1);

    if (!appointment.length) {
      throw new HttpError(404, 'Appointment not found');
    }

    const doctorId = appointment[0].doctorId;

    if (!doctorId) {
      throw new HttpError(400, 'No doctor associated with this appointment');
    }

    const mainServiceId = appointment[0].clinicServiceId;

    if (!mainServiceId) {
      throw new HttpError(400, 'No service associated with this appointment');
    }

    const multipleServices = await database
      .select()
      .from(appointmentMultipleService)
      .where(eq(appointmentMultipleService.appointmentId, appointmentId));

    const excludedServiceIds = multipleServices.map(
      (service) => service.serviceId
    );

    excludedServiceIds.push(mainServiceId);

    const conditions = [
      eq(ClinicServiceModel.doctorId, doctorId),
      eq(ClinicServiceModel.isDeleted, false),
    ];

    excludedServiceIds.forEach((serviceId) => {
      if (serviceId) {
        conditions.push(ne(ClinicServiceModel.id, serviceId));
      }
    });

    const availableServices = await database
      .select()
      .from(ClinicServiceModel)
      .where(and(...conditions));

    if (!availableServices.length) {
      throw new HttpError(404, 'No remaining services found');
    }

    return availableServices;
  }

  static async convertAppointmentToFree(
    appointmentId: string,
    clinicId: string
  ) {
    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment || appointment.clinicId !== clinicId) {
      throw new HttpError(404, 'Appointment not found');
    }

    if (
      appointment.appointmentStatus === 'Cancelled' ||
      appointment.appointmentStatus === 'Completed'
    ) {
      throw new HttpError(
        400,
        `Cannot convert a ${appointment.appointmentStatus.toLowerCase()} appointment to a free consultation`
      );
    }

    if (!appointment.doctorId) {
      throw new HttpError(400, 'No doctor associated with this appointment');
    }

    const [payment] = await database
      .select({ paymentStatus: AppointmentPaymentModel.paymentStatus })
      .from(AppointmentPaymentModel)
      .where(eq(AppointmentPaymentModel.appointmentId, appointmentId))
      .limit(1);

    if (payment?.paymentStatus?.toLowerCase() !== 'refunded') {
      throw new HttpError(
        400,
        'Appointment payment must be refunded before converting to a free consultation'
      );
    }

    const FREE_CONSULTATION_SERVICE_NAME = 'Free Consultation';
    const doctorId = appointment.doctorId;

    return database.transaction(async (trx) => {
      const [existingService] = await trx
        .select()
        .from(ClinicServiceModel)
        .where(
          and(
            eq(ClinicServiceModel.clinicId, appointment.clinicId),
            eq(ClinicServiceModel.doctorId, doctorId),
            eq(ClinicServiceModel.serviceName, FREE_CONSULTATION_SERVICE_NAME)
          )
        )
        .limit(1);

      let freeServiceId: string;

      if (existingService) {
        await trx
          .update(ClinicServiceModel)
          .set({
            price: 0,
            durationDays: 1,
            isDeleted: false,
            updatedAt: new Date(),
          })
          .where(eq(ClinicServiceModel.id, existingService.id));
        freeServiceId = existingService.id;
      } else {
        const [createdService] = await trx
          .insert(ClinicServiceModel)
          .values({
            clinicId: appointment.clinicId,
            doctorId,
            serviceName: FREE_CONSULTATION_SERVICE_NAME,
            price: 0,
            currency: 'INR',
            durationDays: 1,
          })
          .returning();
        freeServiceId = createdService.id;
      }

      const [existingMultipleService] = await trx
        .select()
        .from(appointmentMultipleService)
        .where(
          and(
            eq(appointmentMultipleService.appointmentId, appointmentId),
            eq(appointmentMultipleService.serviceId, freeServiceId)
          )
        )
        .limit(1);

      if (existingMultipleService) {
        return existingMultipleService;
      }

      const [createdMultipleService] = await trx
        .insert(appointmentMultipleService)
        .values({
          appointmentId,
          serviceId: freeServiceId,
          price: '0',
        })
        .returning();

      return createdMultipleService;
    });
  }
}
