import { pgTable, uniqueIndex, uuid, varchar, boolean, timestamp, foreignKey, integer, unique, index, numeric, text, jsonb, doublePrecision, date, json, serial, pgSequence, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const actionTaken = pgEnum("action_taken", ['warning', 'penalty', 'advance_required', 'blocked'])
export const apointmentStatus = pgEnum("apointment_status", ['Upcoming', 'Completed', 'Cancelled', 'Rescheduled', 'Pending', 'Missed', 'Confirmed', 'Patient Arrived', 'NoShow'])
export const appliesTo = pgEnum("applies_to", ['all', 'plans', 'addons', 'specific_plans', 'specific_addons'])
export const appointmentActivityAction = pgEnum("appointment_activity_action", ['CREATED', 'UPDATED', 'CONFIRMED', 'COMPLETED', 'STATUS_CHANGED', 'PAYMENT_STATUS', 'VITALS_UPDATED', 'RESCHEDULED', 'PATIENT_ARRIVED', 'CANCELLED', 'NOTES_ADDED', 'REMINDER_SENT', 'TEST_PRESCRIBED', 'PRESCRIPTION_CREATED', 'PRESCRIPTION_UPDATED', 'TEST_REPORT_UPLOADED'])
export const appointmentPlainStatus = pgEnum("appointment_plain_status", ['active', 'inactive', 'paused', 'trial', 'cancelled', 'expired'])
export const bannerPlacement = pgEnum("banner_placement", ['DASHBOARD_TOP', 'DASHBOARD_SIDEBAR', 'INSIGHTS_WIDGET', 'APPOINTMENT_HEADER', 'LOGIN_PAGE', 'BILLING_PAGE'])
export const bannerPriority = pgEnum("banner_priority", ['P0', 'P1', 'P2', 'P3'])
export const bannerStatus = pgEnum("banner_status", ['Active', 'Paused', 'Scheduled', 'Expired', 'Draft'])
export const bannerType = pgEnum("banner_type", ['Referral', 'MedicineSpotlight', 'OperationalAlert', 'FeatureAnnouncement', 'PromotionalOffer', 'SystemAlert'])
export const bookingSource = pgEnum("booking_source", ['mobile_app', 'web_portal', 'phone_call', 'walk_in', 'system'])
export const clinicOnboardingStatus = pgEnum("clinic_onboarding_status", ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'])
export const clinicStatus = pgEnum("clinic_status", ['Active', 'Inactive', 'Blocked', 'Pending', 'Rejected'])
export const clinicSymptomStatus = pgEnum("clinic_symptom_status", ['Active', 'Inactive'])
export const commonSymptoms = pgEnum("common_symptoms", ['Fever', 'Headache', 'Body_Pain', 'Fatigue', 'Weakness', 'Loss_of_Appetite', 'Nausea', 'Dizziness', 'Cough', 'Sore_Throat', 'Chills', 'Sweating', 'Sleep_Disturbance'])
export const couponStatus = pgEnum("coupon_status", ['active', 'inactive', 'expired'])
export const discountType = pgEnum("discount_type", ['percentage', 'fixed', 'trial'])
export const labCatalogStatus = pgEnum("lab_catalog_status", ['active', 'inactive'])
export const labParameterSourceType = pgEnum("lab_parameter_source_type", ['DEFAULT', 'CUSTOM'])
export const labResultFlag = pgEnum("lab_result_flag", ['Low', 'Normal', 'High', 'Abnormal', 'Not Applicable'])
export const labResultStatus = pgEnum("lab_result_status", ['Draft', 'Completed', 'Verified'])
export const labSampleStatus = pgEnum("lab_sample_status", ['NOT_STARTED', 'SAMPLE_COLLECTION_PENDING', 'SAMPLE_COLLECTED', 'SAMPLE_RECEIVED_AT_LAB', 'SAMPLE_PROCESSING', 'TESTING_IN_PROGRESS', 'QUALITY_CHECK', 'COMPLETED', 'REJECTED'])
export const labStatus = pgEnum("lab_status", ['Active', 'Inactive', 'Blocked', 'New'])
export const labTestSource = pgEnum("lab_test_source", ['master', 'custom'])
export const labTestsStatus = pgEnum("lab_tests_status", ['active', 'deactive', 'inactive'])
export const latePatientPolicy = pgEnum("late_patient_policy", ['keep_position', 'move_back', 'move_to_end'])
export const markedByRole = pgEnum("marked_by_role", ['doctor', 'receptionist', 'system', 'admin'])
export const medicineStatus = pgEnum("medicine_status", ['active', 'inactive'])
export const noShowMarkedBy = pgEnum("no_show_marked_by", ['doctor', 'receptionist', 'system', 'admin'])
export const patientsTestStatus = pgEnum("patients_test_status", ['active', 'deactive'])
export const paymentModeEnum = pgEnum("payment_mode_enum", ['cash', 'upi', 'card', 'insurance'])
export const paymentStatus = pgEnum("payment_status", ['pending', 'paid', 'failed'])
export const paymentStatusEnum = pgEnum("payment_status_enum", ['paid', 'pending', 'refunded'])
export const penaltyType = pgEnum("penalty_type", ['fixed', 'percentage'])
export const permissionAuditAction = pgEnum("permission_audit_action", ['granted', 'revoked'])
export const pharmacyNoLoss = pgEnum("pharmacy_no_loss", ['true', 'false'])
export const pharmacyStatus = pgEnum("pharmacy_status", ['active', 'deactive'])
export const pharmacyStockPaymentStatus = pgEnum("pharmacy_stock_payment_status", ['paid', 'unpaid', 'partial'])
export const pharmacySubscriptionStatus = pgEnum("pharmacy_subscription_status", ['active', 'paused', 'cancelled'])
export const prescriptionStatus = pgEnum("prescription_status", ['PENDING', 'ON_HOLD', 'COMPLETED', 'REJECTED'])
export const referralStatus = pgEnum("referral_status", ['pending', 'approved', 'rejected'])
export const reminderTimeUnit = pgEnum("reminder_time_unit", ['Minutes', 'Hours', 'Days'])
export const reportStatus = pgEnum("report_status", ['Uploaded', 'Pendig', 'Approved', 'Rejected', 'Reviewed', 'Completed', 'Shared'])
export const supplierStatus = pgEnum("supplier_status", ['active', 'inactive'])
export const testReportStatus = pgEnum("test_report_status", ['Initiated', 'InProgress', 'Completed'])
export const tokenType = pgEnum("token_type", ['email_verification', 'password_reset', 'registration_verification', 'registration_session', 'set_initial_password', 'patient_otp'])
export const userStatus = pgEnum("user_status", ['Active', 'Inactive', 'Blocked', 'New', 'Pending', 'Reviewing', 'Rejected'])
export const userType = pgEnum("user_type", ['Admin', 'User', 'Super_Admin', 'Doctor', 'Receptionist', 'Nurse', 'Patient', 'Pharmacist', 'Lab_Assistant', 'Radiologist'])

export const appointmentTestUniqueIdSeq = pgSequence("appointment_test_unique_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })
export const labInvoiceNumberSeq = pgSequence("lab_invoice_number_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })
export const labSampleBarcodeSeq = pgSequence("lab_sample_barcode_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })

export const appUpdateConfig = pgTable("app_update_config", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appName: varchar("app_name", { length: 50 }).notNull(),
	platform: varchar({ length: 20 }).notNull(),
	forceUpdate: boolean("force_update").default(false).notNull(),
	storeUrl: varchar("store_url", { length: 2048 }).default(').notNull(),
	latestVersion: varchar("latest_version", { length: 50 }).notNull(),
	minimumVersion: varchar("minimum_version", { length: 50 }).default('1.0.0').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("ux_app_update_app_platform").using("btree", table.appName.asc().nullsLast().op("text_ops"), table.platform.asc().nullsLast().op("text_ops")),
]);

export const clinicAssign = pgTable("clinic_assign", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	onlineBookingEnabled: boolean("online_booking_enabled").default(true).notNull(),
	maxAdvanceBookingDays: integer("max_advance_booking_days").default(7).notNull(),
	defaultConsultationMinutes: integer("default_consultation_minutes"),
}, (table) => [
	uniqueIndex("user_clinic_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.clinicId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "clinic_assign_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_assign_clinic_id_clinics_id_fk"
		}),
]);

export const applicationCancellationPolicies = pgTable("application_cancellation_policies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	cancellationFeatureEnabled: boolean("cancellation_feature_enabled").default(true).notNull(),
	refundFeatureEnabled: boolean("refund_feature_enabled").default(true).notNull(),
	rescheduleFeatureEnabled: boolean("reschedule_feature_enabled").default(true).notNull(),
	policyPrecedence: varchar("policy_precedence", { length: 50 }).default('Application > Clinic').notNull(),
	allowClinicConfiguration: boolean("allow_clinic_configuration").default(true).notNull(),
	defaultRefundPercentage: integer("default_refund_percentage").default(100).notNull(),
	defaultRefundCooldownHours: integer("default_refund_cooldown_hours").default(24).notNull(),
	partialRefundCooldownHours: integer("partial_refund_cooldown_hours").default(12).notNull(),
	partialRefundPercentage: integer("partial_refund_percentage").default(50).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const clinicSettings = pgTable("clinic_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	voiceCallEnabled: boolean("voice_call_enabled").default(false).notNull(),
	smsEnabled: boolean("sms_enabled").default(false).notNull(),
	whatsappEnabled: boolean("whatsapp_enabled").default(false).notNull(),
	loginAlertsEnabled: boolean("login_alerts_enabled").default(false).notNull(),
	autoLogoutMinutes: integer("auto_logout_minutes"),
	runningLateThresholdMinutes: integer("running_late_threshold_minutes").default(10),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	onlineBookingEnabled: boolean("online_booking_enabled").default(true).notNull(),
	payOnlineEnabled: boolean("pay_online_enabled").default(false).notNull(),
	payAtClinicEnabled: boolean("pay_at_clinic_enabled").default(false).notNull(),
	showClinicNumberPublicly: boolean("show_clinic_number_publicly").default(true).notNull(),
	defaultConsultationMinutes: integer("default_consultation_minutes"),
	latePatientPolicy: latePatientPolicy("late_patient_policy").default('move_back').notNull(),
	latePatientMovePositions: integer("late_patient_move_positions").default(2).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_settings_clinic_id_clinics_id_fk"
		}),
	unique("clinic_settings_clinic_id_unique").on(table.clinicId),
]);

export const clinicCommissions = pgTable("clinic_commissions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	commissionType: varchar("commission_type", { length: 50 }).default('percentage').notNull(),
	commissionValue: numeric("commission_value", { precision: 12, scale:  2 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	pgFeeBearer: varchar("pg_fee_bearer", { length: 50 }).default('platform').notNull(),
	pgFeePercentage: numeric("pg_fee_percentage", { precision: 5, scale:  2 }).default('2.00').notNull(),
	gstOnCommissionEnabled: boolean("gst_on_commission_enabled").default(false).notNull(),
	gstPercentage: numeric("gst_percentage", { precision: 5, scale:  2 }).default('18.00').notNull(),
	version: integer().default(1).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	effectiveFrom: timestamp("effective_from", { mode: 'string' }).defaultNow().notNull(),
	effectiveTo: timestamp("effective_to", { mode: 'string' }),
}, (table) => [
	index("clinic_commission_active_idx").using("btree", table.clinicId.asc().nullsLast().op("bool_ops"), table.isActive.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_commissions_clinic_id_clinics_id_fk"
		}).onDelete("cascade"),
]);

export const clinicSubscriptions = pgTable("clinic_subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	planId: uuid("plan_id").notNull(),
	startsAt: timestamp("starts_at", { mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	active: boolean().default(true).notNull(),
	provider: varchar({ length: 80 }),
	providerSubscriptionId: varchar("provider_subscription_id", { length: 200 }),
	paymentStatus: varchar("payment_status", { length: 20 }).default('pending'),
	paymentMode: varchar("payment_mode", { length: 20 }),
	transactionId: varchar("transaction_id", { length: 50 }),
	price: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
	cancelledAt: timestamp("cancelled_at", { mode: 'string' }),
	cancellationReason: varchar("cancellation_reason", { length: 255 }),
	autoRenew: boolean("auto_renew").default(false).notNull(),
	razorpaySubscriptionId: varchar("razorpay_subscription_id", { length: 200 }),
	scheduledPlanId: uuid("scheduled_plan_id"),
	scheduledPlanChangeAt: timestamp("scheduled_plan_change_at", { mode: 'string' }),
	scheduledProviderSubscriptionId: varchar("scheduled_provider_subscription_id", { length: 200 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	discount: numeric({ precision: 12, scale:  2 }).default('0.00'),
}, (table) => [
	index("clinic_subscriptions_active_idx").using("btree", table.active.asc().nullsLast().op("bool_ops")),
	index("clinic_subscriptions_clinic_idx").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("ux_clinic_active_subscription").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")).where(sql`(active = true)`),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [subscriptionPlans.id],
			name: "clinic_subscriptions_plan_id_subscription_plans_id_fk"
		}),
	foreignKey({
			columns: [table.scheduledPlanId],
			foreignColumns: [subscriptionPlans.id],
			name: "clinic_subscriptions_scheduled_plan_id_subscription_plans_id_fk"
		}),
]);

export const labOrders = pgTable("lab_orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	uniqueTestId: varchar("unique_test_id", { length: 20 }),
	appointmentId: uuid("appointment_id"),
	testId: uuid("test_id").notNull(),
	isIndependent: boolean("is_independent").default(false).notNull(),
	independentPatientId: uuid("independent_patient_id"),
	patientId: uuid("patient_id"),
	doctorId: uuid("doctor_id"),
	clinicId: uuid("clinic_id"),
	labAssistantId: uuid("lab_assistant_id"),
	testReportStatus: testReportStatus("test_report_status").default('Initiated').notNull(),
	paymentStatus: paymentStatus("payment_status").default('pending').notNull(),
	price: integer().default(0),
	reportPdf: text("report_pdf"),
	workflowStatus: varchar("workflow_status", { length: 50 }).default('INITIATED').notNull(),
	sampleStatus: varchar("sample_status", { length: 50 }).default('NOT_STARTED'),
	onHoldAt: timestamp("on_hold_at", { mode: 'string' }),
	rejectedAt: timestamp("rejected_at", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	paymentCollectedAt: timestamp("payment_collected_at", { mode: 'string' }),
	paymentCollectedBy: uuid("payment_collected_by"),
	sampleCollectedAt: timestamp("sample_collected_at", { mode: 'string' }),
	sampleReceivedAt: timestamp("sample_received_at", { mode: 'string' }),
	processingStartedAt: timestamp("processing_started_at", { mode: 'string' }),
	testingStartedAt: timestamp("testing_started_at", { mode: 'string' }),
	qualityCheckedAt: timestamp("quality_checked_at", { mode: 'string' }),
	expectedReportReadyAt: timestamp("expected_report_ready_at", { mode: 'string' }),
	readyForReportAt: timestamp("ready_for_report_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	isExternalLabReport: boolean("is_external_lab_report").default(false).notNull(),
}, (table) => [
	index("idx_lab_orders_appointment_id").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_orders_clinic_id").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_orders_clinic_report_status").using("btree", table.clinicId.asc().nullsLast().op("enum_ops"), table.testReportStatus.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_orders_doctor_id").using("btree", table.doctorId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_orders_lab_assistant_created_at").using("btree", table.labAssistantId.asc().nullsLast().op("timestamp_ops"), table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_lab_orders_lab_assistant_id").using("btree", table.labAssistantId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_orders_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_orders_payment_status").using("btree", table.paymentStatus.asc().nullsLast().op("enum_ops")),
	index("idx_lab_orders_report_status").using("btree", table.testReportStatus.asc().nullsLast().op("enum_ops")),
	index("idx_lab_orders_sample_status").using("btree", table.sampleStatus.asc().nullsLast().op("text_ops")),
	index("idx_lab_orders_test_id").using("btree", table.testId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_orders_workflow_status").using("btree", table.workflowStatus.asc().nullsLast().op("text_ops")),
	uniqueIndex("lab_orders_unique_test_id_unique").using("btree", table.uniqueTestId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "lab_orders_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.testId],
			foreignColumns: [testCatalog.id],
			name: "lab_orders_test_id_test_catalog_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.independentPatientId],
			foreignColumns: [independentPatients.id],
			name: "lab_orders_independent_patient_id_independent_patients_id_fk"
		}),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "lab_orders_patient_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "lab_orders_doctor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "lab_orders_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.labAssistantId],
			foreignColumns: [users.id],
			name: "lab_orders_lab_assistant_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.paymentCollectedBy],
			foreignColumns: [users.id],
			name: "lab_orders_payment_collected_by_users_id_fk"
		}),
]);

