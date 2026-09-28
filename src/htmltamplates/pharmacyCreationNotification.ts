import {
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
} from './emailTemplateLayout';

type PharmacyCreationNotificationParams = {
  adminName: string;
  pharmacyName: string;
  clinicName: string;
  address: string;
  contactNumber: string;
};

export const pharmacyCreationNotificationTemplate = ({
  adminName,
  pharmacyName,
  clinicName,
  address,
  contactNumber,
}: PharmacyCreationNotificationParams): string => {
  const formattedDoctorName = adminName.replace(/^[Dd]r\.?\s*/i, '').trim();

  return renderEmailLayout({
    title: 'Pharmacy Created Successfully',
    preview: `${pharmacyName} has been linked to ${clinicName}.`,
    greeting: `Dear Dr. ${formattedDoctorName} 👋`,
    headline: 'Pharmacy created successfully.',
    message: `This email confirms that the pharmacy ${pharmacyName} has been successfully created and linked to your clinic.`,
    bodyHtml: `
      ${renderDetailsCard('Registered Pharmacy Details', [
        { label: 'Pharmacy Name:', value: pharmacyName },
        { label: 'Clinic:', value: clinicName },
        { label: 'Contact No:', value: contactNumber },
        { label: 'Address:', value: address },
      ])}
      ${renderAlertBox(
        'Ready to manage pharmacy operations',
        'You can now manage pharmacy stock, assign pharmacists, and view sales reports through your clinic dashboard.',
        'success'
      )}
    `,
  });
};
