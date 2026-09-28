export interface WhatsAppTemplateParams {
  appointmentBooked: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    date: string;
    timeOrToken: string;
  };
  appointmentReminder: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    date: string;
    timeOrToken: string;
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
}

export type WhatsAppTemplateMessage = {
  [K in WhatsAppTemplateKey]: { key: K; params: WhatsAppTemplateParams[K] };
}[WhatsAppTemplateKey];