export const financialLedgers = pgTable("financial_ledgers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	paymentId: uuid("payment_id").notNull(),
	entryType: varchar("entry_type", { length: 50 }).notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	description: varchar({ length: 255 }),
	gatewayReferenceId: varchar("gateway_reference_id", { length: 255 }),
	metaData: jsonb("meta_data"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ledger_appointment_idx").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("ledger_clinic_idx").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	index("ledger_gateway_ref_idx").using("btree", table.gatewayReferenceId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "financial_ledgers_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "financial_ledgers_clinic_id_clinics_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [appointmentPayments.id],
			name: "financial_ledgers_payment_id_appointment_payments_id_fk"
		}).onDelete("cascade"),
]);

export const pharmacySalesReturns = pgTable("pharmacy_sales_returns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyId: uuid("pharmacy_id").notNull(),
	saleId: uuid("sale_id").notNull(),
	gstAmountReturn: numeric("gst_amount_return", { precision: 12, scale:  2 }).default('0'),
	totalReturnAmount: numeric("total_return_amount", { precision: 12, scale:  2 }).default('0'),
	refundMethod: varchar("refund_method"),
	returnReason: varchar("return_reason", { length: 255 }),
	refundNotes: varchar("refund_notes", { length: 255 }),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_sales_returns_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_sales_returns_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_sales_returns_pharmacy_created_idx").using("btree", table.pharmacyId.asc().nullsLast().op("timestamp_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_sales_returns_pharmacy_id_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_sales_returns_sale_id_idx").using("btree", table.saleId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_sales_returns_pharmacy_id_pharmacies_id_fk"
		}),
	foreignKey({
			columns: [table.saleId],
			foreignColumns: [pharmacySales.id],
			name: "pharmacy_sales_returns_sale_id_pharmacy_sales_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "pharmacy_sales_returns_created_by_users_id_fk"
		}),
]);

export const pharmacySalesReturnItems = pgTable("pharmacy_sales_return_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	salesReturnId: uuid("sales_return_id").notNull(),
	salesItemId: uuid("sales_item_id").notNull(),
	stockMedicineId: uuid("stock_medicine_id").notNull(),
	returnedQuantity: integer("returned_quantity").default(0).notNull(),
	refundAmount: numeric("refund_amount", { precision: 12, scale:  2 }).default('0'),
}, (table) => [
	index("pharmacy_sales_return_items_return_id_idx").using("btree", table.salesReturnId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_sales_return_items_sales_item_id_idx").using("btree", table.salesItemId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_sales_return_items_stock_medicine_id_idx").using("btree", table.stockMedicineId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.salesReturnId],
			foreignColumns: [pharmacySalesReturns.id],
			name: "pharmacy_sales_return_items_sales_return_id_pharmacy_sales_retu"
		}),
	foreignKey({
			columns: [table.salesItemId],
			foreignColumns: [pharmacySalesItems.id],
			name: "pharmacy_sales_return_items_sales_item_id_pharmacy_sales_items_"
		}),
	foreignKey({
			columns: [table.stockMedicineId],
			foreignColumns: [pharmacyStockMedicine.id],
			name: "pharmacy_sales_return_items_stock_medicine_id_pharmacy_stock_me"
		}),
]);

export const refreshTokens = pgTable("refresh_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	platform: varchar({ length: 20 }).default('web').notNull(),
	tokenHash: varchar("token_hash", { length: 200 }).notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	userAgent: varchar("user_agent", { length: 500 }),
	ipAddress: varchar("ip_address", { length: 100 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("unique_refresh_token_hash").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	uniqueIndex("unique_refresh_token_user_platform").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.platform.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "refresh_tokens_user_id_users_id_fk"
		}),
]);

export const reportCards = pgTable("report_cards", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	petientId: uuid("petient_id").notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	reportId: uuid("report_id"),
	comorbidities: text().array(),
	habits: text().array(),
	generalExamination: text("general_examination").array(),
	systemExamination: text("system_examination"),
	provisionalDiagnosis: text("provisional_diagnosis"),
	differentialDiagnosis: text("differential_diagnosis"),
	finalDiagnosis: text("final_diagnosis"),
	investigations: text(),
	advice: text(),
	clinicalNotes: text("clinical_notes"),
	allergies: text().array(),
	surgerySuggested: text().array(),
	visitingDays: text().array(),
	visitingNotes: varchar("visiting_notes"),
	prescriptionPdf: text("prescription_pdf"),
	followUpInDays: varchar("follow_up_in_days"),
	followUpDate: timestamp("follow_up_date", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	additionalInformation: jsonb("additional_information"),
	preDiagnosis: text("pre_diagnosis"),
}, (table) => [
	foreignKey({
			columns: [table.petientId],
			foreignColumns: [users.id],
			name: "report_cards_petient_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "report_cards_appointment_id_appointments_id_fk"
		}),
	foreignKey({
			columns: [table.reportId],
			foreignColumns: [reports.id],
			name: "report_cards_report_id_reports_id_fk"
		}),
]);

export const subscriptionActivity = pgTable("subscription_activity", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	type: varchar({ length: 64 }).notNull(),
	title: varchar({ length: 200 }).notNull(),
	description: text(),
	amount: numeric({ precision: 12, scale:  2 }),
	currency: varchar({ length: 8 }).default('INR').notNull(),
	actorUserId: uuid("actor_user_id"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("subscription_activity_clinic_created_idx").using("btree", table.clinicId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const prescriptionTemplates = pgTable("prescription_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	templateName: varchar("template_name", { length: 50 }).notNull(),
	fontFamily: varchar("font_family", { length: 100 }).notNull(),
	color1: varchar({ length: 20 }).notNull(),
	color2: varchar({ length: 20 }).notNull(),
	color3: varchar({ length: 20 }).notNull(),
	color4: varchar({ length: 20 }).notNull(),
	color5: varchar({ length: 20 }).notNull(),
	color6: varchar({ length: 20 }).notNull(),
	color7: varchar({ length: 20 }).notNull(),
	color8: varchar({ length: 20 }).notNull(),
	color9: varchar({ length: 20 }).notNull(),
	color10: varchar({ length: 20 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	sectionConfig: jsonb("section_config"),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "prescription_templates_doctor_id_users_id_fk"
		}),
]);

export const clinicBankHistory = pgTable("clinic_bank_history", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	linkedAccountId: uuid("linked_account_id"),
	providerLinkedAccountId: varchar("provider_linked_account_id", { length: 255 }).notNull(),
	beneficiaryName: varchar("beneficiary_name", { length: 255 }),
	bankName: varchar("bank_name", { length: 255 }),
	maskedAccountNumber: varchar("masked_account_number", { length: 255 }),
	ifscCode: varchar("ifsc_code", { length: 100 }),
	effectiveFrom: timestamp("effective_from", { mode: 'string' }).defaultNow().notNull(),
	effectiveTo: timestamp("effective_to", { mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_bank_history_clinic_id_clinics_id_fk"
		}).onDelete("cascade"),
]);

export const clinicRazorpayAccounts = pgTable("clinic_razorpay_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	razorpayAccountId: varchar("razorpay_account_id", { length: 255 }),
	razorpayStakeholderId: varchar("razorpay_stakeholder_id", { length: 255 }),
	routeStatus: varchar("route_status", { length: 50 }).default('INACTIVE').notNull(),
	routeOnboardedAt: timestamp("route_onboarded_at", { mode: 'string' }),
	routeOnboardingRejectionReason: text("route_onboarding_rejection_reason"),
	onboardingDraftData: text("onboarding_draft_data"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("clinic_razorpay_clinic_unique").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_razorpay_accounts_clinic_id_clinics_id_fk"
		}).onDelete("cascade"),
]);

export const labReportLayoutTemplates = pgTable("lab_report_layout_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	labId: uuid("lab_id").notNull(),
	templateName: varchar("template_name", { length: 50 }).notNull(),
	fontFamily: varchar("font_family", { length: 100 }).notNull(),
	color1: varchar({ length: 20 }).notNull(),
	color2: varchar({ length: 20 }).notNull(),
	color3: varchar({ length: 20 }).notNull(),
	color4: varchar({ length: 20 }).notNull(),
	color5: varchar({ length: 20 }).notNull(),
	color6: varchar({ length: 20 }).notNull(),
	color7: varchar({ length: 20 }).notNull(),
	color8: varchar({ length: 20 }).notNull(),
	color9: varchar({ length: 20 }).notNull(),
	color10: varchar({ length: 20 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "lab_report_layout_templates_lab_id_labs_id_fk"
		}),
]);

export const permissionAuditLog = pgTable("permission_audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	targetUserId: uuid("target_user_id").notNull(),
	performedBy: uuid("performed_by").notNull(),
	permissionKey: varchar("permission_key", { length: 120 }).notNull(),
	action: permissionAuditAction().notNull(),
	performedAt: timestamp("performed_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_permission_audit_log_clinic_key").using("btree", table.clinicId.asc().nullsLast().op("text_ops"), table.permissionKey.asc().nullsLast().op("text_ops"), table.performedAt.asc().nullsLast().op("uuid_ops")),
	index("idx_permission_audit_log_target_user").using("btree", table.targetUserId.asc().nullsLast().op("uuid_ops"), table.clinicId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "permission_audit_log_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.targetUserId],
			foreignColumns: [users.id],
			name: "permission_audit_log_target_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.performedBy],
			foreignColumns: [users.id],
			name: "permission_audit_log_performed_by_users_id_fk"
		}),
]);

