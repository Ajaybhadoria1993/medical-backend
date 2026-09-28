/* eslint-disable no-console */
import axios from 'axios';
import { envConfig } from '../utils/envConfig';
import { sendWhatsAppTemplate } from '../utils/smsClient';
import { WhatsAppService } from '../main/notifications/services/whatsapp.service';
import {
  WhatsAppTemplateKey,
  WhatsAppTemplateParams,
} from '../main/notifications/types/whatsappTemplate.types';
import {
  WHATSAPP_TEMPLATES,
  normalizeWhatsAppNumber,
  resolveTemplateName,
} from '../main/notifications/utils/whatsappTemplate.utils';

const LANGUAGE_CODE = process.env.WHATSAPP_LANGUAGE_CODE || 'en';

const SAMPLES: { [K in WhatsAppTemplateKey]: WhatsAppTemplateParams[K] } = {
  appointmentBooked: {
    patientName: 'Asha Nair',
    doctorName: 'Dr. Rajesh Kumar',
    clinicName: 'Apollo Clinic',
    date: 'Thu, 23 Jul 2026',
    timeOrToken: 'Time: 10:00 AM',
  },
  appointmentReminder: {
    patientName: 'Asha Nair',
    doctorName: 'Dr. Rajesh Kumar',
    clinicName: 'Apollo Clinic',
    date: 'Thu, 23 Jul 2026',
    timeOrToken: 'Token No: 12',
  },
  appointmentRescheduled: {
    patientName: 'Asha Nair',
    doctorName: 'Dr. Rajesh Kumar',
    clinicName: 'Apollo Clinic',
    date: 'Sat, 25 Jul 2026',
    timeOrToken: 'Time: 4:30 PM',
  },
  appointmentNoShow: {
    patientName: 'Asha Nair',
    doctorName: 'Dr. Rajesh Kumar',
    clinicName: 'Apollo Clinic',
    actionTaken: 'Cancelled',
    reason: 'Patient did not arrive',
  },
  appointmentCompleted: {
    patientName: 'Asha Nair',
    doctorName: 'Dr. Rajesh Kumar',
    clinicName: 'Apollo Clinic',
  },
  appointmentFollowUp: {
    patientName: 'Asha Nair',
    doctorName: 'Dr. Rajesh Kumar',
    clinicName: 'Apollo Clinic',
    followUpDate: 'Fri, 24 Jul 2026',
  },
  labReportReady: {
    patientName: 'Asha Nair',
    testName: 'Complete Blood Count',
    labName: 'Apollo Diagnostics',
    reportUrl: 'https://example.com/lab-report.pdf',
  },
  labPaymentReceived: {
    patientName: 'Asha Nair',
    amount: '₹850.00',
    testName: 'Complete Blood Count',
    labName: 'Apollo Diagnostics',
    invoiceNumber: 'LAB-2026-000142',
  },
  pharmacyInvoice: {
    customerName: 'Asha Nair',
    pharmacyName: 'Apollo Pharmacy',
    invoiceUrl: 'https://example.com/invoice.pdf',
  },
};

function describeError(err: unknown): string {
  if (!axios.isAxiosError(err)) return (err as Error).message;
  if (err.response) return JSON.stringify(err.response.data);
  return `no response from Meta — ${err.code ?? 'network error'}: ${err.message}`;
}

function isAuthError(err: unknown): boolean {
  return (
    axios.isAxiosError(err) &&
    (err.response?.data as { error?: { code?: number } })?.error?.code === 190
  );
}

interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  components?: Array<{ type: string; text?: string }>;
}

function expectedParamCount(key: WhatsAppTemplateKey): number {
  const anyString = new Proxy({}, { get: () => 'x' });
  return WHATSAPP_TEMPLATES[key].toBodyParams(anyString as never).length;
}

function actualParamCount(template: MetaTemplate): number {
  const body = template.components?.find((c) => c.type === 'BODY')?.text ?? '';
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

async function fetchTemplates(): Promise<MetaTemplate[]> {
  const url = `https://graph.facebook.com/${envConfig.WHATSAPP_API_VERSION}/${envConfig.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${envConfig.WHATSAPP_ACCESS_TOKEN}` },
    params: { fields: 'name,status,language,category,components', limit: 200 },
  });
  return response.data?.data ?? [];
}

interface PhoneNumberState {
  verified_name?: string;
  display_phone_number?: string;
  name_status?: string;
  new_name_status?: string;
  status?: string;
  platform_type?: string;
  quality_rating?: string;
}

