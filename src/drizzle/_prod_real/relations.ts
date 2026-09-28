import { relations } from "drizzle-orm/relations";
import { users, clinicAssign, clinics, clinicSettings, clinicCommissions, subscriptionPlans, clinicSubscriptions, appointments, labOrders, testCatalog, independentPatients, financialLedgers, appointmentPayments, pharmacies, pharmacySalesReturns, pharmacySales, pharmacySalesReturnItems, pharmacySalesItems, pharmacyStockMedicine, refreshTokens, reportCards, reports, prescriptionTemplates, clinicBankHistory, clinicRazorpayAccounts, labs, labReportLayoutTemplates, permissionAuditLog, userPermissions, permissions, pharmacyPurchaseReturns, pharmacyStock, pharmacyPurchaseReturnItems, clinicsService, clinicCancellationPolicies, doctorSessionOverrides, visitingRequests, appointmentClinicalData, appointmentActivityHistory, appointmentMultipleService, appointmentNoShowActions, doctorGallery, doctorManualPrescription, medicalCertificate, noShowPolicies, patientGallery, banners, bannerAnalytics, bannerDismissals, cancellationAudits, cancellationRequests, cancellationRefunds, clinicSymptoms, clinicSymptomCounts, clinicAppointments, clinicAvailability, clinicAvailabilityBreak, clinicDateAvailability, clinicDateAvailabilityTimeSlots, clinicReminders, doctorProfileUpdateRequests, doctorFavorites, doctorQualifications, doctorPrescriptionType, doctorManualTemplate, doctorPreferences, doctorReviews, doctorTemplate, feedbacks, labDepartments, labDepartmentsMaster, userLabAssignments, labInvoices, labTestCatalog, labOrderResults, labReportTemplates, labOrderResultValues, labReportTemplateParameters, labSamples, medicines, userMfa, userMfaRecoveryCodes, notifications, patientFamilyLinks, pharmacyMedicines, hsnTaxMaster, pharmacyMedicineTags, pharmacyTagsMap, pharmacyPatientSubscription, pharmacySubscriptionMedicines, pharmacySubscriptionSalesMap, prescriptionQueue, pharmacySuppliers, pharmacyAssign, quickPrintTemplates, prescriptions, favouritePrescription, settings, addOns, clinicAddOns, coupons, couponUsage, planFeatures, labOrderTrackingEvents, referrals, tokens, userDevices, userProfessionals, userProfiles } from "./schema";