export const userPermissions = pgTable("user_permissions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	permissionId: uuid("permission_id").notNull(),
	grantedBy: uuid("granted_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_permissions_user_clinic").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.clinicId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("user_permissions_user_clinic_permission_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.clinicId.asc().nullsLast().op("uuid_ops"), table.permissionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_permissions_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "user_permissions_clinic_id_clinics_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.permissionId],
			foreignColumns: [permissions.id],
			name: "user_permissions_permission_id_permissions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [users.id],
			name: "user_permissions_granted_by_users_id_fk"
		}),
]);

export const permissions = pgTable("permissions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	key: varchar({ length: 120 }).notNull(),
	resource: varchar({ length: 60 }).notNull(),
	action: varchar({ length: 60 }).notNull(),
	description: varchar({ length: 255 }).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_permissions_resource").using("btree", table.resource.asc().nullsLast().op("text_ops")),
	uniqueIndex("permissions_key_unique").using("btree", table.key.asc().nullsLast().op("text_ops")),
]);

export const pharmacyPurchaseReturns = pgTable("pharmacy_purchase_returns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyId: uuid("pharmacy_id").notNull(),
	stockId: uuid("stock_id").notNull(),
	totalReturnAmount: numeric("total_return_amount", { precision: 12, scale:  2 }).default('0'),
	refundMethod: varchar("refund_method"),
	returnReason: varchar("return_reason", { length: 255 }).notNull(),
	refundNotes: varchar("refund_notes", { length: 500 }),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_purchase_returns_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_purchase_returns_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_purchase_returns_pharmacy_created_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_purchase_returns_pharmacy_id_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_purchase_returns_stock_id_idx").using("btree", table.stockId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_purchase_returns_pharmacy_id_pharmacies_id_fk"
		}),
	foreignKey({
			columns: [table.stockId],
			foreignColumns: [pharmacyStock.id],
			name: "pharmacy_purchase_returns_stock_id_pharmacy_stock_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "pharmacy_purchase_returns_created_by_users_id_fk"
		}),
]);

export const pharmacyPurchaseReturnItems = pgTable("pharmacy_purchase_return_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	purchaseReturnId: uuid("purchase_return_id").notNull(),
	stockMedicineId: uuid("stock_medicine_id").notNull(),
	returnedQuantity: integer("returned_quantity").default(0).notNull(),
	refundAmount: numeric("refund_amount", { precision: 12, scale:  2 }).default('0'),
}, (table) => [
	index("pharmacy_purchase_return_items_return_id_idx").using("btree", table.purchaseReturnId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_purchase_return_items_stock_medicine_id_idx").using("btree", table.stockMedicineId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.purchaseReturnId],
			foreignColumns: [pharmacyPurchaseReturns.id],
			name: "pharmacy_purchase_return_items_purchase_return_id_pharmacy_purc"
		}),
	foreignKey({
			columns: [table.stockMedicineId],
			foreignColumns: [pharmacyStockMedicine.id],
			name: "pharmacy_purchase_return_items_stock_medicine_id_pharmacy_stock"
		}),
]);

export const clinicUsage = pgTable("clinic_usage", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	featureKey: varchar("feature_key", { length: 100 }).notNull(),
	usageCount: integer("usage_count").default(0).notNull(),
	periodStart: timestamp("period_start", { mode: 'string' }).notNull(),
	periodEnd: timestamp("period_end", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("clinic_usage_clinic_idx").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	index("clinic_usage_period_idx").using("btree", table.periodStart.asc().nullsLast().op("timestamp_ops"), table.periodEnd.asc().nullsLast().op("timestamp_ops")),
	uniqueIndex("clinic_usage_unique").using("btree", table.clinicId.asc().nullsLast().op("text_ops"), table.featureKey.asc().nullsLast().op("text_ops"), table.periodStart.asc().nullsLast().op("uuid_ops")),
]);

export const appointments = pgTable("appointments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentType: varchar("appointment_type").notNull(),
	appointmentDate: timestamp("appointment_date", { mode: 'string' }).notNull(),
	appointmentTime: varchar("appointment_time"),
	tokenNo: integer("token_no"),
	appointmentStatus: apointmentStatus("appointment_status").default('Upcoming').notNull(),
	clinicId: uuid("clinic_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	doctorId: uuid("doctor_id"),
	clinicServiceId: uuid("clinic_service_id"),
	clinicCancellationPolicyId: uuid("clinic_cancellation_policy_id"),
	appointmentDurationMinutes: varchar("appointment_duration_minutes"),
	reasonForCancellation: text("reason_for_cancellation"),
	reasonForReschedule: text("reason_for_reschedule"),
	noShowMarkedBy: noShowMarkedBy("no_show_marked_by"),
	bookingSource: bookingSource("booking_source").default('system').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	arrivedAt: timestamp("arrived_at", { mode: 'string' }),
	lateQueueDemotion: integer("late_queue_demotion").default(0).notNull(),
}, (table) => [
	uniqueIndex("appointment_unique").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops"), table.patientId.asc().nullsLast().op("timestamp_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("appointments_appointment_date_idx").using("btree", table.appointmentDate.asc().nullsLast().op("timestamp_ops")),
	index("appointments_clinic_status_date_idx").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops"), table.appointmentStatus.asc().nullsLast().op("uuid_ops"), table.appointmentDate.asc().nullsLast().op("uuid_ops")),
	index("appointments_doctor_date_idx").using("btree", table.doctorId.asc().nullsLast().op("timestamp_ops"), table.appointmentDate.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "appointments_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "appointments_patient_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "appointments_doctor_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.clinicServiceId],
			foreignColumns: [clinicsService.id],
			name: "appointments_clinic_service_id_clinics_service_id_fk"
		}),
	foreignKey({
			columns: [table.clinicCancellationPolicyId],
			foreignColumns: [clinicCancellationPolicies.id],
			name: "appointments_clinic_cancellation_policy_id_clinic_cancellation_"
		}),
]);

export const appointmentPayments = pgTable("appointment_payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	paymentMode: varchar("payment_mode"),
	paymentStatus: varchar("payment_status").default('Paid'),
	price: numeric({ precision: 12, scale:  2 }),
	primaryServicePrice: numeric("primary_service_price", { precision: 12, scale:  2 }),
	paymentNotes: varchar("payment_notes"),
	transactionId: varchar("transaction_id", { length: 255 }),
	gatewayOrderId: varchar("gateway_order_id", { length: 255 }),
	gatewayResponse: jsonb("gateway_response"),
	refundMode: varchar("refund_mode"),
	refundedAmount: varchar("refunded_amount"),
	refundNotes: varchar("refund_notes"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	platformCommission: numeric("platform_commission", { precision: 12, scale:  2 }),
	pgFee: numeric("pg_fee", { precision: 12, scale:  2 }),
	gstAmount: numeric("gst_amount", { precision: 12, scale:  2 }),
	convenienceFee: numeric("convenience_fee", { precision: 12, scale:  2 }),
	transferredAmount: numeric("transferred_amount", { precision: 12, scale:  2 }),
	transfersData: jsonb("transfers_data"),
	financialSnapshot: jsonb("financial_snapshot"),
}, (table) => [
	uniqueIndex("transaction_idx").using("btree", table.transactionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "appointment_payments_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	unique("appointment_payments_appointment_id_unique").on(table.appointmentId),
	unique("appointment_payments_transaction_id_unique").on(table.transactionId),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 150 }),
	email: varchar(),
	mobile: varchar(),
	password: varchar(),
	socialProvider: varchar("social_provider", { length: 40 }),
	socialProviderId: varchar("social_provider_id", { length: 255 }),
	userType: userType("user_type").notNull(),
	userStatus: userStatus("user_status").default('Active').notNull(),
	emailVerifiedAt: timestamp("email_verified_at", { mode: 'string' }),
	isUserBlocked: boolean("is_user_blocked").default(false),
	isAdminDoctorAccess: boolean("is_admin_doctor_access").default(false).notNull(),
	isArchive: boolean("is_archive").default(false).notNull(),
	paymentVisible: boolean("payment_visible").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	userName: varchar("user_name", { length: 15 }),
}, (table) => [
	index("email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("mobile_idx").using("btree", table.mobile.asc().nullsLast().op("text_ops")),
	index("user_name_idx").using("btree", table.userName.asc().nullsLast().op("text_ops")),
	uniqueIndex("ux_patient_mobile").using("btree", table.mobile.asc().nullsLast().op("text_ops")).where(sql`((user_type = 'Patient'::user_type) AND (mobile IS NOT NULL))`),
	uniqueIndex("ux_staff_email").using("btree", table.email.asc().nullsLast().op("text_ops")).where(sql`((user_type <> 'Patient'::user_type) AND (email IS NOT NULL))`),
	uniqueIndex("ux_users_social_provider_id").using("btree", table.socialProvider.asc().nullsLast().op("text_ops"), table.socialProviderId.asc().nullsLast().op("text_ops")),
	unique("users_user_name_unique").on(table.userName),
]);

export const clinics = pgTable("clinics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	clinicName: varchar("clinic_name", { length: 150 }).notNull(),
	tagline: varchar(),
	clinicAddress: text("clinic_address"),
	clinicPhone: varchar("clinic_phone", { length: 20 }),
	state: varchar(),
	city: varchar(),
	zipCode: integer("zip_code"),
	clinicLogo: text("clinic_logo"),
	latitude: doublePrecision(),
	longitude: doublePrecision(),
	status: clinicStatus().default('Pending').notNull(),
	onboardingStatus: clinicOnboardingStatus("onboarding_status").default('NOT_STARTED').notNull(),
	approvalRequestSent: boolean("approval_request_sent").default(false).notNull(),
	currentStep: integer("current_step").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("user_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "clinics_user_id_users_id_fk"
		}),
]);

export const doctorSessionOverrides = pgTable("doctor_session_overrides", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	doctorId: uuid("doctor_id").notNull(),
	forDate: date("for_date").notNull(),
	valueMinutes: integer("value_minutes").notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("doctor_session_overrides_clinic_date_idx").using("btree", table.clinicId.asc().nullsLast().op("date_ops"), table.forDate.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "doctor_session_overrides_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_session_overrides_doctor_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "doctor_session_overrides_created_by_users_id_fk"
		}),
]);

export const visitingRequests = pgTable("visiting_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sourceAppointmentId: uuid("source_appointment_id").notNull(),
	reportCardId: uuid("report_card_id"),
	doctorId: uuid("doctor_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	requestedDate: timestamp("requested_date", { mode: 'string' }).notNull(),
	generatedAppointmentId: uuid("generated_appointment_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("visiting_requests_doctor_date_idx").using("btree", table.doctorId.asc().nullsLast().op("timestamp_ops"), table.requestedDate.asc().nullsLast().op("uuid_ops")),
	index("visiting_requests_generated_appointment_idx").using("btree", table.generatedAppointmentId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("visiting_requests_source_date_unique").using("btree", table.sourceAppointmentId.asc().nullsLast().op("uuid_ops"), table.requestedDate.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.sourceAppointmentId],
			foreignColumns: [appointments.id],
			name: "visiting_requests_source_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reportCardId],
			foreignColumns: [reportCards.id],
			name: "visiting_requests_report_card_id_report_cards_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "visiting_requests_doctor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "visiting_requests_patient_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "visiting_requests_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.generatedAppointmentId],
			foreignColumns: [appointments.id],
			name: "visiting_requests_generated_appointment_id_appointments_id_fk"
		}),
]);

export const appointmentClinicalData = pgTable("appointment_clinical_data", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	commonSymptoms: commonSymptoms("common_symptoms").array().default([""]),
	clinicSymptomIds: uuid("clinic_symptom_ids").array().default([""]),
	appointmentNotes: text("appointment_notes"),
	vitalsList: json("vitals_list"),
	referrals: json(),
	consentNotes: text("consent_notes"),
	consentFile: text("consent_file"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "appointment_clinical_data_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	unique("appointment_clinical_data_appointment_id_unique").on(table.appointmentId),
]);

export const clinicsService = pgTable("clinics_service", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	serviceName: varchar("service_name", { length: 250 }).notNull(),
	price: integer(),
	currency: varchar({ length: 8 }).default('USD').notNull(),
	additionalServices: text("additional_services"),
	canBeBookedByPatient: boolean("can_be_booked_by_patient").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	doctorId: uuid("doctor_id"),
	duration: integer(),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
}, (table) => [
	uniqueIndex("clinic_service_unique").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops"), table.serviceName.asc().nullsLast().op("text_ops"), table.doctorId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinics_service_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "clinics_service_doctor_id_users_id_fk"
		}),
]);

