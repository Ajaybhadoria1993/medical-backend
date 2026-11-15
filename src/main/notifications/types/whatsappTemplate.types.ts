export interface WhatsAppTemplateParams {
  appointmentBooked: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    date: string;
    timeOrToken: string;
    appointmentId: string;
  };
  appointmentReminder: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    date: string;
    timeOrToken: string;
    appointmentId: string;
  };
  appointmentCancelled: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    date: string;
    timeOrToken: string;
    appointmentId: string;
  };
  consultationStarted: {
    patientName: string;
    doctorName: string;
    clinicName: string;
  };
  doctorRunningLate: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    timeOrToken: string;
    appointmentId: string;
  };
  appointmentRescheduled: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    date: string;
    timeOrToken: string;
  };
  appointmentNoShow: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    actionTaken: string;
    reason: string;
  };
  appointmentCompleted: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    appointmentId: string;
  };
  appointmentFollowUp: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    followUpDate: string;
  };
  labReportReady: {
    patientName: string;
    testName: string;
    labName: string;
    reportUrl: string;
  };
  labPaymentReceived: {
    patientName: string;
    amount: string;
    testName: string;
    labName: string;
    invoiceNumber: string;
  };
  pharmacyInvoice: {
    customerName: string;
    pharmacyName: string;
    invoiceUrl: string;
  };
}

export type WhatsAppTemplateKey = keyof WhatsAppTemplateParams;

export interface WhatsAppTemplateDefinition<K extends WhatsAppTemplateKey> {
  envVar: string;
  defaultName: string;
  toBodyParams: (params: WhatsAppTemplateParams[K]) => string[];
  /** Dynamic URL button suffixes, in button order. */
  toUrlButtonParams?: (params: WhatsAppTemplateParams[K]) => string[];
  /** Env var holding a public image URL, for templates with an IMAGE header. */
  headerImageEnvVar?: string;
}

export type WhatsAppTemplateMessage = {
  [K in WhatsAppTemplateKey]: { key: K; params: WhatsAppTemplateParams[K] };
}[WhatsAppTemplateKey];