export const clinicAssignRelations = relations(clinicAssign, ({one}) => ({
	user: one(users, {
		fields: [clinicAssign.userId],
		references: [users.id]
	}),
	clinic: one(clinics, {
		fields: [clinicAssign.clinicId],
		references: [clinics.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	clinicAssigns: many(clinicAssign),
	labOrders_patientId: many(labOrders, {
		relationName: "labOrders_patientId_users_id"
	}),
	labOrders_doctorId: many(labOrders, {
		relationName: "labOrders_doctorId_users_id"
	}),
	labOrders_labAssistantId: many(labOrders, {
		relationName: "labOrders_labAssistantId_users_id"
	}),
	labOrders_paymentCollectedBy: many(labOrders, {
		relationName: "labOrders_paymentCollectedBy_users_id"
	}),
	pharmacySalesReturns: many(pharmacySalesReturns),
	refreshTokens: many(refreshTokens),
	reportCards: many(reportCards),
	prescriptionTemplates: many(prescriptionTemplates),
	permissionAuditLogs_targetUserId: many(permissionAuditLog, {
		relationName: "permissionAuditLog_targetUserId_users_id"
	}),
	permissionAuditLogs_performedBy: many(permissionAuditLog, {
		relationName: "permissionAuditLog_performedBy_users_id"
	}),
	userPermissions_userId: many(userPermissions, {
		relationName: "userPermissions_userId_users_id"
	}),
	userPermissions_grantedBy: many(userPermissions, {
		relationName: "userPermissions_grantedBy_users_id"
	}),
	pharmacyPurchaseReturns: many(pharmacyPurchaseReturns),
	appointments_patientId: many(appointments, {
		relationName: "appointments_patientId_users_id"
	}),
	appointments_doctorId: many(appointments, {
		relationName: "appointments_doctorId_users_id"
	}),
	clinics: many(clinics),
	doctorSessionOverrides_doctorId: many(doctorSessionOverrides, {
		relationName: "doctorSessionOverrides_doctorId_users_id"
	}),
	doctorSessionOverrides_createdBy: many(doctorSessionOverrides, {
		relationName: "doctorSessionOverrides_createdBy_users_id"
	}),
	visitingRequests_doctorId: many(visitingRequests, {
		relationName: "visitingRequests_doctorId_users_id"
	}),
	visitingRequests_patientId: many(visitingRequests, {
		relationName: "visitingRequests_patientId_users_id"
	}),
	clinicsServices: many(clinicsService),
	appointmentActivityHistories: many(appointmentActivityHistory),
	appointmentNoShowActions_patientId: many(appointmentNoShowActions, {
		relationName: "appointmentNoShowActions_patientId_users_id"
	}),
	appointmentNoShowActions_doctorId: many(appointmentNoShowActions, {
		relationName: "appointmentNoShowActions_doctorId_users_id"
	}),
	appointmentNoShowActions_markedByUserId: many(appointmentNoShowActions, {
		relationName: "appointmentNoShowActions_markedByUserId_users_id"
	}),
	doctorGalleries: many(doctorGallery),
	patientGalleries_patientId: many(patientGallery, {
		relationName: "patientGallery_patientId_users_id"
	}),
	patientGalleries_doctorId: many(patientGallery, {
		relationName: "patientGallery_doctorId_users_id"
	}),
	banners_createdBy: many(banners, {
		relationName: "banners_createdBy_users_id"
	}),
	banners_updatedBy: many(banners, {
		relationName: "banners_updatedBy_users_id"
	}),
	bannerAnalytics: many(bannerAnalytics),
	bannerDismissals: many(bannerDismissals),
	cancellationAudits: many(cancellationAudits),
	cancellationRequests: many(cancellationRequests),
	clinicAppointments_doctorId: many(clinicAppointments, {
		relationName: "clinicAppointments_doctorId_users_id"
	}),
	clinicAppointments_patientId: many(clinicAppointments, {
		relationName: "clinicAppointments_patientId_users_id"
	}),
	clinicAvailabilities: many(clinicAvailability),
	clinicDateAvailabilities: many(clinicDateAvailability),
	doctorProfileUpdateRequests: many(doctorProfileUpdateRequests),
	doctorFavorites_patientId: many(doctorFavorites, {
		relationName: "doctorFavorites_patientId_users_id"
	}),
	doctorFavorites_doctorId: many(doctorFavorites, {
		relationName: "doctorFavorites_doctorId_users_id"
	}),
	doctorQualifications: many(doctorQualifications),
	doctorPrescriptionTypes: many(doctorPrescriptionType),
	doctorManualTemplates: many(doctorManualTemplate),
	doctorPreferences: many(doctorPreferences),
	doctorReviews_doctorId: many(doctorReviews, {
		relationName: "doctorReviews_doctorId_users_id"
	}),
	doctorReviews_patientId: many(doctorReviews, {
		relationName: "doctorReviews_patientId_users_id"
	}),
	doctorTemplates: many(doctorTemplate),
	feedbacks_patientId: many(feedbacks, {
		relationName: "feedbacks_patientId_users_id"
	}),
	feedbacks_doctorId: many(feedbacks, {
		relationName: "feedbacks_doctorId_users_id"
	}),
	feedbacks_responseBy: many(feedbacks, {
		relationName: "feedbacks_responseBy_users_id"
	}),
	userLabAssignments: many(userLabAssignments),
	labInvoices_patientId: many(labInvoices, {
		relationName: "labInvoices_patientId_users_id"
	}),
	labInvoices_doctorId: many(labInvoices, {
		relationName: "labInvoices_doctorId_users_id"
	}),
	labInvoices_createdBy: many(labInvoices, {
		relationName: "labInvoices_createdBy_users_id"
	}),
	testCatalogs: many(testCatalog),
	labOrderResults_enteredBy: many(labOrderResults, {
		relationName: "labOrderResults_enteredBy_users_id"
	}),
	labOrderResults_verifiedBy: many(labOrderResults, {
		relationName: "labOrderResults_verifiedBy_users_id"
	}),
	labReportTemplateParameters_createdBy: many(labReportTemplateParameters, {
		relationName: "labReportTemplateParameters_createdBy_users_id"
	}),
	labReportTemplateParameters_updatedBy: many(labReportTemplateParameters, {
		relationName: "labReportTemplateParameters_updatedBy_users_id"
	}),
	labSamples_patientId: many(labSamples, {
		relationName: "labSamples_patientId_users_id"
	}),
	labSamples_collectedBy: many(labSamples, {
		relationName: "labSamples_collectedBy_users_id"
	}),
	labSamples_receivedAtLabBy: many(labSamples, {
		relationName: "labSamples_receivedAtLabBy_users_id"
	}),
	medicines: many(medicines),
	userMfas: many(userMfa),
	userMfaRecoveryCodes: many(userMfaRecoveryCodes),
	notifications: many(notifications),
	patientFamilyLinks_primaryPatientId: many(patientFamilyLinks, {
		relationName: "patientFamilyLinks_primaryPatientId_users_id"
	}),
	patientFamilyLinks_linkedPatientId: many(patientFamilyLinks, {
		relationName: "patientFamilyLinks_linkedPatientId_users_id"
	}),
	pharmacyPatientSubscriptions: many(pharmacyPatientSubscription),
	pharmacySales: many(pharmacySales),
	prescriptionQueues_doctorId: many(prescriptionQueue, {
		relationName: "prescriptionQueue_doctorId_users_id"
	}),
	prescriptionQueues_pharmacyUserId: many(prescriptionQueue, {
		relationName: "prescriptionQueue_pharmacyUserId_users_id"
	}),
	pharmacyAssigns: many(pharmacyAssign),
	quickPrintTemplates: many(quickPrintTemplates),
	prescriptions_petientId: many(prescriptions, {
		relationName: "prescriptions_petientId_users_id"
	}),
	prescriptions_prescribedBy: many(prescriptions, {
		relationName: "prescriptions_prescribedBy_users_id"
	}),
	reports: many(reports),
	favouritePrescriptions: many(favouritePrescription),
	settings: many(settings),
	labOrderTrackingEvents: many(labOrderTrackingEvents),
	labTestCatalogs_createdBy: many(labTestCatalog, {
		relationName: "labTestCatalog_createdBy_users_id"
	}),
	labTestCatalogs_updatedBy: many(labTestCatalog, {
		relationName: "labTestCatalog_updatedBy_users_id"
	}),
	referrals_referredTo: many(referrals, {
		relationName: "referrals_referredTo_users_id"
	}),
	referrals_referredBy: many(referrals, {
		relationName: "referrals_referredBy_users_id"
	}),
	tokens: many(tokens),
	userDevices: many(userDevices),
	userProfessionals: many(userProfessionals),
	userProfiles: many(userProfiles),
}));

export const clinicsRelations = relations(clinics, ({one, many}) => ({
	clinicAssigns: many(clinicAssign),
	clinicSettings: many(clinicSettings),
	clinicCommissions: many(clinicCommissions),
	labOrders: many(labOrders),
	financialLedgers: many(financialLedgers),
	clinicBankHistories: many(clinicBankHistory),
	clinicRazorpayAccounts: many(clinicRazorpayAccounts),
	permissionAuditLogs: many(permissionAuditLog),
	userPermissions: many(userPermissions),
	appointments: many(appointments),
	user: one(users, {
		fields: [clinics.userId],
		references: [users.id]
	}),
	doctorSessionOverrides: many(doctorSessionOverrides),
	visitingRequests: many(visitingRequests),
	clinicsServices: many(clinicsService),
	clinicCancellationPolicies: many(clinicCancellationPolicies),
	appointmentNoShowActions: many(appointmentNoShowActions),
	noShowPolicies: many(noShowPolicies),
	bannerAnalytics: many(bannerAnalytics),
	cancellationAudits: many(cancellationAudits),
	cancellationRequests: many(cancellationRequests),
	cancellationRefunds: many(cancellationRefunds),
	clinicSymptoms: many(clinicSymptoms),
	clinicAppointments: many(clinicAppointments),
	clinicAvailabilities: many(clinicAvailability),
	clinicDateAvailabilities: many(clinicDateAvailability),
	clinicReminders: many(clinicReminders),
	doctorProfileUpdateRequests: many(doctorProfileUpdateRequests),
	feedbacks: many(feedbacks),
	labs: many(labs),
	userLabAssignments: many(userLabAssignments),
	labInvoices: many(labInvoices),
	testCatalogs: many(testCatalog),
	labSamples: many(labSamples),
	pharmacies: many(pharmacies),
	prescriptionQueues: many(prescriptionQueue),
	pharmacyAssigns: many(pharmacyAssign),
	labOrderTrackingEvents: many(labOrderTrackingEvents),
	labTestCatalogs: many(labTestCatalog),
}));

export const clinicSettingsRelations = relations(clinicSettings, ({one}) => ({
	clinic: one(clinics, {
		fields: [clinicSettings.clinicId],
		references: [clinics.id]
	}),
}));

export const clinicCommissionsRelations = relations(clinicCommissions, ({one}) => ({
	clinic: one(clinics, {
		fields: [clinicCommissions.clinicId],
		references: [clinics.id]
	}),
}));

export const clinicSubscriptionsRelations = relations(clinicSubscriptions, ({one}) => ({
	subscriptionPlan_planId: one(subscriptionPlans, {
		fields: [clinicSubscriptions.planId],
		references: [subscriptionPlans.id],
		relationName: "clinicSubscriptions_planId_subscriptionPlans_id"
	}),
	subscriptionPlan_scheduledPlanId: one(subscriptionPlans, {
		fields: [clinicSubscriptions.scheduledPlanId],
		references: [subscriptionPlans.id],
		relationName: "clinicSubscriptions_scheduledPlanId_subscriptionPlans_id"
	}),
}));

export const subscriptionPlansRelations = relations(subscriptionPlans, ({many}) => ({
	clinicSubscriptions_planId: many(clinicSubscriptions, {
		relationName: "clinicSubscriptions_planId_subscriptionPlans_id"
	}),
	clinicSubscriptions_scheduledPlanId: many(clinicSubscriptions, {
		relationName: "clinicSubscriptions_scheduledPlanId_subscriptionPlans_id"
	}),
	planFeatures: many(planFeatures),
}));

export const labOrdersRelations = relations(labOrders, ({one, many}) => ({
	appointment: one(appointments, {
		fields: [labOrders.appointmentId],
		references: [appointments.id]
	}),
	testCatalog: one(testCatalog, {
		fields: [labOrders.testId],
		references: [testCatalog.id]
	}),
	independentPatient: one(independentPatients, {
		fields: [labOrders.independentPatientId],
		references: [independentPatients.id]
	}),
	user_patientId: one(users, {
		fields: [labOrders.patientId],
		references: [users.id],
		relationName: "labOrders_patientId_users_id"
	}),
	user_doctorId: one(users, {
		fields: [labOrders.doctorId],
		references: [users.id],
		relationName: "labOrders_doctorId_users_id"
	}),
	clinic: one(clinics, {
		fields: [labOrders.clinicId],
		references: [clinics.id]
	}),
	user_labAssistantId: one(users, {
		fields: [labOrders.labAssistantId],
		references: [users.id],
		relationName: "labOrders_labAssistantId_users_id"
	}),
	user_paymentCollectedBy: one(users, {
		fields: [labOrders.paymentCollectedBy],
		references: [users.id],
		relationName: "labOrders_paymentCollectedBy_users_id"
	}),
	labInvoices: many(labInvoices),
	labOrderResults_labOrderId: many(labOrderResults, {
		relationName: "labOrderResults_labOrderId_labOrders_id"
	}),
	labOrderResults_appointmentTestId: many(labOrderResults, {
		relationName: "labOrderResults_appointmentTestId_labOrders_id"
	}),
	labSamples_labOrderId: many(labSamples, {
		relationName: "labSamples_labOrderId_labOrders_id"
	}),
	labSamples_appointmentTestId: many(labSamples, {
		relationName: "labSamples_appointmentTestId_labOrders_id"
	}),
	labOrderTrackingEvents: many(labOrderTrackingEvents),
}));

export const appointmentsRelations = relations(appointments, ({one, many}) => ({
	labOrders: many(labOrders),
	financialLedgers: many(financialLedgers),
	reportCards: many(reportCards),
	clinic: one(clinics, {
		fields: [appointments.clinicId],
		references: [clinics.id]
	}),
	user_patientId: one(users, {
		fields: [appointments.patientId],
		references: [users.id],
		relationName: "appointments_patientId_users_id"
	}),
	user_doctorId: one(users, {
		fields: [appointments.doctorId],
		references: [users.id],
		relationName: "appointments_doctorId_users_id"
	}),
	clinicsService: one(clinicsService, {
		fields: [appointments.clinicServiceId],
		references: [clinicsService.id]
	}),
	clinicCancellationPolicy: one(clinicCancellationPolicies, {
		fields: [appointments.clinicCancellationPolicyId],
		references: [clinicCancellationPolicies.id]
	}),
	appointmentPayments: many(appointmentPayments),
	visitingRequests_sourceAppointmentId: many(visitingRequests, {
		relationName: "visitingRequests_sourceAppointmentId_appointments_id"
	}),
	visitingRequests_generatedAppointmentId: many(visitingRequests, {
		relationName: "visitingRequests_generatedAppointmentId_appointments_id"
	}),
	appointmentClinicalData: many(appointmentClinicalData),
	appointmentActivityHistories: many(appointmentActivityHistory),
	appointmentMultipleServices: many(appointmentMultipleService),
	appointmentNoShowActions: many(appointmentNoShowActions),
	doctorManualPrescriptions: many(doctorManualPrescription),
	medicalCertificates: many(medicalCertificate),
	patientGalleries: many(patientGallery),
	cancellationRequests: many(cancellationRequests),
	cancellationRefunds: many(cancellationRefunds),
	doctorReviews: many(doctorReviews),
	feedbacks: many(feedbacks),
	prescriptionQueues: many(prescriptionQueue),
}));

export const testCatalogRelations = relations(testCatalog, ({one, many}) => ({
	labOrders: many(labOrders),
	labInvoices: many(labInvoices),
	clinic: one(clinics, {
		fields: [testCatalog.clinicId],
		references: [clinics.id]
	}),
	user: one(users, {
		fields: [testCatalog.doctorId],
		references: [users.id]
	}),
	labTestCatalog: one(labTestCatalog, {
		fields: [testCatalog.labTestId],
		references: [labTestCatalog.id]
	}),
	labSamples: many(labSamples),
}));

export const independentPatientsRelations = relations(independentPatients, ({many}) => ({
	labOrders: many(labOrders),
}));

export const financialLedgersRelations = relations(financialLedgers, ({one}) => ({
	appointment: one(appointments, {
		fields: [financialLedgers.appointmentId],
		references: [appointments.id]
	}),
	clinic: one(clinics, {
		fields: [financialLedgers.clinicId],
		references: [clinics.id]
	}),
	appointmentPayment: one(appointmentPayments, {
		fields: [financialLedgers.paymentId],
		references: [appointmentPayments.id]
	}),
}));

export const appointmentPaymentsRelations = relations(appointmentPayments, ({one, many}) => ({
	financialLedgers: many(financialLedgers),
	appointment: one(appointments, {
		fields: [appointmentPayments.appointmentId],
		references: [appointments.id]
	}),
	cancellationRefunds: many(cancellationRefunds),
}));

export const pharmacySalesReturnsRelations = relations(pharmacySalesReturns, ({one, many}) => ({
	pharmacy: one(pharmacies, {
		fields: [pharmacySalesReturns.pharmacyId],
		references: [pharmacies.id]
	}),
	pharmacySale: one(pharmacySales, {
		fields: [pharmacySalesReturns.saleId],
		references: [pharmacySales.id]
	}),
	user: one(users, {
		fields: [pharmacySalesReturns.createdBy],
		references: [users.id]
	}),
	pharmacySalesReturnItems: many(pharmacySalesReturnItems),
}));

export const pharmaciesRelations = relations(pharmacies, ({one, many}) => ({
	pharmacySalesReturns: many(pharmacySalesReturns),
	pharmacyPurchaseReturns: many(pharmacyPurchaseReturns),
	clinic: one(clinics, {
		fields: [pharmacies.clinicId],
		references: [clinics.id]
	}),
	pharmacyMedicines: many(pharmacyMedicines),
	pharmacyMedicineTags: many(pharmacyMedicineTags),
	pharmacyPatientSubscriptions: many(pharmacyPatientSubscription),
	pharmacySales: many(pharmacySales),
	pharmacyStocks: many(pharmacyStock),
	pharmacySuppliers: many(pharmacySuppliers),
	pharmacyAssigns: many(pharmacyAssign),
}));

export const pharmacySalesRelations = relations(pharmacySales, ({one, many}) => ({
	pharmacySalesReturns: many(pharmacySalesReturns),
	pharmacySubscriptionSalesMaps: many(pharmacySubscriptionSalesMap),
	pharmacy: one(pharmacies, {
		fields: [pharmacySales.pharmacyId],
		references: [pharmacies.id]
	}),
	user: one(users, {
		fields: [pharmacySales.createdBy],
		references: [users.id]
	}),
	prescriptionQueue: one(prescriptionQueue, {
		fields: [pharmacySales.prescriptionId],
		references: [prescriptionQueue.id]
	}),
	pharmacySalesItems: many(pharmacySalesItems),
}));

export const pharmacySalesReturnItemsRelations = relations(pharmacySalesReturnItems, ({one}) => ({
	pharmacySalesReturn: one(pharmacySalesReturns, {
		fields: [pharmacySalesReturnItems.salesReturnId],
		references: [pharmacySalesReturns.id]
	}),
	pharmacySalesItem: one(pharmacySalesItems, {
		fields: [pharmacySalesReturnItems.salesItemId],
		references: [pharmacySalesItems.id]
	}),
	pharmacyStockMedicine: one(pharmacyStockMedicine, {
		fields: [pharmacySalesReturnItems.stockMedicineId],
		references: [pharmacyStockMedicine.id]
	}),
}));

export const pharmacySalesItemsRelations = relations(pharmacySalesItems, ({one, many}) => ({
	pharmacySalesReturnItems: many(pharmacySalesReturnItems),
	pharmacySale: one(pharmacySales, {
		fields: [pharmacySalesItems.pharmacySalesId],
		references: [pharmacySales.id]
	}),
	pharmacyStockMedicine: one(pharmacyStockMedicine, {
		fields: [pharmacySalesItems.pharmacyStockMedicineId],
		references: [pharmacyStockMedicine.id]
	}),
}));

export const pharmacyStockMedicineRelations = relations(pharmacyStockMedicine, ({one, many}) => ({
	pharmacySalesReturnItems: many(pharmacySalesReturnItems),
	pharmacyPurchaseReturnItems: many(pharmacyPurchaseReturnItems),
	pharmacySalesItems: many(pharmacySalesItems),
	pharmacyStock: one(pharmacyStock, {
		fields: [pharmacyStockMedicine.pharmacyStockId],
		references: [pharmacyStock.id]
	}),
	pharmacyMedicine: one(pharmacyMedicines, {
		fields: [pharmacyStockMedicine.pharmacyMedicineId],
		references: [pharmacyMedicines.id]
	}),
}));

export const refreshTokensRelations = relations(refreshTokens, ({one}) => ({
	user: one(users, {
		fields: [refreshTokens.userId],
		references: [users.id]
	}),
}));

export const reportCardsRelations = relations(reportCards, ({one, many}) => ({
	user: one(users, {
		fields: [reportCards.petientId],
		references: [users.id]
	}),
	appointment: one(appointments, {
		fields: [reportCards.appointmentId],
		references: [appointments.id]
	}),
	report: one(reports, {
		fields: [reportCards.reportId],
		references: [reports.id]
	}),
	visitingRequests: many(visitingRequests),
	prescriptionQueues: many(prescriptionQueue),
	prescriptions: many(prescriptions),
}));

export const reportsRelations = relations(reports, ({one, many}) => ({
	reportCards: many(reportCards),
	user: one(users, {
		fields: [reports.petientId],
		references: [users.id]
	}),
}));

export const prescriptionTemplatesRelations = relations(prescriptionTemplates, ({one}) => ({
	user: one(users, {
		fields: [prescriptionTemplates.doctorId],
		references: [users.id]
	}),
}));

export const clinicBankHistoryRelations = relations(clinicBankHistory, ({one}) => ({
	clinic: one(clinics, {
		fields: [clinicBankHistory.clinicId],
		references: [clinics.id]
	}),
}));

export const clinicRazorpayAccountsRelations = relations(clinicRazorpayAccounts, ({one}) => ({
	clinic: one(clinics, {
		fields: [clinicRazorpayAccounts.clinicId],
		references: [clinics.id]
	}),
}));

export const labReportLayoutTemplatesRelations = relations(labReportLayoutTemplates, ({one}) => ({
	lab: one(labs, {
		fields: [labReportLayoutTemplates.labId],
		references: [labs.id]
	}),
}));

export const labsRelations = relations(labs, ({one, many}) => ({
	labReportLayoutTemplates: many(labReportLayoutTemplates),
	clinic: one(clinics, {
		fields: [labs.clinicId],
		references: [clinics.id]
	}),
	labDepartments: many(labDepartments),
	userLabAssignments: many(userLabAssignments),
	labInvoices: many(labInvoices),
	labReportTemplateParameters: many(labReportTemplateParameters),
	labReportTemplates: many(labReportTemplates),
	labSamples: many(labSamples),
	labOrderTrackingEvents: many(labOrderTrackingEvents),
	labTestCatalogs: many(labTestCatalog),
}));

export const permissionAuditLogRelations = relations(permissionAuditLog, ({one}) => ({
	clinic: one(clinics, {
		fields: [permissionAuditLog.clinicId],
		references: [clinics.id]
	}),
	user_targetUserId: one(users, {
		fields: [permissionAuditLog.targetUserId],
		references: [users.id],
		relationName: "permissionAuditLog_targetUserId_users_id"
	}),
	user_performedBy: one(users, {
		fields: [permissionAuditLog.performedBy],
		references: [users.id],
		relationName: "permissionAuditLog_performedBy_users_id"
	}),
}));

export const userPermissionsRelations = relations(userPermissions, ({one}) => ({
	user_userId: one(users, {
		fields: [userPermissions.userId],
		references: [users.id],
		relationName: "userPermissions_userId_users_id"
	}),
	clinic: one(clinics, {
		fields: [userPermissions.clinicId],
		references: [clinics.id]
	}),
	permission: one(permissions, {
		fields: [userPermissions.permissionId],
		references: [permissions.id]
	}),
	user_grantedBy: one(users, {
		fields: [userPermissions.grantedBy],
		references: [users.id],
		relationName: "userPermissions_grantedBy_users_id"
	}),
}));

export const permissionsRelations = relations(permissions, ({many}) => ({
	userPermissions: many(userPermissions),
}));

export const pharmacyPurchaseReturnsRelations = relations(pharmacyPurchaseReturns, ({one, many}) => ({
	pharmacy: one(pharmacies, {
		fields: [pharmacyPurchaseReturns.pharmacyId],
		references: [pharmacies.id]
	}),
	pharmacyStock: one(pharmacyStock, {
		fields: [pharmacyPurchaseReturns.stockId],
		references: [pharmacyStock.id]
	}),
	user: one(users, {
		fields: [pharmacyPurchaseReturns.createdBy],
		references: [users.id]
	}),
	pharmacyPurchaseReturnItems: many(pharmacyPurchaseReturnItems),
}));

export const pharmacyStockRelations = relations(pharmacyStock, ({one, many}) => ({
	pharmacyPurchaseReturns: many(pharmacyPurchaseReturns),
	pharmacyStockMedicines: many(pharmacyStockMedicine),
	pharmacy: one(pharmacies, {
		fields: [pharmacyStock.pharmacyId],
		references: [pharmacies.id]
	}),
	pharmacySupplier: one(pharmacySuppliers, {
		fields: [pharmacyStock.pharmacySupplierId],
		references: [pharmacySuppliers.id]
	}),
}));

export const pharmacyPurchaseReturnItemsRelations = relations(pharmacyPurchaseReturnItems, ({one}) => ({
	pharmacyPurchaseReturn: one(pharmacyPurchaseReturns, {
		fields: [pharmacyPurchaseReturnItems.purchaseReturnId],
		references: [pharmacyPurchaseReturns.id]
	}),
	pharmacyStockMedicine: one(pharmacyStockMedicine, {
		fields: [pharmacyPurchaseReturnItems.stockMedicineId],
		references: [pharmacyStockMedicine.id]
	}),
}));

export const clinicsServiceRelations = relations(clinicsService, ({one, many}) => ({
	appointments: many(appointments),
	clinic: one(clinics, {
		fields: [clinicsService.clinicId],
		references: [clinics.id]
	}),
	user: one(users, {
		fields: [clinicsService.doctorId],
		references: [users.id]
	}),
	appointmentMultipleServices: many(appointmentMultipleService),
	clinicAppointments: many(clinicAppointments),
}));

export const clinicCancellationPoliciesRelations = relations(clinicCancellationPolicies, ({one, many}) => ({
	appointments: many(appointments),
	clinic: one(clinics, {
		fields: [clinicCancellationPolicies.clinicId],
		references: [clinics.id]
	}),
}));

export const doctorSessionOverridesRelations = relations(doctorSessionOverrides, ({one}) => ({
	clinic: one(clinics, {
		fields: [doctorSessionOverrides.clinicId],
		references: [clinics.id]
	}),
	user_doctorId: one(users, {
		fields: [doctorSessionOverrides.doctorId],
		references: [users.id],
		relationName: "doctorSessionOverrides_doctorId_users_id"
	}),
	user_createdBy: one(users, {
		fields: [doctorSessionOverrides.createdBy],
		references: [users.id],
		relationName: "doctorSessionOverrides_createdBy_users_id"
	}),
}));

export const visitingRequestsRelations = relations(visitingRequests, ({one}) => ({
	appointment_sourceAppointmentId: one(appointments, {
		fields: [visitingRequests.sourceAppointmentId],
		references: [appointments.id],
		relationName: "visitingRequests_sourceAppointmentId_appointments_id"
	}),
	reportCard: one(reportCards, {
		fields: [visitingRequests.reportCardId],
		references: [reportCards.id]
	}),
	user_doctorId: one(users, {
		fields: [visitingRequests.doctorId],
		references: [users.id],
		relationName: "visitingRequests_doctorId_users_id"
	}),
	user_patientId: one(users, {
		fields: [visitingRequests.patientId],
		references: [users.id],
		relationName: "visitingRequests_patientId_users_id"
	}),
	clinic: one(clinics, {
		fields: [visitingRequests.clinicId],
		references: [clinics.id]
	}),
	appointment_generatedAppointmentId: one(appointments, {
		fields: [visitingRequests.generatedAppointmentId],
		references: [appointments.id],
		relationName: "visitingRequests_generatedAppointmentId_appointments_id"
	}),
}));

export const appointmentClinicalDataRelations = relations(appointmentClinicalData, ({one}) => ({
	appointment: one(appointments, {
		fields: [appointmentClinicalData.appointmentId],
		references: [appointments.id]
	}),
}));

export const appointmentActivityHistoryRelations = relations(appointmentActivityHistory, ({one}) => ({
	appointment: one(appointments, {
		fields: [appointmentActivityHistory.appointmentId],
		references: [appointments.id]
	}),
	user: one(users, {
		fields: [appointmentActivityHistory.performedBy],
		references: [users.id]
	}),
}));

export const appointmentMultipleServiceRelations = relations(appointmentMultipleService, ({one}) => ({
	appointment: one(appointments, {
		fields: [appointmentMultipleService.appointmentId],
		references: [appointments.id]
	}),
	clinicsService: one(clinicsService, {
		fields: [appointmentMultipleService.serviceId],
		references: [clinicsService.id]
	}),
}));

export const appointmentNoShowActionsRelations = relations(appointmentNoShowActions, ({one}) => ({
	appointment: one(appointments, {
		fields: [appointmentNoShowActions.appointmentId],
		references: [appointments.id]
	}),
	user_patientId: one(users, {
		fields: [appointmentNoShowActions.patientId],
		references: [users.id],
		relationName: "appointmentNoShowActions_patientId_users_id"
	}),
	user_doctorId: one(users, {
		fields: [appointmentNoShowActions.doctorId],
		references: [users.id],
		relationName: "appointmentNoShowActions_doctorId_users_id"
	}),
	clinic: one(clinics, {
		fields: [appointmentNoShowActions.clinicId],
		references: [clinics.id]
	}),
	user_markedByUserId: one(users, {
		fields: [appointmentNoShowActions.markedByUserId],
		references: [users.id],
		relationName: "appointmentNoShowActions_markedByUserId_users_id"
	}),
}));

export const doctorGalleryRelations = relations(doctorGallery, ({one}) => ({
	user: one(users, {
		fields: [doctorGallery.doctorId],
		references: [users.id]
	}),
}));

export const doctorManualPrescriptionRelations = relations(doctorManualPrescription, ({one}) => ({
	appointment: one(appointments, {
		fields: [doctorManualPrescription.appointmentId],
		references: [appointments.id]
	}),
}));

export const medicalCertificateRelations = relations(medicalCertificate, ({one}) => ({
	appointment: one(appointments, {
		fields: [medicalCertificate.appointmentId],
		references: [appointments.id]
	}),
}));

export const noShowPoliciesRelations = relations(noShowPolicies, ({one}) => ({
	clinic: one(clinics, {
		fields: [noShowPolicies.clinicId],
		references: [clinics.id]
	}),
}));

export const patientGalleryRelations = relations(patientGallery, ({one}) => ({
	appointment: one(appointments, {
		fields: [patientGallery.appointmentId],
		references: [appointments.id]
	}),
	user_patientId: one(users, {
		fields: [patientGallery.patientId],
		references: [users.id],
		relationName: "patientGallery_patientId_users_id"
	}),
	user_doctorId: one(users, {
		fields: [patientGallery.doctorId],
		references: [users.id],
		relationName: "patientGallery_doctorId_users_id"
	}),
}));

export const bannersRelations = relations(banners, ({one, many}) => ({
	user_createdBy: one(users, {
		fields: [banners.createdBy],
		references: [users.id],
		relationName: "banners_createdBy_users_id"
	}),
	user_updatedBy: one(users, {
		fields: [banners.updatedBy],
		references: [users.id],
		relationName: "banners_updatedBy_users_id"
	}),
	bannerAnalytics: many(bannerAnalytics),
	bannerDismissals: many(bannerDismissals),
}));

export const bannerAnalyticsRelations = relations(bannerAnalytics, ({one}) => ({
	banner: one(banners, {
		fields: [bannerAnalytics.bannerId],
		references: [banners.id]
	}),
	user: one(users, {
		fields: [bannerAnalytics.userId],
		references: [users.id]
	}),
	clinic: one(clinics, {
		fields: [bannerAnalytics.clinicId],
		references: [clinics.id]
	}),
}));

export const bannerDismissalsRelations = relations(bannerDismissals, ({one}) => ({
	banner: one(banners, {
		fields: [bannerDismissals.bannerId],
		references: [banners.id]
	}),
	user: one(users, {
		fields: [bannerDismissals.userId],
		references: [users.id]
	}),
}));

export const cancellationAuditsRelations = relations(cancellationAudits, ({one}) => ({
	clinic: one(clinics, {
		fields: [cancellationAudits.clinicId],
		references: [clinics.id]
	}),
	user: one(users, {
		fields: [cancellationAudits.userId],
		references: [users.id]
	}),
}));

export const cancellationRequestsRelations = relations(cancellationRequests, ({one, many}) => ({
	appointment: one(appointments, {
		fields: [cancellationRequests.appointmentId],
		references: [appointments.id]
	}),
	clinic: one(clinics, {
		fields: [cancellationRequests.clinicId],
		references: [clinics.id]
	}),
	user: one(users, {
		fields: [cancellationRequests.userId],
		references: [users.id]
	}),
	cancellationRefunds: many(cancellationRefunds),
}));

export const cancellationRefundsRelations = relations(cancellationRefunds, ({one}) => ({
	cancellationRequest: one(cancellationRequests, {
		fields: [cancellationRefunds.cancellationRequestId],
		references: [cancellationRequests.id]
	}),
	appointment: one(appointments, {
		fields: [cancellationRefunds.appointmentId],
		references: [appointments.id]
	}),
	clinic: one(clinics, {
		fields: [cancellationRefunds.clinicId],
		references: [clinics.id]
	}),
	appointmentPayment: one(appointmentPayments, {
		fields: [cancellationRefunds.paymentId],
		references: [appointmentPayments.id]
	}),
}));

export const clinicSymptomsRelations = relations(clinicSymptoms, ({one, many}) => ({
	clinic: one(clinics, {
		fields: [clinicSymptoms.clinicId],
		references: [clinics.id]
	}),
	clinicSymptomCounts: many(clinicSymptomCounts),
}));

export const clinicSymptomCountsRelations = relations(clinicSymptomCounts, ({one}) => ({
	clinicSymptom: one(clinicSymptoms, {
		fields: [clinicSymptomCounts.symptomId],
		references: [clinicSymptoms.id]
	}),
}));

export const clinicAppointmentsRelations = relations(clinicAppointments, ({one}) => ({
	user_doctorId: one(users, {
		fields: [clinicAppointments.doctorId],
		references: [users.id],
		relationName: "clinicAppointments_doctorId_users_id"
	}),
	user_patientId: one(users, {
		fields: [clinicAppointments.patientId],
		references: [users.id],
		relationName: "clinicAppointments_patientId_users_id"
	}),
	clinic: one(clinics, {
		fields: [clinicAppointments.clincId],
		references: [clinics.id]
	}),
	clinicsService: one(clinicsService, {
		fields: [clinicAppointments.doctorSubscriptionId],
		references: [clinicsService.id]
	}),
}));

export const clinicAvailabilityRelations = relations(clinicAvailability, ({one, many}) => ({
	clinic: one(clinics, {
		fields: [clinicAvailability.clinicId],
		references: [clinics.id]
	}),
	user: one(users, {
		fields: [clinicAvailability.doctorId],
		references: [users.id]
	}),
	clinicAvailabilityBreaks: many(clinicAvailabilityBreak),
}));

export const clinicAvailabilityBreakRelations = relations(clinicAvailabilityBreak, ({one}) => ({
	clinicAvailability: one(clinicAvailability, {
		fields: [clinicAvailabilityBreak.clinicId],
		references: [clinicAvailability.id]
	}),
}));

export const clinicDateAvailabilityRelations = relations(clinicDateAvailability, ({one, many}) => ({
	clinic: one(clinics, {
		fields: [clinicDateAvailability.clinicId],
		references: [clinics.id]
	}),
	user: one(users, {
		fields: [clinicDateAvailability.doctorId],
		references: [users.id]
	}),
	clinicDateAvailabilityTimeSlots: many(clinicDateAvailabilityTimeSlots),
}));

export const clinicDateAvailabilityTimeSlotsRelations = relations(clinicDateAvailabilityTimeSlots, ({one}) => ({
	clinicDateAvailability: one(clinicDateAvailability, {
		fields: [clinicDateAvailabilityTimeSlots.clinicDateAvailabilityId],
		references: [clinicDateAvailability.id]
	}),
}));

export const clinicRemindersRelations = relations(clinicReminders, ({one}) => ({
	clinic: one(clinics, {
		fields: [clinicReminders.clinicId],
		references: [clinics.id]
	}),
}));

export const doctorProfileUpdateRequestsRelations = relations(doctorProfileUpdateRequests, ({one}) => ({
	user: one(users, {
		fields: [doctorProfileUpdateRequests.doctorId],
		references: [users.id]
	}),
	clinic: one(clinics, {
		fields: [doctorProfileUpdateRequests.clinicId],
		references: [clinics.id]
	}),
}));

export const doctorFavoritesRelations = relations(doctorFavorites, ({one}) => ({
	user_patientId: one(users, {
		fields: [doctorFavorites.patientId],
		references: [users.id],
		relationName: "doctorFavorites_patientId_users_id"
	}),
	user_doctorId: one(users, {
		fields: [doctorFavorites.doctorId],
		references: [users.id],
		relationName: "doctorFavorites_doctorId_users_id"
	}),
}));

export const doctorQualificationsRelations = relations(doctorQualifications, ({one}) => ({
	user: one(users, {
		fields: [doctorQualifications.userId],
		references: [users.id]
	}),
}));

export const doctorPrescriptionTypeRelations = relations(doctorPrescriptionType, ({one}) => ({
	user: one(users, {
		fields: [doctorPrescriptionType.doctorId],
		references: [users.id]
	}),
}));

export const doctorManualTemplateRelations = relations(doctorManualTemplate, ({one}) => ({
	user: one(users, {
		fields: [doctorManualTemplate.doctorId],
		references: [users.id]
	}),
}));

export const doctorPreferencesRelations = relations(doctorPreferences, ({one}) => ({
	user: one(users, {
		fields: [doctorPreferences.doctorId],
		references: [users.id]
	}),
}));

export const doctorReviewsRelations = relations(doctorReviews, ({one}) => ({
	user_doctorId: one(users, {
		fields: [doctorReviews.doctorId],
		references: [users.id],
		relationName: "doctorReviews_doctorId_users_id"
	}),
	user_patientId: one(users, {
		fields: [doctorReviews.patientId],
		references: [users.id],
		relationName: "doctorReviews_patientId_users_id"
	}),
	appointment: one(appointments, {
		fields: [doctorReviews.appointmentId],
		references: [appointments.id]
	}),
}));

export const doctorTemplateRelations = relations(doctorTemplate, ({one}) => ({
	user: one(users, {
		fields: [doctorTemplate.doctorId],
		references: [users.id]
	}),
}));

export const feedbacksRelations = relations(feedbacks, ({one}) => ({
	clinic: one(clinics, {
		fields: [feedbacks.clinicId],
		references: [clinics.id]
	}),
	user_patientId: one(users, {
		fields: [feedbacks.patientId],
		references: [users.id],
		relationName: "feedbacks_patientId_users_id"
	}),
	user_doctorId: one(users, {
		fields: [feedbacks.doctorId],
		references: [users.id],
		relationName: "feedbacks_doctorId_users_id"
	}),
	appointment: one(appointments, {
		fields: [feedbacks.appointmentId],
		references: [appointments.id]
	}),
	user_responseBy: one(users, {
		fields: [feedbacks.responseBy],
		references: [users.id],
		relationName: "feedbacks_responseBy_users_id"
	}),
}));

export const labDepartmentsRelations = relations(labDepartments, ({one}) => ({
	lab: one(labs, {
		fields: [labDepartments.labId],
		references: [labs.id]
	}),
	labDepartmentsMaster: one(labDepartmentsMaster, {
		fields: [labDepartments.departmentId],
		references: [labDepartmentsMaster.id]
	}),
}));

export const labDepartmentsMasterRelations = relations(labDepartmentsMaster, ({many}) => ({
	labDepartments: many(labDepartments),
	labTestCatalogs: many(labTestCatalog),
}));

export const userLabAssignmentsRelations = relations(userLabAssignments, ({one}) => ({
	user: one(users, {
		fields: [userLabAssignments.userId],
		references: [users.id]
	}),
	lab: one(labs, {
		fields: [userLabAssignments.labId],
		references: [labs.id]
	}),
	clinic: one(clinics, {
		fields: [userLabAssignments.clinicId],
		references: [clinics.id]
	}),
}));

export const labInvoicesRelations = relations(labInvoices, ({one}) => ({
	labOrder: one(labOrders, {
		fields: [labInvoices.appointmentTestId],
		references: [labOrders.id]
	}),
	testCatalog: one(testCatalog, {
		fields: [labInvoices.testId],
		references: [testCatalog.id]
	}),
	clinic: one(clinics, {
		fields: [labInvoices.clinicId],
		references: [clinics.id]
	}),
	lab: one(labs, {
		fields: [labInvoices.labId],
		references: [labs.id]
	}),
	user_patientId: one(users, {
		fields: [labInvoices.patientId],
		references: [users.id],
		relationName: "labInvoices_patientId_users_id"
	}),
	user_doctorId: one(users, {
		fields: [labInvoices.doctorId],
		references: [users.id],
		relationName: "labInvoices_doctorId_users_id"
	}),
	user_createdBy: one(users, {
		fields: [labInvoices.createdBy],
		references: [users.id],
		relationName: "labInvoices_createdBy_users_id"
	}),
}));

export const labTestCatalogRelations = relations(labTestCatalog, ({one, many}) => ({
	testCatalogs: many(testCatalog),
	clinic: one(clinics, {
		fields: [labTestCatalog.clinicId],
		references: [clinics.id]
	}),
	lab: one(labs, {
		fields: [labTestCatalog.labId],
		references: [labs.id]
	}),
	labDepartmentsMaster: one(labDepartmentsMaster, {
		fields: [labTestCatalog.departmentId],
		references: [labDepartmentsMaster.id]
	}),
	user_createdBy: one(users, {
		fields: [labTestCatalog.createdBy],
		references: [users.id],
		relationName: "labTestCatalog_createdBy_users_id"
	}),
	user_updatedBy: one(users, {
		fields: [labTestCatalog.updatedBy],
		references: [users.id],
		relationName: "labTestCatalog_updatedBy_users_id"
	}),
}));

export const labOrderResultsRelations = relations(labOrderResults, ({one, many}) => ({
	labOrder_labOrderId: one(labOrders, {
		fields: [labOrderResults.labOrderId],
		references: [labOrders.id],
		relationName: "labOrderResults_labOrderId_labOrders_id"
	}),
	labOrder_appointmentTestId: one(labOrders, {
		fields: [labOrderResults.appointmentTestId],
		references: [labOrders.id],
		relationName: "labOrderResults_appointmentTestId_labOrders_id"
	}),
	labReportTemplate: one(labReportTemplates, {
		fields: [labOrderResults.templateId],
		references: [labReportTemplates.id]
	}),
	user_enteredBy: one(users, {
		fields: [labOrderResults.enteredBy],
		references: [users.id],
		relationName: "labOrderResults_enteredBy_users_id"
	}),
	user_verifiedBy: one(users, {
		fields: [labOrderResults.verifiedBy],
		references: [users.id],
		relationName: "labOrderResults_verifiedBy_users_id"
	}),
	labOrderResultValues: many(labOrderResultValues),
}));

export const labReportTemplatesRelations = relations(labReportTemplates, ({one, many}) => ({
	labOrderResults: many(labOrderResults),
	labReportTemplateParameters: many(labReportTemplateParameters),
	lab: one(labs, {
		fields: [labReportTemplates.labId],
		references: [labs.id]
	}),
}));

export const labOrderResultValuesRelations = relations(labOrderResultValues, ({one}) => ({
	labOrderResult: one(labOrderResults, {
		fields: [labOrderResultValues.resultId],
		references: [labOrderResults.id]
	}),
	labReportTemplateParameter: one(labReportTemplateParameters, {
		fields: [labOrderResultValues.parameterId],
		references: [labReportTemplateParameters.id]
	}),
}));

export const labReportTemplateParametersRelations = relations(labReportTemplateParameters, ({one, many}) => ({
	labOrderResultValues: many(labOrderResultValues),
	labReportTemplate: one(labReportTemplates, {
		fields: [labReportTemplateParameters.templateId],
		references: [labReportTemplates.id]
	}),
	labReportTemplateParameter: one(labReportTemplateParameters, {
		fields: [labReportTemplateParameters.baseParameterId],
		references: [labReportTemplateParameters.id],
		relationName: "labReportTemplateParameters_baseParameterId_labReportTemplateParameters_id"
	}),
	labReportTemplateParameters: many(labReportTemplateParameters, {
		relationName: "labReportTemplateParameters_baseParameterId_labReportTemplateParameters_id"
	}),
	lab: one(labs, {
		fields: [labReportTemplateParameters.labId],
		references: [labs.id]
	}),
	user_createdBy: one(users, {
		fields: [labReportTemplateParameters.createdBy],
		references: [users.id],
		relationName: "labReportTemplateParameters_createdBy_users_id"
	}),
	user_updatedBy: one(users, {
		fields: [labReportTemplateParameters.updatedBy],
		references: [users.id],
		relationName: "labReportTemplateParameters_updatedBy_users_id"
	}),
}));

export const labSamplesRelations = relations(labSamples, ({one}) => ({
	clinic: one(clinics, {
		fields: [labSamples.clinicId],
		references: [clinics.id]
	}),
	lab: one(labs, {
		fields: [labSamples.labId],
		references: [labs.id]
	}),
	labOrder_labOrderId: one(labOrders, {
		fields: [labSamples.labOrderId],
		references: [labOrders.id],
		relationName: "labSamples_labOrderId_labOrders_id"
	}),
	labOrder_appointmentTestId: one(labOrders, {
		fields: [labSamples.appointmentTestId],
		references: [labOrders.id],
		relationName: "labSamples_appointmentTestId_labOrders_id"
	}),
	user_patientId: one(users, {
		fields: [labSamples.patientId],
		references: [users.id],
		relationName: "labSamples_patientId_users_id"
	}),
	testCatalog: one(testCatalog, {
		fields: [labSamples.testId],
		references: [testCatalog.id]
	}),
	user_collectedBy: one(users, {
		fields: [labSamples.collectedBy],
		references: [users.id],
		relationName: "labSamples_collectedBy_users_id"
	}),
	user_receivedAtLabBy: one(users, {
		fields: [labSamples.receivedAtLabBy],
		references: [users.id],
		relationName: "labSamples_receivedAtLabBy_users_id"
	}),
}));

export const medicinesRelations = relations(medicines, ({one, many}) => ({
	user: one(users, {
		fields: [medicines.createdByUserId],
		references: [users.id]
	}),
	prescriptions: many(prescriptions),
}));

export const userMfaRelations = relations(userMfa, ({one}) => ({
	user: one(users, {
		fields: [userMfa.userId],
		references: [users.id]
	}),
}));

export const userMfaRecoveryCodesRelations = relations(userMfaRecoveryCodes, ({one}) => ({
	user: one(users, {
		fields: [userMfaRecoveryCodes.userId],
		references: [users.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const patientFamilyLinksRelations = relations(patientFamilyLinks, ({one}) => ({
	user_primaryPatientId: one(users, {
		fields: [patientFamilyLinks.primaryPatientId],
		references: [users.id],
		relationName: "patientFamilyLinks_primaryPatientId_users_id"
	}),
	user_linkedPatientId: one(users, {
		fields: [patientFamilyLinks.linkedPatientId],
		references: [users.id],
		relationName: "patientFamilyLinks_linkedPatientId_users_id"
	}),
}));

export const pharmacyMedicinesRelations = relations(pharmacyMedicines, ({one, many}) => ({
	pharmacy: one(pharmacies, {
		fields: [pharmacyMedicines.pharmacyId],
		references: [pharmacies.id]
	}),
	hsnTaxMaster: one(hsnTaxMaster, {
		fields: [pharmacyMedicines.hsnId],
		references: [hsnTaxMaster.id]
	}),
	pharmacyTagsMaps: many(pharmacyTagsMap),
	pharmacySubscriptionMedicines: many(pharmacySubscriptionMedicines),
	pharmacyStockMedicines: many(pharmacyStockMedicine),
}));

export const hsnTaxMasterRelations = relations(hsnTaxMaster, ({many}) => ({
	pharmacyMedicines: many(pharmacyMedicines),
}));

export const pharmacyMedicineTagsRelations = relations(pharmacyMedicineTags, ({one, many}) => ({
	pharmacy: one(pharmacies, {
		fields: [pharmacyMedicineTags.pharmacyId],
		references: [pharmacies.id]
	}),
	pharmacyTagsMaps: many(pharmacyTagsMap),
}));

export const pharmacyTagsMapRelations = relations(pharmacyTagsMap, ({one}) => ({
	pharmacyMedicine: one(pharmacyMedicines, {
		fields: [pharmacyTagsMap.medicineId],
		references: [pharmacyMedicines.id]
	}),
	pharmacyMedicineTag: one(pharmacyMedicineTags, {
		fields: [pharmacyTagsMap.tagId],
		references: [pharmacyMedicineTags.id]
	}),
}));

export const pharmacyPatientSubscriptionRelations = relations(pharmacyPatientSubscription, ({one, many}) => ({
	pharmacy: one(pharmacies, {
		fields: [pharmacyPatientSubscription.pharmacyId],
		references: [pharmacies.id]
	}),
	user: one(users, {
		fields: [pharmacyPatientSubscription.customerId],
		references: [users.id]
	}),
	pharmacySubscriptionMedicines: many(pharmacySubscriptionMedicines),
	pharmacySubscriptionSalesMaps: many(pharmacySubscriptionSalesMap),
}));

export const pharmacySubscriptionMedicinesRelations = relations(pharmacySubscriptionMedicines, ({one}) => ({
	pharmacyPatientSubscription: one(pharmacyPatientSubscription, {
		fields: [pharmacySubscriptionMedicines.pharmacyPatientSubscriptionId],
		references: [pharmacyPatientSubscription.id]
	}),
	pharmacyMedicine: one(pharmacyMedicines, {
		fields: [pharmacySubscriptionMedicines.pharmacyMedicineId],
		references: [pharmacyMedicines.id]
	}),
}));

export const pharmacySubscriptionSalesMapRelations = relations(pharmacySubscriptionSalesMap, ({one}) => ({
	pharmacyPatientSubscription: one(pharmacyPatientSubscription, {
		fields: [pharmacySubscriptionSalesMap.pharmacyPatientSubscriptionId],
		references: [pharmacyPatientSubscription.id]
	}),
	pharmacySale: one(pharmacySales, {
		fields: [pharmacySubscriptionSalesMap.pharmacySalesId],
		references: [pharmacySales.id]
	}),
}));

export const prescriptionQueueRelations = relations(prescriptionQueue, ({one, many}) => ({
	pharmacySales: many(pharmacySales),
	reportCard: one(reportCards, {
		fields: [prescriptionQueue.reportId],
		references: [reportCards.id]
	}),
	appointment: one(appointments, {
		fields: [prescriptionQueue.appointmentId],
		references: [appointments.id]
	}),
	user_doctorId: one(users, {
		fields: [prescriptionQueue.doctorId],
		references: [users.id],
		relationName: "prescriptionQueue_doctorId_users_id"
	}),
	clinic: one(clinics, {
		fields: [prescriptionQueue.clinicId],
		references: [clinics.id]
	}),
	user_pharmacyUserId: one(users, {
		fields: [prescriptionQueue.pharmacyUserId],
		references: [users.id],
		relationName: "prescriptionQueue_pharmacyUserId_users_id"
	}),
}));

export const pharmacySuppliersRelations = relations(pharmacySuppliers, ({one, many}) => ({
	pharmacyStocks: many(pharmacyStock),
	pharmacy: one(pharmacies, {
		fields: [pharmacySuppliers.pharmacyId],
		references: [pharmacies.id]
	}),
}));

export const pharmacyAssignRelations = relations(pharmacyAssign, ({one}) => ({
	user: one(users, {
		fields: [pharmacyAssign.userId],
		references: [users.id]
	}),
	pharmacy: one(pharmacies, {
		fields: [pharmacyAssign.pharmacyId],
		references: [pharmacies.id]
	}),
	clinic: one(clinics, {
		fields: [pharmacyAssign.clinicId],
		references: [clinics.id]
	}),
}));

export const quickPrintTemplatesRelations = relations(quickPrintTemplates, ({one}) => ({
	user: one(users, {
		fields: [quickPrintTemplates.doctorId],
		references: [users.id]
	}),
}));

export const prescriptionsRelations = relations(prescriptions, ({one}) => ({
	reportCard: one(reportCards, {
		fields: [prescriptions.reportCardId],
		references: [reportCards.id]
	}),
	user_petientId: one(users, {
		fields: [prescriptions.petientId],
		references: [users.id],
		relationName: "prescriptions_petientId_users_id"
	}),
	medicine: one(medicines, {
		fields: [prescriptions.medicineId],
		references: [medicines.id]
	}),
	user_prescribedBy: one(users, {
		fields: [prescriptions.prescribedBy],
		references: [users.id],
		relationName: "prescriptions_prescribedBy_users_id"
	}),
}));

export const favouritePrescriptionRelations = relations(favouritePrescription, ({one}) => ({
	user: one(users, {
		fields: [favouritePrescription.doctorId],
		references: [users.id]
	}),
}));

export const settingsRelations = relations(settings, ({one}) => ({
	user: one(users, {
		fields: [settings.userId],
		references: [users.id]
	}),
}));

export const clinicAddOnsRelations = relations(clinicAddOns, ({one}) => ({
	addOn: one(addOns, {
		fields: [clinicAddOns.addOnId],
		references: [addOns.id]
	}),
}));

export const addOnsRelations = relations(addOns, ({many}) => ({
	clinicAddOns: many(clinicAddOns),
}));

export const couponUsageRelations = relations(couponUsage, ({one}) => ({
	coupon: one(coupons, {
		fields: [couponUsage.couponId],
		references: [coupons.id]
	}),
}));

export const couponsRelations = relations(coupons, ({many}) => ({
	couponUsages: many(couponUsage),
}));

export const planFeaturesRelations = relations(planFeatures, ({one}) => ({
	subscriptionPlan: one(subscriptionPlans, {
		fields: [planFeatures.planId],
		references: [subscriptionPlans.id]
	}),
}));

export const labOrderTrackingEventsRelations = relations(labOrderTrackingEvents, ({one}) => ({
	clinic: one(clinics, {
		fields: [labOrderTrackingEvents.clinicId],
		references: [clinics.id]
	}),
	lab: one(labs, {
		fields: [labOrderTrackingEvents.labId],
		references: [labs.id]
	}),
	labOrder: one(labOrders, {
		fields: [labOrderTrackingEvents.appointmentTestId],
		references: [labOrders.id]
	}),
	user: one(users, {
		fields: [labOrderTrackingEvents.actorUserId],
		references: [users.id]
	}),
}));

export const referralsRelations = relations(referrals, ({one}) => ({
	user_referredTo: one(users, {
		fields: [referrals.referredTo],
		references: [users.id],
		relationName: "referrals_referredTo_users_id"
	}),
	user_referredBy: one(users, {
		fields: [referrals.referredBy],
		references: [users.id],
		relationName: "referrals_referredBy_users_id"
	}),
}));

export const tokensRelations = relations(tokens, ({one}) => ({
	user: one(users, {
		fields: [tokens.userId],
		references: [users.id]
	}),
}));

export const userDevicesRelations = relations(userDevices, ({one}) => ({
	user: one(users, {
		fields: [userDevices.userId],
		references: [users.id]
	}),
}));

export const userProfessionalsRelations = relations(userProfessionals, ({one}) => ({
	user: one(users, {
		fields: [userProfessionals.userId],
		references: [users.id]
	}),
}));

export const userProfilesRelations = relations(userProfiles, ({one}) => ({
	user: one(users, {
		fields: [userProfiles.userId],
		references: [users.id]
	}),
}));