export const clinicCancellationPolicies = pgTable("clinic_cancellation_policies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	allowPatientCancel: boolean("allow_patient_cancel").default(true).notNull(),
	allowDoctorCancel: boolean("allow_doctor_cancel").default(true).notNull(),
	allowReceptionistCancel: boolean("allow_receptionist_cancel").default(true).notNull(),
	allowClinicAdminCancel: boolean("allow_clinic_admin_cancel").default(true).notNull(),
	windowOnlineHours: integer("window_online_hours").default(24).notNull(),
	windowOfflineHours: integer("window_offline_hours").default(12).notNull(),
	dailyLimitPerPatient: integer("daily_limit_per_patient").default(3).notNull(),
	weeklyLimitPerPatient: integer("weekly_limit_per_patient").default(10).notNull(),
	monthlyLimitPerPatient: integer("monthly_limit_per_patient").default(30).notNull(),
	cooldownSecondsBetweenCancellations: integer("cooldown_seconds_between_cancellations").default(1800).notNull(),
	reasonMandatory: boolean("reason_mandatory").default(true).notNull(),
	allowAdditionalComments: boolean("allow_additional_comments").default(true).notNull(),
	minCommentLength: integer("min_comment_length").default(0).notNull(),
	maxCommentLength: integer("max_comment_length").default(500).notNull(),
	allowReschedule: boolean("allow_reschedule").default(true).notNull(),
	maxReschedules: integer("max_reschedules").default(3).notNull(),
	rescheduleWindowHours: integer("reschedule_window_hours").default(24).notNull(),
	preservePaymentOnReschedule: boolean("preserve_payment_on_reschedule").default(true).notNull(),
	version: integer().default(1).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	deactivatedAt: timestamp("deactivated_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ux_clinic_active_policy").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")).where(sql`(is_active = true)`),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_cancellation_policies_clinic_id_clinics_id_fk"
		}).onDelete("cascade"),
]);

export const appointmentActivityHistory = pgTable("appointment_activity_history", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	action: appointmentActivityAction().notNull(),
	performedBy: uuid("performed_by"),
	previousState: jsonb("previous_state"),
	newState: jsonb("new_state"),
	remarks: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "appointment_activity_history_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.performedBy],
			foreignColumns: [users.id],
			name: "appointment_activity_history_performed_by_users_id_fk"
		}),
]);

export const appointmentMultipleService = pgTable("appointment_multiple_service", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	serviceId: uuid("service_id"),
	price: varchar({ length: 10 }),
	paymentMode: varchar("payment_mode", { length: 20 }).default('Cash'),
	paymentNotes: varchar("payment_notes", { length: 50 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "appointment_multiple_service_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.serviceId],
			foreignColumns: [clinicsService.id],
			name: "appointment_multiple_service_service_id_clinics_service_id_fk"
		}),
]);

export const appointmentNoShowActions = pgTable("appointment_no_show_actions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	doctorId: uuid("doctor_id"),
	clinicId: uuid("clinic_id").notNull(),
	markedByRole: markedByRole("marked_by_role").notNull(),
	markedByUserId: uuid("marked_by_user_id"),
	reason: text(),
	policySnapshot: json("policy_snapshot"),
	actionTaken: actionTaken("action_taken").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("no_show_appointment_idx").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("no_show_patient_idx").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "appointment_no_show_actions_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "appointment_no_show_actions_patient_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "appointment_no_show_actions_doctor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "appointment_no_show_actions_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.markedByUserId],
			foreignColumns: [users.id],
			name: "appointment_no_show_actions_marked_by_user_id_users_id_fk"
		}),
]);

export const doctorGallery = pgTable("doctor_gallery", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	imageUrl: text("image_url").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_gallery_doctor_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const doctorManualPrescription = pgTable("doctor_manual_prescription", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	doctorManualPrescription: varchar("doctor_manual_prescription", { length: 256 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "doctor_manual_prescription_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
]);

export const medicalCertificate = pgTable("medical_certificate", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	medicalCondition: text("medical_condition"),
	restDays: integer("rest_days"),
	notes: text().array(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "medical_certificate_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
]);

export const noShowPolicies = pgTable("no_show_policies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	gracePeriodMinutes: integer("grace_period_minutes").default(15).notNull(),
	rules: json().default([]).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "no_show_policies_clinic_id_clinics_id_fk"
		}).onDelete("cascade"),
	unique("no_show_policies_clinic_id_unique").on(table.clinicId),
]);

export const patientGallery = pgTable("patient_gallery", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	doctorId: uuid("doctor_id").notNull(),
	imageUrl: text("image_url").notNull(),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "patient_gallery_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "patient_gallery_patient_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "patient_gallery_doctor_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const banners = pgTable("banners", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	bannerType: bannerType("banner_type").notNull(),
	priority: bannerPriority().notNull(),
	placement: bannerPlacement().notNull(),
	ctaText: varchar("cta_text", { length: 100 }),
	ctaUrl: varchar("cta_url", { length: 2048 }),
	imageUrl: varchar("image_url", { length: 2048 }),
	thumbnailUrl: varchar("thumbnail_url", { length: 2048 }),
	imageAlt: varchar("image_alt", { length: 255 }),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }).notNull(),
	targetRoles: text("target_roles").array(),
	targetClinics: uuid("target_clinics").array(),
	targetSpecialties: text("target_specialties").array(),
	isSponsored: boolean("is_sponsored").default(false).notNull(),
	isDismissible: boolean("is_dismissible").default(true).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	status: bannerStatus().default('Draft').notNull(),
	displayOrder: integer("display_order").default(0),
	createdBy: uuid("created_by").notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("banner_placement_idx").using("btree", table.placement.asc().nullsLast().op("enum_ops")),
	index("banner_start_end_idx").using("btree", table.startDate.asc().nullsLast().op("timestamp_ops"), table.endDate.asc().nullsLast().op("timestamp_ops")),
	index("banner_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("banner_type_idx").using("btree", table.bannerType.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "banners_created_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "banners_updated_by_users_id_fk"
		}),
]);

export const bannerAnalytics = pgTable("banner_analytics", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	bannerId: uuid("banner_id").notNull(),
	userId: uuid("user_id").notNull(),
	clinicId: uuid("clinic_id"),
	eventType: varchar("event_type", { length: 50 }).notNull(),
	occurredAt: timestamp("occurred_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("banner_analytics_banner_idx").using("btree", table.bannerId.asc().nullsLast().op("uuid_ops")),
	index("banner_analytics_event_idx").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
	index("banner_analytics_occurred_idx").using("btree", table.occurredAt.asc().nullsLast().op("timestamp_ops")),
	index("banner_analytics_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.bannerId],
			foreignColumns: [banners.id],
			name: "banner_analytics_banner_id_banners_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "banner_analytics_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "banner_analytics_clinic_id_clinics_id_fk"
		}),
]);

export const bannerDismissals = pgTable("banner_dismissals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	bannerId: uuid("banner_id").notNull(),
	userId: uuid("user_id").notNull(),
	dismissedAt: timestamp("dismissed_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("banner_dismissal_banner_idx").using("btree", table.bannerId.asc().nullsLast().op("uuid_ops")),
	index("banner_dismissal_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.bannerId],
			foreignColumns: [banners.id],
			name: "banner_dismissals_banner_id_banners_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "banner_dismissals_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const cancellationAudits = pgTable("cancellation_audits", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventType: varchar("event_type", { length: 100 }).notNull(),
	clinicId: uuid("clinic_id"),
	userId: uuid("user_id"),
	details: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "cancellation_audits_clinic_id_clinics_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "cancellation_audits_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const cancellationRequests = pgTable("cancellation_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	userId: uuid("user_id").notNull(),
	userRole: varchar("user_role", { length: 50 }).notNull(),
	reasonCode: varchar("reason_code", { length: 50 }).notNull(),
	comments: varchar({ length: 500 }),
	isRescheduleRequest: boolean("is_reschedule_request").default(false).notNull(),
	status: varchar({ length: 50 }).default('Approved').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "cancellation_requests_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "cancellation_requests_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "cancellation_requests_user_id_users_id_fk"
		}),
]);

export const cancellationRefunds = pgTable("cancellation_refunds", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	cancellationRequestId: uuid("cancellation_request_id").notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	paymentId: uuid("payment_id").notNull(),
	refundType: varchar("refund_type", { length: 50 }).notNull(),
	originalPrice: numeric("original_price", { precision: 12, scale:  2 }).notNull(),
	refundAmount: numeric("refund_amount", { precision: 12, scale:  2 }).notNull(),
	refundStatus: varchar("refund_status", { length: 50 }).default('Pending').notNull(),
	gatewayRefundId: varchar("gateway_refund_id", { length: 255 }),
	gatewayResponse: jsonb("gateway_response"),
	failureReason: varchar("failure_reason", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.cancellationRequestId],
			foreignColumns: [cancellationRequests.id],
			name: "cancellation_refunds_cancellation_request_id_cancellation_reque"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "cancellation_refunds_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "cancellation_refunds_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [appointmentPayments.id],
			name: "cancellation_refunds_payment_id_appointment_payments_id_fk"
		}),
]);

export const clinicSymptoms = pgTable("clinic_symptoms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	name: varchar({ length: 150 }).notNull(),
	description: text(),
	status: clinicSymptomStatus().default('Active').notNull(),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_symptoms_clinic_id_clinics_id_fk"
		}),
]);

export const clinicSymptomCounts = pgTable("clinic_symptom_counts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symptomId: uuid("symptom_id").notNull(),
	date: date().notNull(),
	count: integer().default(0).notNull(),
}, (table) => [
	uniqueIndex("symptom_date_idx").using("btree", table.symptomId.asc().nullsLast().op("date_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.symptomId],
			foreignColumns: [clinicSymptoms.id],
			name: "clinic_symptom_counts_symptom_id_clinic_symptoms_id_fk"
		}),
]);

export const clinicAppointments = pgTable("clinic_appointments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	clincId: uuid("clinc_id").notNull(),
	doctorSubscriptionId: uuid("doctor_subscription_id").notNull(),
	expireAt: timestamp({ mode: 'string' }).notNull(),
	status: appointmentPlainStatus().default('active').notNull(),
	notes: text(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	paymentStatus: paymentStatusEnum("payment_status"),
	paymentMode: paymentModeEnum("payment_mode"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "clinic_appointments_doctor_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "clinic_appointments_patient_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.clincId],
			foreignColumns: [clinics.id],
			name: "clinic_appointments_clinc_id_clinics_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.doctorSubscriptionId],
			foreignColumns: [clinicsService.id],
			name: "clinic_appointments_doctor_subscription_id_clinics_service_id_f"
		}).onDelete("cascade"),
]);

export const clinicAvailability = pgTable("clinic_availability", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	dayOfWeek: varchar("day_of_week").notNull(),
	startTime: varchar("start_time"),
	endTime: varchar("end_time"),
	breaksStart: varchar("breaks_start"),
	breaksEnd: varchar("breaks_end"),
	isAvailable: boolean("is_available").default(true).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	doctorId: uuid("doctor_id"),
	slotMinutes: integer(),
	stepMinutes: integer(),
	noOfPatients: integer("no_of_patients"),
}, (table) => [
	uniqueIndex("ux_clinic_day").using("btree", table.clinicId.asc().nullsLast().op("text_ops"), table.dayOfWeek.asc().nullsLast().op("text_ops"), table.doctorId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_availability_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "clinic_availability_doctor_id_users_id_fk"
		}),
]);

export const clinicAvailabilityBreak = pgTable("clinic_availability_break", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	breakType: varchar("break_type").notNull(),
	startTime: varchar("start_time"),
	endTime: varchar("end_time"),
	notes: text(),
	status: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("ux_clinic_break").using("btree", table.clinicId.asc().nullsLast().op("text_ops"), table.breakType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinicAvailability.id],
			name: "clinic_availability_break_clinic_id_clinic_availability_id_fk"
		}),
]);

export const clinicDateAvailability = pgTable("clinic_date_availability", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	doctorId: uuid("doctor_id").notNull(),
	date: timestamp({ mode: 'string' }).notNull(),
	isAvailable: boolean("is_available").default(true).notNull(),
	notes: text(),
	slotMinutes: integer("slot_minutes"),
	stepMinutes: integer("step_minutes"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("ux_clinic_doctor_date").using("btree", table.clinicId.asc().nullsLast().op("timestamp_ops"), table.doctorId.asc().nullsLast().op("timestamp_ops"), table.date.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_date_availability_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "clinic_date_availability_doctor_id_users_id_fk"
		}),
]);