async function reportNumberStatus(): Promise<void> {
  const url = `https://graph.facebook.com/${envConfig.WHATSAPP_API_VERSION}/${envConfig.WHATSAPP_PHONE_NUMBER_ID}`;
  let n: PhoneNumberState;

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${envConfig.WHATSAPP_ACCESS_TOKEN}` },
      params: {
        fields:
          'verified_name,display_phone_number,name_status,new_name_status,status,platform_type,quality_rating',
      },
    });
    n = response.data;
  } catch (err) {
    console.log(
      `\n⚠️  Could not read phone number state: ${describeError(err)}`
    );
    return;
  }

  console.log(`\nPhone number  ${n.display_phone_number ?? '—'}`);

  const registered =
    n.platform_type === 'CLOUD_API' && n.status === 'CONNECTED';
  console.log(
    `  ${registered ? '✅' : '❌'} registration: ${n.platform_type} / ${n.status}` +
      (registered ? '' : ' — not registered, sends fail with 133010')
  );

  // Until the display name is approved, recipients who have not saved the
  // number see the raw phone number instead of the business name.
  const nameOk = n.name_status === 'APPROVED';
  console.log(
    `  ${nameOk ? '✅' : n.name_status === 'PENDING_REVIEW' ? '⏳' : '❌'} display name: "${n.verified_name}" — ${n.name_status}` +
      (nameOk ? '' : ' — recipients see the number, not this name')
  );
  if (!nameOk && n.new_name_status && n.new_name_status !== 'NONE') {
    console.log(`      resubmission in progress: ${n.new_name_status}`);
  }

  console.log(`  •  quality rating: ${n.quality_rating}`);
}

function checkConfig(): boolean {
  const required = {
    WHATSAPP_PHONE_NUMBER_ID: envConfig.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_BUSINESS_ACCOUNT_ID: envConfig.WHATSAPP_BUSINESS_ACCOUNT_ID,
    WHATSAPP_ACCESS_TOKEN: envConfig.WHATSAPP_ACCESS_TOKEN,
  };

  let ok = true;
  console.log('\nConfiguration');
  for (const [name, value] of Object.entries(required)) {
    console.log(`  ${value ? '✅' : '❌'} ${name}${value ? '' : ' — missing'}`);
    if (!value) ok = false;
  }
  console.log(
    `  ${envConfig.WHATSAPP_SENDING_ENABLED ? '✅' : '⚠️ '} WHATSAPP_SENDING_ENABLED=${envConfig.WHATSAPP_SENDING_ENABLED}${
      envConfig.WHATSAPP_SENDING_ENABLED ? '' : ' — sends will be skipped'
    }`
  );
  console.log(`  •  language code: ${LANGUAGE_CODE}`);
  return ok;
}

async function reportTemplateStatus(): Promise<void> {
  const remote = await fetchTemplates();
  console.log(`\nTemplates on this WABA (${remote.length} total)`);

  for (const key of Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[]) {
    const name = resolveTemplateName(key);
    const match = remote.find(
      (t) => t.name === name && t.language === LANGUAGE_CODE
    );

    if (!match) {
      const wrongLanguage = remote.find((t) => t.name === name);
      console.log(
        wrongLanguage
          ? `  ❌ ${name} — exists but in language "${wrongLanguage.language}", not "${LANGUAGE_CODE}"`
          : `  ❌ ${name} — not found (not created yet?)`
      );
      continue;
    }

    const expected = expectedParamCount(key);
    const actual = actualParamCount(match);
    const icon =
      match.status === 'APPROVED'
        ? '✅'
        : match.status === 'REJECTED'
          ? '❌'
          : '⏳';

    console.log(
      `  ${icon} ${name} — ${match.status} (${match.category}), ${actual} placeholder(s)`
    );

    if (actual !== expected) {
      console.log(
        `      ⚠️  MISMATCH: code sends ${expected} param(s) but the approved body has ${actual} — sends will fail with error 132000`
      );
    }
    if (match.status === 'APPROVED' && match.category !== 'UTILITY') {
      console.log(
        `      ⚠️  category is ${match.category}, expected UTILITY — Meta may have re-categorized it`
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const toArg = args.find((a) => a.startsWith('--to='))?.split('=')[1];
  const templateArg = args
    .find((a) => a.startsWith('--template='))
    ?.split('=')[1] as WhatsAppTemplateKey | undefined;

  if (!checkConfig()) {
    console.log('\nFix the missing env vars before continuing.\n');
    process.exit(1);
  }

  await reportNumberStatus();

  try {
    await reportTemplateStatus();
  } catch (err) {
    console.log(
      `\n❌ Could not list templates from Meta: ${describeError(err)}`
    );
    if (isAuthError(err)) {
      console.log(
        '   Code 190: the access token is expired or lacks whatsapp_business_management.\n'
      );
    } else if (axios.isAxiosError(err) && !err.response) {
      console.log(
        '   Nothing reached Meta — check internet access, VPN/proxy, or a firewall blocking graph.facebook.com.\n'
      );
    }
    process.exit(1);
  }

  if (!toArg) {
    console.log(
      '\nTo send a test message:  npx tsx src/scripts/testWhatsApp.ts --to=+919876543210 [--template=appointmentBooked]'
    );
    console.log(
      'To smoke-test credentials only:  npx tsx src/scripts/testWhatsApp.ts --to=+919876543210 --hello\n'
    );
    return;
  }

  // Meta pre-approves hello_world on every WABA, so it proves token + phone
  // number ID + delivery independently of our own templates' approval status.
  if (args.includes('--hello')) {
    console.log(`\nSending hello_world to ${normalizeWhatsAppNumber(toArg)}`);
    try {
      await WhatsAppService.sendTemplateMessage(
        normalizeWhatsAppNumber(toArg),
        'hello_world',
        'en_US',
        []
      );
      console.log('  ✅ accepted by Meta — check the handset\n');
    } catch (err) {
      console.log(`  ❌ failed: ${describeError(err)}\n`);
    }
    return;
  }

  const keys = templateArg
    ? [templateArg]
    : (Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[]);

  if (templateArg && !WHATSAPP_TEMPLATES[templateArg]) {
    console.log(
      `\n❌ Unknown template key "${templateArg}". Valid keys: ${Object.keys(WHATSAPP_TEMPLATES).join(', ')}\n`
    );
    process.exit(1);
  }

  console.log(`\nSending to ${normalizeWhatsAppNumber(toArg)}`);
  for (const key of keys) {
    try {
      await sendWhatsAppTemplate(toArg, key, SAMPLES[key] as never);
      console.log(`  ✅ ${resolveTemplateName(key)} accepted by Meta`);
    } catch (err) {
      console.log(
        `  ❌ ${resolveTemplateName(key)} failed: ${describeError(err)}`
      );
    }
  }
  console.log(
    '\nAcceptance is not delivery — confirm on the handset, and check the webhook for failed statuses.\n'
  );
}

main();
