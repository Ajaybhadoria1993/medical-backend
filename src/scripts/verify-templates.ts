/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { doctorStatusChangeTemplate } from '../htmltamplates/DoctorStatusChange';
import {
  emailVerifyHtml,
  emailGenratePasswordHtml,
  generateResetPasswordEmail,
  passwordSetupEmailTemplate,
} from '../htmltamplates/email.tamplate';
import { profileRequestStatusChangeTemplate } from '../htmltamplates/profileRequestStatusChange';
import { registrationOtpTemplate } from '../htmltamplates/registerAdminWithOtp';
import { subscriptionRenewalTemplate } from '../htmltamplates/subscriptionRenewal';
import { welcomeSetPasswordTemplate } from '../htmltamplates/welcome-set-password';
import { labCreationNotificationTemplate } from '../htmltamplates/labCreationNotification';
import { pharmacyCreationNotificationTemplate } from '../htmltamplates/pharmacyCreationNotification';
import { subscriptionInvoiceTemplate } from '../htmltamplates/subscriptionInvoice';
import handlebars from 'handlebars';

async function testAll() {
  console.log('Starting verification of templates...');

  // 1. doctorStatusChangeTemplate
  try {
    const html = doctorStatusChangeTemplate({
      doctorName: 'Dr. John Doe',
      clinicName: 'Test Clinic',
      oldStatus: 'pending',
      newStatus: 'approved',
      changedBy: 'Admin User',
      changedAt: new Date(),
    });
    if (!html.includes('John Doe') || !html.includes('approved')) {
      throw new Error('doctorStatusChangeTemplate output is invalid');
    }
    console.log('✅ doctorStatusChangeTemplate works');
  } catch (err: any) {
    console.error('❌ doctorStatusChangeTemplate failed:', err.message);
  }

  // 2. emailVerifyHtml
  try {
    const html = emailVerifyHtml('Jane Doe', 'https://example.com/verify', {
      clinicName: 'Test Clinic',
    } as any);
    if (
      !html.includes('Jane Doe') ||
      !html.includes('https://example.com/verify')
    ) {
      throw new Error('emailVerifyHtml output is invalid');
    }
    console.log('✅ emailVerifyHtml works');
  } catch (err: any) {
    console.error('❌ emailVerifyHtml failed:', err.message);
  }

  // 3. emailGenratePasswordHtml
  try {
    const html = emailGenratePasswordHtml(
      'John',
      'john@example.com',
      'secret123'
    );
    if (!html.includes('john@example.com') || !html.includes('secret123')) {
      throw new Error('emailGenratePasswordHtml output is invalid');
    }
    console.log('✅ emailGenratePasswordHtml works');
  } catch (err: any) {
    console.error('❌ emailGenratePasswordHtml failed:', err.message);
  }

  // 4. generateResetPasswordEmail
  try {
    const html = generateResetPasswordEmail(
      { name: 'John Doe', email: 'john@example.com', id: 'usr-123' },
      'tok-456'
    );
    if (!html.includes('John Doe') || !html.includes('tok-456')) {
      throw new Error('generateResetPasswordEmail output is invalid');
    }
    console.log('✅ generateResetPasswordEmail works');
  } catch (err: any) {
    console.error('❌ generateResetPasswordEmail failed:', err.message);
  }

  // 5. passwordSetupEmailTemplate
  try {
    const html = passwordSetupEmailTemplate(
      'John Doe',
      'Test Clinic',
      'https://example.com/reset'
    );
    if (
      !html.includes('John Doe') ||
      !html.includes('https://example.com/reset')
    ) {
      throw new Error('passwordSetupEmailTemplate output is invalid');
    }
    console.log('✅ passwordSetupEmailTemplate works');
  } catch (err: any) {
    console.error('❌ passwordSetupEmailTemplate failed:', err.message);
  }

  // 6. profileRequestStatusChangeTemplate (Approved)
  try {
    const html = profileRequestStatusChangeTemplate({
      doctorName: 'Dr. John Doe',
      status: 'approved',
    });
    if (!html.includes('John Doe') || !html.includes('Approved')) {
      throw new Error(
        'profileRequestStatusChangeTemplate (Approved) output is invalid'
      );
    }
    console.log('✅ profileRequestStatusChangeTemplate (Approved) works');
  } catch (err: any) {
    console.error(
      '❌ profileRequestStatusChangeTemplate (Approved) failed:',
      err.message
    );
  }

  // 7. profileRequestStatusChangeTemplate (Rejected)
  try {
    const html = profileRequestStatusChangeTemplate({
      doctorName: 'Dr. John Doe',
      status: 'rejected',
      rejectionReason: 'Invalid certification upload',
    });
    if (
      !html.includes('John Doe') ||
      !html.includes('Declined') ||
      !html.includes('Invalid certification upload')
    ) {
      throw new Error(
        'profileRequestStatusChangeTemplate (Rejected) output is invalid'
      );
    }
    console.log('✅ profileRequestStatusChangeTemplate (Rejected) works');
  } catch (err: any) {
    console.error(
      '❌ profileRequestStatusChangeTemplate (Rejected) failed:',
      err.message
    );
  }

  // 8. registrationOtpTemplate
  try {
    const html = registrationOtpTemplate({
      signUpLink: 'https://example.com/signup',
    });
    if (!html.includes('https://example.com/signup')) {
      throw new Error('registrationOtpTemplate output is invalid');
    }
    console.log('✅ registrationOtpTemplate works');
  } catch (err: any) {
    console.error('❌ registrationOtpTemplate failed:', err.message);
  }

  // 9. subscriptionRenewalTemplate
  try {
    const html = subscriptionRenewalTemplate({
      adminName: 'Jane Admin',
      clinicName: 'Test Clinic',
      planName: 'Carehub Plan',
      planPrice: 999,
      billingCycle: 'monthly',
      addOns: [{ name: 'Extra Storage', quantity: 1, price: 99 }],
      totalAmount: 1098,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      daysRemaining: 5,
      renewalUrl: 'https://example.com/renew',
      staffCount: 3,
      doctorCount: 2,
      staffLimit: 5,
      doctorLimit: 3,
    });
    if (
      !html.includes('Jane Admin') ||
      !html.includes('Carehub Plan') ||
      !html.includes('Extra Storage')
    ) {
      throw new Error('subscriptionRenewalTemplate output is invalid');
    }
    console.log('✅ subscriptionRenewalTemplate works');
  } catch (err: any) {
    console.error('❌ subscriptionRenewalTemplate failed:', err.message);
  }

  // 10. welcomeSetPasswordTemplate
  try {
    const html = welcomeSetPasswordTemplate({
      name: 'Dr. John Doe',
      clinicName: 'Test Clinic',
      resetUrl: 'https://example.com/setup',
    });
    if (
      !html.includes('John Doe') ||
      !html.includes('https://example.com/setup')
    ) {
      throw new Error('welcomeSetPasswordTemplate output is invalid');
    }
    console.log('✅ welcomeSetPasswordTemplate works');
  } catch (err: any) {
    console.error('❌ welcomeSetPasswordTemplate failed:', err.message);
  }

  // 11. labCreationNotificationTemplate
  try {
    const html = labCreationNotificationTemplate({
      adminName: 'Dr. John Doe',
      labName: 'Central Diagnostics Lab',
      clinicName: 'Test Clinic',
      address: '123 Main St',
      contactNo: '9876543210',
      email: 'lab@example.com',
    });
    if (
      !html.includes('John Doe') ||
      !html.includes('Central Diagnostics Lab') ||
      !html.includes('lab@example.com')
    ) {
      throw new Error('labCreationNotificationTemplate output is invalid');
    }
    console.log('✅ labCreationNotificationTemplate works');
  } catch (err: any) {
    console.error('❌ labCreationNotificationTemplate failed:', err.message);
  }

  // 12. pharmacyCreationNotificationTemplate
  try {
    const html = pharmacyCreationNotificationTemplate({
      adminName: 'Dr. John Doe',
      pharmacyName: 'Central Pharmacy',
      clinicName: 'Test Clinic',
      address: '456 Main St',
      contactNumber: '9876543211',
    });
    if (
      !html.includes('John Doe') ||
      !html.includes('Central Pharmacy') ||
      !html.includes('456 Main St')
    ) {
      throw new Error('pharmacyCreationNotificationTemplate output is invalid');
    }
    console.log('✅ pharmacyCreationNotificationTemplate works');
  } catch (err: any) {
    console.error(
      '❌ pharmacyCreationNotificationTemplate failed:',
      err.message
    );
  }

  // 13. subscriptionInvoiceTemplate
  try {
    const template = handlebars.compile(subscriptionInvoiceTemplate);
    const html = template({
      invoiceNumber: 'INV-123456',
      currentDateTime: '17/09/2026 19:30:00',
      clinicName: 'TEST CLINIC',
      clinicAddress: '123 HEALTH AVE',
      clinicCity: 'MUMBAI',
      clinicState: 'MAHARASHTRA',
      zipCode: '400001',
      clinicPhone: '9876543210',
      adminName: 'JOHN DOE',
      adminEmail: 'ADMIN@EXAMPLE.COM',
      adminMobile: '9876543210',
      planName: 'STARTER PLAN',
      planDescription: 'monthly subscription',
      startsAt: '17/09/2026',
      expiresAt: '17/10/2026',
      createdAt: '17/09/2026 19:30:00',
      transactionId: 'TXN-99999',
      subtotal: '₹1000.00',
      cgst: '₹90.00',
      sgst: '₹90.00',
      grandTotal: '₹1180.00',
      amountInWords: 'One Thousand One Hundred Eighty Rupees Only',
    });
    if (
      !html.includes('INV-123456') ||
      !html.includes('STARTER PLAN') ||
      !html.includes('TEST CLINIC')
    ) {
      throw new Error('subscriptionInvoiceTemplate output is invalid');
    }
    console.log('✅ subscriptionInvoiceTemplate works');
  } catch (err: any) {
    console.error('❌ subscriptionInvoiceTemplate failed:', err.message);
  }

  console.log('All verification complete.');
}

testAll();