export const clinicDateAvailabilityTimeSlots = pgTable("clinic_date_availability_time_slots", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicDateAvailabilityId: uuid("clinic_date_availability_id").notNull(),
	startTime: varchar("start_time").notNull(),
	endTime: varchar("end_time").notNull(),
	isAvailable: boolean("is_available").default(true).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("ux_clinic_date_time_slot").using("btree", table.clinicDateAvailabilityId.asc().nullsLast().op("text_ops"), table.startTime.asc().nullsLast().op("text_ops"), table.endTime.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.clinicDateAvailabilityId],
			foreignColumns: [clinicDateAvailability.id],
			name: "clinic_date_availability_time_slots_clinic_date_availability_id"
		}).onDelete("cascade"),
]);

export const clinicReminders = pgTable("clinic_reminders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	timeValue: integer("time_value").notNull(),
	timeUnit: reminderTimeUnit("time_unit").default('Hours').notNull(),
	reminderType: varchar("reminder_type", { length: 50 }).default('Appointment').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "clinic_reminders_clinic_id_clinics_id_fk"
		}),
]);

export const doctorProfileUpdateRequests = pgTable("doctor_profile_update_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	requestedData: jsonb("requested_data").notNull(),
	status: text().default('pending'),
	reason: text(),
	rejectionReason: text("rejection_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_doctor_update_requests_clinic_status").using("btree", table.clinicId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("idx_doctor_update_requests_doctor_id").using("btree", table.doctorId.asc().nullsLast().op("uuid_ops")),
	index("idx_doctor_update_requests_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_profile_update_requests_doctor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "doctor_profile_update_requests_clinic_id_clinics_id_fk"
		}),
]);

export const doctorFavorites = pgTable("doctor_favorites", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	patientId: uuid("patient_id").notNull(),
	doctorId: uuid("doctor_id").notNull(),
}, (table) => [
	uniqueIndex("ux_doctor_favorite_patient_doctor").using("btree", table.patientId.asc().nullsLast().op("uuid_ops"), table.doctorId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "doctor_favorites_patient_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_favorites_doctor_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const doctorQualifications = pgTable("doctor_qualifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	qualificationType: varchar("qualification_type", { length: 20 }).notNull(),
	qualificationTitle: varchar("qualification_title", { length: 100 }).notNull(),
	specialization: varchar({ length: 100 }),
	boardOrUniversity: varchar("board_or_university", { length: 150 }),
	yearOfCompletion: integer("year_of_completion"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("ux_doctor_qualification_user").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.qualificationTitle.asc().nullsLast().op("text_ops"), table.specialization.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "doctor_qualifications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const doctorPrescriptionType = pgTable("doctor_prescription_type", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	prescriptionType: varchar("prescription_type", { length: 20 }),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_prescription_type_doctor_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const doctorManualTemplate = pgTable("doctor_manual_template", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	templateImage: varchar("template_image", { length: 256 }),
	templateHtml: text("template_html"),
	printType: varchar("print_type", { length: 20 }).default('Without Background'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_manual_template_doctor_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const doctorPreferences = pgTable("doctor_preferences", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	headerOrder: json("header_order").default(["Pathology Test Name","Advice","Pre-Diagnosis","Dietary Suggestions","Habits","Vitals","Allergy","Diagnosis","Surgery Suggested","Visiting Days","Follow-Up (days)"]),
	habitList: json("habit_list").default(["Alcohol","Smoking","Tobacco"]),
	allergyList: json("allergy_list").default(["Codeine","Contrast dye","Dust","Eggs","Latex","NKDA","NSAIDs","Peanuts/Nuts","Penicillin","Pollen","Shellfish","Sulfa drugs"]),
	diagnosisList: json("diagnosis_list").default(["Acidity","Allergy","Body pain","Cold/Cough","Dengue","Diarrhea","Fever","Flu","Headache","High BP","Low BP","Infection","Malaria","Migraine","Stomach pain","Diabetes","Typhoid","UTI","Viral fever"]),
	surgerySuggestedList: json("surgery_suggested_list").default(["Appendectomy","Hernia repair","Cataract surgery","Tonsillectomy","Cholecystectomy","Knee arthroscopy"]),
	dietarySuggestionsList: json("dietary_suggestions_list").default(["Drink boiled water.","Eat small, frequent meals.","Avoid spicy and oily foods.","Include fruits and vegetables.","Stay hydrated throughout the day.","Limit caffeine and alcohol.","Reduce salt and sugar intake.","Include protein-rich foods.","Avoid processed and junk foods.","Maintain a balanced diet."]),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_preferences_doctor_id_users_id_fk"
		}),
	unique("doctor_preferences_doctor_id_unique").on(table.doctorId),
]);

export const doctorReviews = pgTable("doctor_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	patientId: uuid("patient_id").notNull(),
	appointmentId: uuid("appointment_id").notNull(),
	rating: integer().notNull(),
	reviewText: varchar("review_text", { length: 1000 }),
	status: varchar({ length: 32 }).default('approved').notNull(),
	replyText: text("reply_text"),
	replyAt: timestamp("reply_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("doctor_reviews_doctor_id_idx").using("btree", table.doctorId.asc().nullsLast().op("uuid_ops")),
	index("doctor_reviews_patient_id_idx").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("ux_doctor_reviews_appointment").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_reviews_doctor_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "doctor_reviews_patient_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "doctor_reviews_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
]);

export const doctorTemplate = pgTable("doctor_template", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	templateHtml: text("template_html"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "doctor_template_doctor_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const feedbacks = pgTable("feedbacks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	patientId: uuid("patient_id"),
	doctorId: uuid("doctor_id"),
	appointmentId: uuid("appointment_id"),
	rating: integer().notNull(),
	comments: text(),
	attachments: text().array(),
	isAnonymous: boolean("is_anonymous").default(false).notNull(),
	status: varchar({ length: 32 }).default('new').notNull(),
	tags: jsonb().array(),
	response: text(),
	responseBy: uuid("response_by"),
	responseAt: timestamp("response_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "feedbacks_clinic_id_clinics_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "feedbacks_patient_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "feedbacks_doctor_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "feedbacks_appointment_id_appointments_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.responseBy],
			foreignColumns: [users.id],
			name: "feedbacks_response_by_users_id_fk"
		}).onDelete("cascade"),
]);

export const labs = pgTable("labs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	name: varchar().notNull(),
	address: text().notNull(),
	contactNo: varchar("contact_no").notNull(),
	email: varchar().notNull(),
	logo: text(),
	gstNumber: varchar("gst_number", { length: 50 }),
	reportFooter: text("report_footer"),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	labStatus: labStatus("lab_status").default('New').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_labs_clinic_id").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "labs_clinic_id_clinics_id_fk"
		}),
]);

export const labDepartments = pgTable("lab_departments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	labId: uuid("lab_id").notNull(),
	departmentId: uuid("department_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_departments_department_id").using("btree", table.departmentId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("lab_dept_unique").using("btree", table.labId.asc().nullsLast().op("uuid_ops"), table.departmentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "lab_departments_lab_id_labs_id_fk"
		}),
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [labDepartmentsMaster.id],
			name: "lab_departments_department_id_lab_departments_master_id_fk"
		}),
]);

export const labDepartmentsMaster = pgTable("lab_departments_master", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	code: varchar({ length: 80 }).notNull(),
	status: labCatalogStatus().default('active').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_departments_master_name").using("btree", table.name.asc().nullsLast().op("text_ops")),
	index("idx_lab_departments_master_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	uniqueIndex("lab_departments_master_code_unique").using("btree", table.code.asc().nullsLast().op("text_ops")),
]);

export const userLabAssignments = pgTable("user_lab_assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	labId: uuid("lab_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_lab_assignments_lab_id").using("btree", table.labId.asc().nullsLast().op("uuid_ops")),
	index("idx_user_lab_assignments_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("user_lab_assignments_user_lab_clinic_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.labId.asc().nullsLast().op("uuid_ops"), table.clinicId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_lab_assignments_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "user_lab_assignments_lab_id_labs_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "user_lab_assignments_clinic_id_clinics_id_fk"
		}),
]);

export const labInvoices = pgTable("lab_invoices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	invoiceNumber: varchar("invoice_number", { length: 40 }).notNull(),
	appointmentTestId: uuid("appointment_test_id").notNull(),
	testId: uuid("test_id"),
	clinicId: uuid("clinic_id").notNull(),
	labId: uuid("lab_id").notNull(),
	patientId: uuid("patient_id"),
	doctorId: uuid("doctor_id"),
	createdBy: uuid("created_by"),
	paymentMethod: varchar("payment_method", { length: 30 }).notNull(),
	totalAmount: numeric("total_amount", { precision: 12, scale:  2 }).default('0').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_invoices_clinic_id").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_invoices_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_lab_invoices_doctor_id").using("btree", table.doctorId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_invoices_lab_id").using("btree", table.labId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_invoices_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_invoices_test_id").using("btree", table.testId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("lab_invoices_appointment_test_unique").using("btree", table.appointmentTestId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("lab_invoices_invoice_number_unique").using("btree", table.invoiceNumber.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.appointmentTestId],
			foreignColumns: [labOrders.id],
			name: "lab_invoices_appointment_test_id_lab_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.testId],
			foreignColumns: [testCatalog.id],
			name: "lab_invoices_test_id_test_catalog_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "lab_invoices_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "lab_invoices_lab_id_labs_id_fk"
		}),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "lab_invoices_patient_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "lab_invoices_doctor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "lab_invoices_created_by_users_id_fk"
		}),
]);

export const testCatalog = pgTable("test_catalog", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	category: varchar({ length: 100 }),
	clinicId: uuid("clinic_id"),
	doctorId: uuid("doctor_id"),
	labTestId: uuid("lab_test_id"),
	price: integer(),
	status: patientsTestStatus().default('active').notNull(),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_test_catalog_doctor_id").using("btree", table.doctorId.asc().nullsLast().op("uuid_ops")),
	index("idx_test_catalog_lab_test_id").using("btree", table.labTestId.asc().nullsLast().op("uuid_ops")),
	index("idx_test_catalog_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	uniqueIndex("test_catalog_clinic_name_unique").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops"), table.name.asc().nullsLast().op("uuid_ops")).where(sql`(is_deleted = false)`),
	uniqueIndex("test_catalog_global_name_unique").using("btree", table.name.asc().nullsLast().op("text_ops")).where(sql`((clinic_id IS NULL) AND (is_deleted = false))`),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "test_catalog_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "test_catalog_doctor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.labTestId],
			foreignColumns: [labTestCatalog.id],
			name: "test_catalog_lab_test_id_lab_test_catalog_id_fk"
		}).onDelete("set null"),
]);

export const labOrderResults = pgTable("lab_order_results", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	labOrderId: uuid("lab_order_id").notNull(),
	appointmentTestId: uuid("appointment_test_id").notNull(),
	templateId: uuid("template_id").notNull(),
	status: labResultStatus().default('Draft').notNull(),
	enteredBy: uuid("entered_by"),
	verifiedBy: uuid("verified_by"),
	verifiedAt: timestamp("verified_at", { mode: 'string' }),
	remarks: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_order_results_appointment_test_id").using("btree", table.appointmentTestId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_order_results_lab_order_id").using("btree", table.labOrderId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("ux_lab_order_results_order_test_template").using("btree", table.labOrderId.asc().nullsLast().op("uuid_ops"), table.appointmentTestId.asc().nullsLast().op("uuid_ops"), table.templateId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.labOrderId],
			foreignColumns: [labOrders.id],
			name: "lab_order_results_lab_order_id_lab_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appointmentTestId],
			foreignColumns: [labOrders.id],
			name: "lab_order_results_appointment_test_id_lab_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [labReportTemplates.id],
			name: "lab_order_results_template_id_lab_report_templates_id_fk"
		}),
	foreignKey({
			columns: [table.enteredBy],
			foreignColumns: [users.id],
			name: "lab_order_results_entered_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.verifiedBy],
			foreignColumns: [users.id],
			name: "lab_order_results_verified_by_users_id_fk"
		}),
]);

export const labOrderResultValues = pgTable("lab_order_result_values", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	resultId: uuid("result_id").notNull(),
	parameterId: uuid("parameter_id").notNull(),
	parameterNameSnapshot: varchar("parameter_name_snapshot", { length: 255 }).notNull(),
	displayNameSnapshot: varchar("display_name_snapshot", { length: 255 }),
	value: text().notNull(),
	sectionNameSnapshot: varchar("section_name_snapshot", { length: 255 }),
	unitSnapshot: varchar("unit_snapshot", { length: 80 }),
	referenceRangeSnapshot: varchar("reference_range_snapshot", { length: 255 }),
	inputTypeSnapshot: varchar("input_type_snapshot", { length: 50 }),
	sortOrderSnapshot: integer("sort_order_snapshot"),
	isRequiredSnapshot: boolean("is_required_snapshot"),
	sourceTypeSnapshot: labParameterSourceType("source_type_snapshot").default('DEFAULT').notNull(),
	isCustomSnapshot: boolean("is_custom_snapshot").default(false).notNull(),
	flag: labResultFlag().default('Not Applicable').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_order_result_values_parameter_id").using("btree", table.parameterId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_order_result_values_result_id").using("btree", table.resultId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("ux_lab_order_result_values_result_parameter").using("btree", table.resultId.asc().nullsLast().op("uuid_ops"), table.parameterId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.resultId],
			foreignColumns: [labOrderResults.id],
			name: "lab_order_result_values_result_id_lab_order_results_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parameterId],
			foreignColumns: [labReportTemplateParameters.id],
			name: "lab_order_result_values_parameter_id_lab_report_template_parame"
		}),
]);

export const labReportTemplateParameters = pgTable("lab_report_template_parameters", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	templateId: uuid("template_id").notNull(),
	baseParameterId: uuid("base_parameter_id"),
	labId: uuid("lab_id"),
	sectionName: varchar("section_name", { length: 255 }),
	parameterName: varchar("parameter_name", { length: 255 }).notNull(),
	unit: varchar({ length: 80 }),
	referenceRange: varchar("reference_range", { length: 255 }),
	inputType: varchar("input_type", { length: 50 }).default('text').notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isRequired: boolean("is_required").default(true).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	isHidden: boolean("is_hidden").default(false).notNull(),
	sourceType: labParameterSourceType("source_type").default('DEFAULT').notNull(),
	isCustom: boolean("is_custom").default(false).notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_report_template_parameters_base_parameter_id").using("btree", table.baseParameterId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_report_template_parameters_lab_id").using("btree", table.labId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_report_template_parameters_template_id").using("btree", table.templateId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("ux_lab_report_template_parameters_default_override").using("btree", table.templateId.asc().nullsLast().op("uuid_ops"), table.labId.asc().nullsLast().op("uuid_ops"), table.createdBy.asc().nullsLast().op("uuid_ops"), table.baseParameterId.asc().nullsLast().op("uuid_ops")).where(sql`((lab_id IS NOT NULL) AND (source_type = 'DEFAULT'::lab_parameter_source_type) AND (is_custom = false) AND (base_parameter_id IS NOT NULL))`),
	uniqueIndex("ux_lab_report_template_parameters_global_default").using("btree", table.templateId.asc().nullsLast().op("text_ops"), table.parameterName.asc().nullsLast().op("text_ops")).where(sql`((lab_id IS NULL) AND (source_type = 'DEFAULT'::lab_parameter_source_type))`),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [labReportTemplates.id],
			name: "lab_report_template_parameters_template_id_lab_report_templates"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.baseParameterId],
			foreignColumns: [table.id],
			name: "lab_report_template_parameters_base_parameter_id_lab_report_tem"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "lab_report_template_parameters_lab_id_labs_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "lab_report_template_parameters_created_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "lab_report_template_parameters_updated_by_users_id_fk"
		}),
]);

export const labReportTemplates = pgTable("lab_report_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	labId: uuid("lab_id"),
	name: varchar({ length: 255 }).notNull(),
	code: varchar({ length: 50 }).notNull(),
	sampleType: varchar("sample_type", { length: 100 }).notNull(),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_report_templates_lab_id").using("btree", table.labId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("ux_lab_report_templates_code_global").using("btree", table.code.asc().nullsLast().op("text_ops")).where(sql`(lab_id IS NULL)`),
	uniqueIndex("ux_lab_report_templates_lab_code").using("btree", table.labId.asc().nullsLast().op("text_ops"), table.code.asc().nullsLast().op("text_ops")).where(sql`(lab_id IS NOT NULL)`),
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "lab_report_templates_lab_id_labs_id_fk"
		}),
]);

export const labSamples = pgTable("lab_samples", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	labId: uuid("lab_id").notNull(),
	labOrderId: uuid("lab_order_id").notNull(),
	appointmentTestId: uuid("appointment_test_id").notNull(),
	patientId: uuid("patient_id"),
	testId: uuid("test_id"),
	sampleType: varchar("sample_type", { length: 100 }),
	barcodeValue: varchar("barcode_value", { length: 40 }).notNull(),
	barcodeType: varchar("barcode_type", { length: 20 }).default('CODE128').notNull(),
	status: labSampleStatus().default('NOT_STARTED').notNull(),
	collectedBy: uuid("collected_by"),
	collectedAt: timestamp("collected_at", { mode: 'string' }),
	receivedAtLabBy: uuid("received_at_lab_by"),
	receivedAtLabAt: timestamp("received_at_lab_at", { mode: 'string' }),
	processingStartedAt: timestamp("processing_started_at", { mode: 'string' }),
	testingStartedAt: timestamp("testing_started_at", { mode: 'string' }),
	resultVerifiedAt: timestamp("result_verified_at", { mode: 'string' }),
	reportReadyAt: timestamp("report_ready_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_samples_clinic_id").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_samples_lab_id").using("btree", table.labId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_samples_lab_id_status").using("btree", table.labId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("enum_ops")),
	index("idx_lab_samples_lab_order_id").using("btree", table.labOrderId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_samples_patient_id").using("btree", table.patientId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_samples_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	uniqueIndex("lab_samples_appointment_test_unique").using("btree", table.appointmentTestId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("lab_samples_barcode_value_unique").using("btree", table.barcodeValue.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "lab_samples_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "lab_samples_lab_id_labs_id_fk"
		}),
	foreignKey({
			columns: [table.labOrderId],
			foreignColumns: [labOrders.id],
			name: "lab_samples_lab_order_id_lab_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appointmentTestId],
			foreignColumns: [labOrders.id],
			name: "lab_samples_appointment_test_id_lab_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.patientId],
			foreignColumns: [users.id],
			name: "lab_samples_patient_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.testId],
			foreignColumns: [testCatalog.id],
			name: "lab_samples_test_id_test_catalog_id_fk"
		}),
	foreignKey({
			columns: [table.collectedBy],
			foreignColumns: [users.id],
			name: "lab_samples_collected_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.receivedAtLabBy],
			foreignColumns: [users.id],
			name: "lab_samples_received_at_lab_by_users_id_fk"
		}),
]);

export const medicines = pgTable("medicines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	createdByUserId: uuid("created_by_user_id"),
	name: varchar({ length: 255 }).notNull(),
	sku: varchar({ length: 50 }),
	genericName: varchar("generic_name", { length: 255 }),
	manufacturer: varchar({ length: 255 }),
	composition: text(),
	form: varchar({ length: 50 }),
	strength: varchar({ length: 50 }),
	category: varchar({ length: 100 }),
	requiresPrescription: boolean("requires_prescription").default(false),
	isFavorite: boolean("is_favorite").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ux_medicine_name_global").using("btree", table.name.asc().nullsLast().op("text_ops"), table.form.asc().nullsLast().op("text_ops")).where(sql`(created_by_user_id IS NULL)`),
	uniqueIndex("ux_medicine_name_user").using("btree", table.name.asc().nullsLast().op("text_ops"), table.form.asc().nullsLast().op("text_ops"), table.createdByUserId.asc().nullsLast().op("text_ops")).where(sql`(created_by_user_id IS NOT NULL)`),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "medicines_created_by_user_id_users_id_fk"
		}),
]);

export const userMfa = pgTable("user_mfa", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	encryptedSecret: varchar("encrypted_secret", { length: 512 }).notNull(),
	isActive: boolean("is_active").default(false).notNull(),
	isPending: boolean("is_pending").default(true).notNull(),
	enabledAt: timestamp("enabled_at", { mode: 'string' }),
	lastModifiedAt: timestamp("last_modified_at", { mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_mfa_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_mfa_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("user_mfa_user_id_unique").on(table.userId),
]);

export const userMfaRecoveryCodes = pgTable("user_mfa_recovery_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	codeHash: varchar("code_hash", { length: 255 }).notNull(),
	isUsed: boolean("is_used").default(false).notNull(),
	usedAt: timestamp("used_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_mfa_recovery_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_mfa_recovery_codes_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: varchar({ length: 120 }).notNull(),
	title: text().notNull(),
	body: text().notNull(),
	data: jsonb(),
	read: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	metadata: jsonb(),
}, (table) => [
	index("notifications_user_created_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsLast().op("timestamp_ops")),
	index("notifications_user_unread_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsLast().op("timestamp_ops")).where(sql`(read = false)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const patientFamilyLinks = pgTable("patient_family_links", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	primaryPatientId: uuid("primary_patient_id").notNull(),
	linkedPatientId: uuid("linked_patient_id").notNull(),
	relationship: varchar({ length: 50 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("family_links_primary_idx").using("btree", table.primaryPatientId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.primaryPatientId],
			foreignColumns: [users.id],
			name: "patient_family_links_primary_patient_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.linkedPatientId],
			foreignColumns: [users.id],
			name: "patient_family_links_linked_patient_id_users_id_fk"
		}).onDelete("cascade"),
	unique("uq_family_link_pair").on(table.primaryPatientId, table.linkedPatientId),
]);

export const pharmacies = pgTable("pharmacies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	name: varchar({ length: 150 }).notNull(),
	address: text().notNull(),
	contactNumber: varchar("contact_number", { length: 20 }).notNull(),
	status: pharmacyStatus().default('active').notNull(),
	noLoss: pharmacyNoLoss("no_loss").default('true').notNull(),
	subscriptionNotificationReadDate: timestamp("subscription_notification_read_date", { mode: 'string' }),
	isDeleted: boolean("is_deleted").default(false).notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ux_pharmacy_name_clinic").using("btree", table.clinicId.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("text_ops"), table.isDeleted.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "pharmacies_clinic_id_clinics_id_fk"
		}),
]);

export const pharmacyMedicines = pgTable("pharmacy_medicines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyId: uuid("pharmacy_id").notNull(),
	medicineName: varchar("medicine_name", { length: 200 }).notNull(),
	brandName: varchar("brand_name", { length: 50 }),
	composition: varchar({ length: 200 }),
	category: varchar({ length: 100 }),
	hsnId: uuid("hsn_id").notNull(),
	form: varchar({ length: 50 }),
	shelf: varchar({ length: 100 }),
	reorder: integer(),
	packOf: integer("pack_of"),
	sku: varchar({ length: 50 }),
	status: medicineStatus().default('active').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_medicines_hsn_id_idx").using("btree", table.hsnId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_medicines_pharmacy_id_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_medicines_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	uniqueIndex("ux_medicine_name").using("btree", table.medicineName.asc().nullsLast().op("uuid_ops"), table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_medicines_pharmacy_id_pharmacies_id_fk"
		}),
	foreignKey({
			columns: [table.hsnId],
			foreignColumns: [hsnTaxMaster.id],
			name: "pharmacy_medicines_hsn_id_hsn_tax_master_id_fk"
		}),
]);

export const hsnTaxMaster = pgTable("hsn_tax_master", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	hsnCode: varchar("hsn_code", { length: 8 }).notNull(),
	gstPercentage: numeric("gst_percentage", { precision: 5, scale:  2 }).notNull(),
	description: varchar({ length: 255 }),
	effectiveFrom: date("effective_from").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_hsn_code").using("btree", table.hsnCode.asc().nullsLast().op("text_ops")),
	uniqueIndex("uq_hsn_effective").using("btree", table.hsnCode.asc().nullsLast().op("date_ops"), table.effectiveFrom.asc().nullsLast().op("date_ops")),
]);

export const pharmacyMedicineTags = pgTable("pharmacy_medicine_tags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyId: uuid("pharmacy_id"),
	tag: varchar({ length: 50 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_pharmacy_tags_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_pharmacy_tags_pharmacy_id").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	index("idx_pharmacy_tags_tag").using("btree", table.tag.asc().nullsLast().op("text_ops")),
	uniqueIndex("uk_pharmacy_tag").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops"), table.tag.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_medicine_tags_pharmacy_id_pharmacies_id_fk"
		}).onDelete("cascade"),
]);

export const pharmacyTagsMap = pgTable("pharmacy_tags_map", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	medicineId: uuid("medicine_id").notNull(),
	tagId: uuid("tag_id").notNull(),
}, (table) => [
	index("idx_tags_map_medicine_id").using("btree", table.medicineId.asc().nullsLast().op("uuid_ops")),
	index("idx_tags_map_tag_id").using("btree", table.tagId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("uk_medicine_tag").using("btree", table.medicineId.asc().nullsLast().op("uuid_ops"), table.tagId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.medicineId],
			foreignColumns: [pharmacyMedicines.id],
			name: "pharmacy_tags_map_medicine_id_pharmacy_medicines_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tagId],
			foreignColumns: [pharmacyMedicineTags.id],
			name: "pharmacy_tags_map_tag_id_pharmacy_medicine_tags_id_fk"
		}).onDelete("cascade"),
]);

export const pharmacyPatientSubscription = pgTable("pharmacy_patient_subscription", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyId: uuid("pharmacy_id").notNull(),
	customerId: uuid("customer_id"),
	customerName: varchar("customer_name", { length: 50 }),
	customerMobile: varchar("customer_mobile", { length: 15 }),
	customerAddress: varchar("customer_address", { length: 100 }),
	frequencyDays: integer("frequency_days").notNull(),
	nextDeliveryDate: timestamp("next_delivery_date", { mode: 'string' }).notNull(),
	status: pharmacySubscriptionStatus().default('active').notNull(),
	remarks: varchar({ length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_subscription_delivery_idx").using("btree", table.nextDeliveryDate.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_subscription_mobile_idx").using("btree", table.customerMobile.asc().nullsLast().op("text_ops")),
	index("pharmacy_subscription_pharmacy_id_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_patient_subscription_pharmacy_id_pharmacies_id_fk"
		}),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "pharmacy_patient_subscription_customer_id_users_id_fk"
		}),
]);

export const pharmacySubscriptionMedicines = pgTable("pharmacy_subscription_medicines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyPatientSubscriptionId: uuid("pharmacy_patient_subscription_id").notNull(),
	pharmacyMedicineId: uuid("pharmacy_medicine_id").notNull(),
	quantity: integer().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("subscription_medicine_medicine_idx").using("btree", table.pharmacyMedicineId.asc().nullsLast().op("uuid_ops")),
	index("subscription_medicine_subscription_idx").using("btree", table.pharmacyPatientSubscriptionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyPatientSubscriptionId],
			foreignColumns: [pharmacyPatientSubscription.id],
			name: "pharmacy_subscription_medicines_pharmacy_patient_subscription_i"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.pharmacyMedicineId],
			foreignColumns: [pharmacyMedicines.id],
			name: "pharmacy_subscription_medicines_pharmacy_medicine_id_pharmacy_m"
		}),
]);

export const pharmacySubscriptionSalesMap = pgTable("pharmacy_subscription_sales_map", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyPatientSubscriptionId: uuid("pharmacy_patient_subscription_id").notNull(),
	pharmacySalesId: uuid("pharmacy_sales_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("subscription_sales_sales_idx").using("btree", table.pharmacySalesId.asc().nullsLast().op("uuid_ops")),
	index("subscription_sales_subscription_idx").using("btree", table.pharmacyPatientSubscriptionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyPatientSubscriptionId],
			foreignColumns: [pharmacyPatientSubscription.id],
			name: "pharmacy_subscription_sales_map_pharmacy_patient_subscription_i"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.pharmacySalesId],
			foreignColumns: [pharmacySales.id],
			name: "pharmacy_subscription_sales_map_pharmacy_sales_id_pharmacy_sale"
		}),
]);

export const pharmacySales = pgTable("pharmacy_sales", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyId: uuid("pharmacy_id").notNull(),
	createdBy: uuid("created_by").notNull(),
	prescriptionId: uuid("prescription_id"),
	patientName: varchar("patient_name", { length: 50 }),
	patientMobile: varchar("patient_mobile", { length: 15 }),
	paymentMethod: varchar("payment_method"),
	paymentNotes: varchar("payment_notes", { length: 100 }),
	totalItems: integer("total_items").default(0),
	subtotal: numeric({ precision: 12, scale:  2 }).default('0'),
	gstAmount: numeric("gst_amount", { precision: 12, scale:  2 }).default('0'),
	discountAmount: numeric("discount_amount", { precision: 12, scale:  2 }).default('0'),
	totalAmount: numeric("total_amount", { precision: 12, scale:  2 }).default('0'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_sales_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_sales_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_sales_pharmacy_created_idx").using("btree", table.pharmacyId.asc().nullsLast().op("timestamp_ops"), table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_sales_pharmacy_id_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_sales_prescription_id_idx").using("btree", table.prescriptionId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_sales_pharmacy_id_pharmacies_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "pharmacy_sales_created_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.prescriptionId],
			foreignColumns: [prescriptionQueue.id],
			name: "pharmacy_sales_prescription_id_prescription_queue_id_fk"
		}),
]);

export const prescriptionQueue = pgTable("prescription_queue", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reportId: uuid("report_id"),
	appointmentId: uuid("appointment_id").notNull(),
	doctorId: uuid("doctor_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	pharmacyUserId: uuid("pharmacy_user_id"),
	status: prescriptionStatus().default('PENDING').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("prescription_queue_appointment_id_idx").using("btree", table.appointmentId.asc().nullsLast().op("uuid_ops")),
	index("prescription_queue_clinic_status_idx").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("prescription_queue_doctor_id_idx").using("btree", table.doctorId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.reportId],
			foreignColumns: [reportCards.id],
			name: "prescription_queue_report_id_report_cards_id_fk"
		}),
	foreignKey({
			columns: [table.appointmentId],
			foreignColumns: [appointments.id],
			name: "prescription_queue_appointment_id_appointments_id_fk"
		}),
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "prescription_queue_doctor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "prescription_queue_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.pharmacyUserId],
			foreignColumns: [users.id],
			name: "prescription_queue_pharmacy_user_id_users_id_fk"
		}),
]);

export const pharmacySalesItems = pgTable("pharmacy_sales_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacySalesId: uuid("pharmacy_sales_id").notNull(),
	pharmacyStockMedicineId: uuid("pharmacy_stock_medicine_id").notNull(),
	quantity: integer().default(0),
	discountPercent: numeric("discount_percent", { precision: 12, scale:  2 }).default('0'),
	total: numeric({ precision: 12, scale:  2 }).default('0'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_sales_items_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_sales_items_sales_id_idx").using("btree", table.pharmacySalesId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_sales_items_stock_medicine_idx").using("btree", table.pharmacyStockMedicineId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("ux_sales_item").using("btree", table.pharmacySalesId.asc().nullsLast().op("uuid_ops"), table.pharmacyStockMedicineId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacySalesId],
			foreignColumns: [pharmacySales.id],
			name: "pharmacy_sales_items_pharmacy_sales_id_pharmacy_sales_id_fk"
		}),
	foreignKey({
			columns: [table.pharmacyStockMedicineId],
			foreignColumns: [pharmacyStockMedicine.id],
			name: "pharmacy_sales_items_pharmacy_stock_medicine_id_pharmacy_stock_"
		}),
]);

export const pharmacyStockMedicine = pgTable("pharmacy_stock_medicine", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyStockId: uuid("pharmacy_stock_id").notNull(),
	pharmacyMedicineId: uuid("pharmacy_medicine_id").notNull(),
	batch: varchar({ length: 50 }),
	expiry: timestamp({ mode: 'string' }),
	quantity: integer(),
	mrp: numeric({ precision: 12, scale:  2 }),
	cost: numeric({ precision: 12, scale:  2 }),
	totalCost: numeric("total_cost", { precision: 12, scale:  2 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_stock_medicine_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_stock_medicine_expiry_idx").using("btree", table.expiry.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_stock_medicine_medicine_id_idx").using("btree", table.pharmacyMedicineId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_stock_medicine_quantity_idx").using("btree", table.quantity.asc().nullsLast().op("int4_ops")),
	index("pharmacy_stock_medicine_stock_id_idx").using("btree", table.pharmacyStockId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("ux_pharmacy_medicine_batch").using("btree", table.pharmacyStockId.asc().nullsLast().op("text_ops"), table.pharmacyMedicineId.asc().nullsLast().op("text_ops"), table.batch.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyStockId],
			foreignColumns: [pharmacyStock.id],
			name: "pharmacy_stock_medicine_pharmacy_stock_id_pharmacy_stock_id_fk"
		}),
	foreignKey({
			columns: [table.pharmacyMedicineId],
			foreignColumns: [pharmacyMedicines.id],
			name: "pharmacy_stock_medicine_pharmacy_medicine_id_pharmacy_medicines"
		}),
]);

export const pharmacyStock = pgTable("pharmacy_stock", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyId: uuid("pharmacy_id").notNull(),
	pharmacySupplierId: uuid("pharmacy_supplier_id"),
	purchaseDate: timestamp("purchase_date", { mode: 'string' }).notNull(),
	invoice: varchar(),
	pharmacyStockPaymentStatus: pharmacyStockPaymentStatus("pharmacy_stock_payment_status").notNull(),
	paymentNotes: varchar("payment_notes", { length: 100 }),
	unit: integer().default(0),
	totalAmount: numeric("total_amount", { precision: 12, scale:  2 }).default('0'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_stock_pharmacy_id_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_stock_pharmacy_payment_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops"), table.pharmacyStockPaymentStatus.asc().nullsLast().op("enum_ops")),
	index("pharmacy_stock_purchase_date_idx").using("btree", table.purchaseDate.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_stock_pharmacy_id_pharmacies_id_fk"
		}),
	foreignKey({
			columns: [table.pharmacySupplierId],
			foreignColumns: [pharmacySuppliers.id],
			name: "pharmacy_stock_pharmacy_supplier_id_pharmacy_suppliers_id_fk"
		}),
]);

export const pharmacySuppliers = pgTable("pharmacy_suppliers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pharmacyId: uuid("pharmacy_id").notNull(),
	supplierName: varchar("supplier_name", { length: 100 }).notNull(),
	contactPerson: varchar("contact_person", { length: 50 }).notNull(),
	phone: varchar({ length: 20 }).notNull(),
	email: varchar({ length: 60 }),
	address: text(),
	gstNumber: varchar("gst_number", { length: 30 }),
	panNumber: varchar("pan_number", { length: 20 }),
	creditDays: integer("credit_days").default(0),
	status: supplierStatus().default('active').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("pharmacy_suppliers_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("pharmacy_suppliers_gst_number_idx").using("btree", table.gstNumber.asc().nullsLast().op("text_ops")),
	index("pharmacy_suppliers_pharmacy_id_idx").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_suppliers_pharmacy_status_idx").using("btree", table.pharmacyId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("pharmacy_suppliers_phone_idx").using("btree", table.phone.asc().nullsLast().op("text_ops")),
	index("pharmacy_suppliers_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	uniqueIndex("ux_supplier_name_pharmacy").using("btree", table.pharmacyId.asc().nullsLast().op("uuid_ops"), table.supplierName.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_suppliers_pharmacy_id_pharmacies_id_fk"
		}),
	unique("pharmacy_suppliers_email_unique").on(table.email),
]);

export const pharmacyAssign = pgTable("pharmacy_assign", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	pharmacyId: uuid("pharmacy_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	userRole: varchar("user_role", { length: 32 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ux_pharmacy_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.pharmacyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "pharmacy_assign_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.pharmacyId],
			foreignColumns: [pharmacies.id],
			name: "pharmacy_assign_pharmacy_id_pharmacies_id_fk"
		}),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "pharmacy_assign_clinic_id_clinics_id_fk"
		}),
]);

export const quickPrintTemplates = pgTable("quick_print_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	selectedTemplate: varchar("selected_template", { length: 50 }).default('compact-medicine-slip').notNull(),
	fontFamily: varchar("font_family", { length: 100 }).default('Inter, sans-serif'),
	accentColor: varchar("accent_color", { length: 20 }).default('#0A6C74'),
	elementConfig: jsonb("element_config").default({"showAdvice":true,"showFooter":true,"showQrCode":false,"sectionOrder":["clinicHeader","patientInfo","diagnosis","medicineTable","advice","followUp","doctorSignature","footer"],"showFollowUp":true,"showDiagnosis":true,"showVisitDate":true,"showClinicLogo":true,"showDoctorName":true,"showPatientAge":true,"showPatientName":true,"showPatientUhid":true,"showClinicHeader":true,"showMedicineTable":true,"showPatientGender":true,"showPatientMobile":true,"showPatientAddress":false,"showDoctorSignature":true,"showMedicineQuantity":false,"showDoctorRegistration":false,"showDoctorQualification":true,"showMedicineComposition":true,"showMedicineInstructions":true}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "quick_print_templates_doctor_id_users_id_fk"
		}).onDelete("cascade"),
	unique("quick_print_templates_doctor_id_unique").on(table.doctorId),
]);

export const prescriptions = pgTable("prescriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reportCardId: uuid("report_card_id").notNull(),
	petientId: uuid("petient_id").notNull(),
	medicineId: uuid("medicine_id"),
	prescribedBy: uuid("prescribed_by"),
	medicineName: varchar("medicine_name").notNull(),
	composition: varchar(),
	strength: varchar(),
	dosage: varchar().notNull(),
	frequency: varchar().notNull(),
	duration: varchar().notNull(),
	manufacturer: varchar(),
	medicineCount: varchar("medicine_count"),
	marketer: varchar(),
	imageUrl: text("image_url"),
	notes: text(),
	uses: json(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.reportCardId],
			foreignColumns: [reportCards.id],
			name: "prescriptions_report_card_id_report_cards_id_fk"
		}),
	foreignKey({
			columns: [table.petientId],
			foreignColumns: [users.id],
			name: "prescriptions_petient_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.medicineId],
			foreignColumns: [medicines.id],
			name: "prescriptions_medicine_id_medicines_id_fk"
		}),
	foreignKey({
			columns: [table.prescribedBy],
			foreignColumns: [users.id],
			name: "prescriptions_prescribed_by_users_id_fk"
		}),
]);

export const reports = pgTable("reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reportType: varchar("report_type", { length: 150 }).notNull(),
	description: text(),
	petientId: uuid("petient_id").notNull(),
	reportDocs: text("report_docs").notNull(),
	reportStatus: reportStatus("report_status").default('Pendig').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("ux_report").using("btree", table.reportType.asc().nullsLast().op("text_ops"), table.petientId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.petientId],
			foreignColumns: [users.id],
			name: "reports_petient_id_users_id_fk"
		}),
]);

export const favouritePrescription = pgTable("favourite_prescription", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	doctorId: uuid("doctor_id").notNull(),
	favouritePrescriptionName: varchar("favourite_prescription_name"),
	medicine: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.doctorId],
			foreignColumns: [users.id],
			name: "favourite_prescription_doctor_id_users_id_fk"
		}),
]);

export const settings = pgTable("settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	emailNotification: boolean("email_notification").default(false).notNull(),
	smsNotification: boolean("sms_notification").default(false).notNull(),
	whatsappNotification: boolean("whatsapp_notification").default(false).notNull(),
	appointmentReminder: integer("appointment_reminder").default(1).notNull(),
	notificationPreferences: jsonb("notification_preferences"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("setting_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "settings_user_id_users_id_fk"
		}),
]);

export const addOns = pgTable("add_ons", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 150 }).notNull(),
	description: text(),
	featureKey: varchar("feature_key", { length: 100 }).notNull(),
	unitValue: integer("unit_value").default(1).notNull(),
	monthlyPrice: numeric("monthly_price", { precision: 12, scale:  2 }).default('0.00').notNull(),
	yearlyPrice: numeric("yearly_price", { precision: 12, scale:  2 }).default('0.00').notNull(),
	currency: varchar({ length: 8 }).default('INR').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("add_on_feature_key_unique").using("btree", table.featureKey.asc().nullsLast().op("text_ops")),
	unique("add_ons_feature_key_unique").on(table.featureKey),
]);

export const clinicAddOns = pgTable("clinic_add_ons", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	addOnId: uuid("add_on_id").notNull(),
	quantity: integer().default(1).notNull(),
	billingCycle: varchar("billing_cycle", { length: 20 }).notNull(),
	startsAt: timestamp("starts_at", { mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
	provider: varchar({ length: 80 }),
	providerSubscriptionId: varchar("provider_subscription_id", { length: 200 }),
	paymentStatus: varchar("payment_status", { length: 20 }).default('pending'),
	paymentMode: varchar("payment_mode", { length: 20 }),
	transactionId: varchar("transaction_id", { length: 100 }),
	price: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
	cancelledAt: timestamp("cancelled_at", { mode: 'string' }),
	cancellationReason: varchar("cancellation_reason", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("clinic_add_ons_active_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("clinic_add_ons_add_on_idx").using("btree", table.addOnId.asc().nullsLast().op("uuid_ops")),
	index("clinic_add_ons_clinic_idx").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.addOnId],
			foreignColumns: [addOns.id],
			name: "clinic_add_ons_add_on_id_add_ons_id_fk"
		}).onDelete("cascade"),
]);

export const coupons = pgTable("coupons", {
	id: serial().primaryKey().notNull(),
	code: varchar({ length: 50 }).notNull(),
	description: text(),
	discountType: discountType("discount_type").notNull(),
	discountValue: numeric("discount_value", { precision: 10, scale:  2 }).notNull(),
	maxDiscountAmount: numeric("max_discount_amount", { precision: 10, scale:  2 }),
	trialDays: integer("trial_days"),
	appliesTo: appliesTo("applies_to").default('all').notNull(),
	applicablePlanIds: jsonb("applicable_plan_ids"),
	applicableAddonIds: jsonb("applicable_addon_ids"),
	maxUses: integer("max_uses"),
	maxUsesPerClinic: integer("max_uses_per_clinic").default(1),
	minOrderValue: numeric("min_order_value", { precision: 10, scale:  2 }),
	firstTimeOnly: boolean("first_time_only").default(false).notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	status: couponStatus().default('active').notNull(),
	currentUses: integer("current_uses").default(0).notNull(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("coupons_code_idx").using("btree", table.code.asc().nullsLast().op("text_ops")),
	index("coupons_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	unique("coupons_code_unique").on(table.code),
]);

export const couponUsage = pgTable("coupon_usage", {
	id: serial().primaryKey().notNull(),
	couponId: integer("coupon_id").notNull(),
	clinicId: uuid("clinic_id").notNull(),
	planId: uuid("plan_id"),
	addonId: uuid("addon_id"),
	orderValue: numeric("order_value", { precision: 10, scale:  2 }).notNull(),
	discountAmount: numeric("discount_amount", { precision: 10, scale:  2 }).notNull(),
	finalAmount: numeric("final_amount", { precision: 10, scale:  2 }).notNull(),
	razorpayOrderId: varchar("razorpay_order_id", { length: 255 }),
	razorpayPaymentId: varchar("razorpay_payment_id", { length: 255 }),
	billingCycle: varchar("billing_cycle", { length: 20 }),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("coupon_usage_clinic_used_idx").using("btree", table.clinicId.asc().nullsLast().op("timestamptz_ops"), table.usedAt.asc().nullsLast().op("timestamptz_ops")),
	index("coupon_usage_coupon_id_idx").using("btree", table.couponId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.couponId],
			foreignColumns: [coupons.id],
			name: "coupon_usage_coupon_id_coupons_id_fk"
		}).onDelete("cascade"),
]);

export const subscriptionPlans = pgTable("subscription_plans", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: varchar({ length: 80 }).notNull(),
	name: varchar({ length: 150 }).notNull(),
	description: varchar({ length: 255 }),
	price: numeric({ precision: 12, scale:  2 }).default('0.00').notNull(),
	currency: varchar({ length: 8 }).default('INR').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("subscription_plan_unique").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	unique("subscription_plans_slug_unique").on(table.slug),
]);

export const planFeatures = pgTable("plan_features", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	planId: uuid("plan_id").notNull(),
	featureKey: varchar("feature_key", { length: 100 }).notNull(),
	displayName: varchar("display_name", { length: 150 }),
	description: varchar({ length: 255 }),
	type: varchar({ length: 20 }).default('numeric').notNull(),
	limitValue: integer("limit_value"),
	isUnlimited: boolean("is_unlimited").default(false).notNull(),
	enabled: boolean().default(true).notNull(),
	sortOrder: integer("sort_order").default(0),
	isMarketingFeature: boolean("is_marketing_feature").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("plan_features_plan_key_unique").using("btree", table.planId.asc().nullsLast().op("text_ops"), table.featureKey.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [subscriptionPlans.id],
			name: "plan_features_plan_id_subscription_plans_id_fk"
		}).onDelete("cascade"),
]);

export const independentPatients = pgTable("independent_patients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	mobile: varchar({ length: 20 }).notNull(),
	age: integer().notNull(),
	gender: varchar({ length: 50 }).notNull(),
	doctorName: varchar("doctor_name", { length: 255 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const labOrderTrackingEvents = pgTable("lab_order_tracking_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clinicId: uuid("clinic_id").notNull(),
	labId: uuid("lab_id").notNull(),
	appointmentTestId: uuid("appointment_test_id").notNull(),
	eventType: varchar("event_type", { length: 80 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	actorUserId: uuid("actor_user_id"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_lab_order_tracking_events_appointment_test_id").using("btree", table.appointmentTestId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_order_tracking_events_clinic_id").using("btree", table.clinicId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_order_tracking_events_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_lab_order_tracking_events_lab_id").using("btree", table.labId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "lab_order_tracking_events_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "lab_order_tracking_events_lab_id_labs_id_fk"
		}),
	foreignKey({
			columns: [table.appointmentTestId],
			foreignColumns: [labOrders.id],
			name: "lab_order_tracking_events_appointment_test_id_lab_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "lab_order_tracking_events_actor_user_id_users_id_fk"
		}),
]);

export const labTestCatalog = pgTable("lab_test_catalog", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	testCode: varchar("test_code", { length: 100 }),
	category: varchar({ length: 100 }),
	price: integer(),
	clinicId: uuid("clinic_id"),
	labId: uuid("lab_id"),
	departmentId: uuid("department_id"),
	sampleType: varchar("sample_type", { length: 100 }),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	source: labTestSource().default('custom').notNull(),
	status: labTestsStatus().default('active').notNull(),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_lab_test_catalog_department_id").using("btree", table.departmentId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_test_catalog_lab_id").using("btree", table.labId.asc().nullsLast().op("uuid_ops")),
	index("idx_lab_test_catalog_status").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("idx_lab_test_catalog_test_code").using("btree", table.testCode.asc().nullsLast().op("text_ops")),
	uniqueIndex("lab_test_catalog_lab_department_custom_name_unique").using("btree", table.labId.asc().nullsLast().op("uuid_ops"), table.departmentId.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("text_ops")).where(sql`((source = 'custom'::lab_test_source) AND (deleted_at IS NULL))`),
	foreignKey({
			columns: [table.clinicId],
			foreignColumns: [clinics.id],
			name: "lab_test_catalog_clinic_id_clinics_id_fk"
		}),
	foreignKey({
			columns: [table.labId],
			foreignColumns: [labs.id],
			name: "lab_test_catalog_lab_id_labs_id_fk"
		}),
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [labDepartmentsMaster.id],
			name: "lab_test_catalog_department_id_lab_departments_master_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "lab_test_catalog_created_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "lab_test_catalog_updated_by_users_id_fk"
		}),
]);

export const referrals = pgTable("referrals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	referredTo: uuid("referred_to"),
	referredBy: uuid("referred_by"),
	referralCode: varchar("referral_code").notNull(),
	status: referralStatus().default('pending').notNull(),
	comments: varchar(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	uniqueIndex("referral_code_unique").using("btree", table.referralCode.asc().nullsLast().op("text_ops")),
	index("referral_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("referral_referred_by_idx").using("btree", table.referredBy.asc().nullsLast().op("uuid_ops")),
	index("referral_referred_to_idx").using("btree", table.referredTo.asc().nullsLast().op("uuid_ops")),
	index("referral_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.referredTo],
			foreignColumns: [users.id],
			name: "referrals_referred_to_users_id_fk"
		}),
	foreignKey({
			columns: [table.referredBy],
			foreignColumns: [users.id],
			name: "referrals_referred_by_users_id_fk"
		}),
	unique("referrals_referral_code_unique").on(table.referralCode),
]);

export const tokens = pgTable("tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	email: varchar({ length: 255 }),
	tokenHash: varchar("token_hash", { length: 200 }).notNull(),
	type: tokenType().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	used: boolean().default(false).notNull(),
	resendCount: integer("resend_count").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("tokens_patient_otp_mobile_idx").using("btree", table.email.asc().nullsLast().op("text_ops"), table.type.asc().nullsLast().op("enum_ops")),
	uniqueIndex("unique_registration_token").using("btree", table.email.asc().nullsLast().op("enum_ops"), table.tokenHash.asc().nullsLast().op("enum_ops"), table.type.asc().nullsLast().op("enum_ops")),
	uniqueIndex("unique_token_hash").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.tokenHash.asc().nullsLast().op("enum_ops"), table.type.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "tokens_user_id_users_id_fk"
		}),
]);

export const userDevices = pgTable("user_devices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	deviceToken: varchar("device_token", { length: 255 }).notNull(),
	platform: varchar({ length: 20 }).notNull(),
	snsEndpointArn: varchar("sns_endpoint_arn", { length: 500 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_devices_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("user_devices_device_token_unique").on(table.deviceToken),
]);

export const userProfessionals = pgTable("user_professionals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	qualification: text(),
	yearsOfExperience: integer("years_of_experience"),
	licenseNumber: text("license_number"),
	speciality: text(),
	registrationNumber: varchar("registration_number", { length: 100 }),
	about: varchar({ length: 1000 }),
	averageRating: numeric("average_rating", { precision: 3, scale:  2 }).default('0.00').notNull(),
	reviewCount: integer("review_count").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("user_professional_license_idx").using("btree", table.licenseNumber.asc().nullsLast().op("text_ops")),
	index("user_professional_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_professionals_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("user_professionals_user_id_unique").on(table.userId),
]);

export const userProfiles = pgTable("user_profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	alternateMobile: varchar("alternate_mobile"),
	gender: varchar(),
	address: text(),
	city: varchar(),
	state: varchar(),
	zipCode: varchar("zip_code", { length: 10 }),
	profileImage: text("profile_image"),
	age: integer(),
	dob: varchar({ length: 20 }),
	upiIds: jsonb("upi_ids"),
	bloodGroup: varchar("blood_group", { length: 5 }),
	height: varchar({ length: 10 }),
	weight: varchar({ length: 10 }),
	allergies: jsonb(),
	chronicConditions: jsonb("chronic_conditions"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("user_profile_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_profiles_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("user_profiles_user_id_unique").on(table.userId),
]);
