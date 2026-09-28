import {
  renderAlertBox,
  renderDetailsCard,
  renderEmailLayout,
} from './emailTemplateLayout';

type LabCreationNotificationParams = {
  adminName: string;
  labName: string;
  clinicName: string;
  address: string;
  contactNo: string;
  email?: string | null;
};

export const labCreationNotificationTemplate = ({
  adminName,
  labName,
  clinicName,
  address,
  contactNo,
  email,
}: LabCreationNotificationParams): string => {
  const formattedDoctorName = adminName.replace(/^[Dd]r\.?\s*/i, '').trim();

  return renderEmailLayout({
    title: 'Lab Created Successfully',
    preview: `${labName} has been linked to ${clinicName}.`,
    greeting: `Dear Dr. ${formattedDoctorName} 👋`,
    headline: 'Laboratory created successfully.',
    message: `This email confirms that the laboratory ${labName} has been successfully created and linked to your clinic.`,
    bodyHtml: `
      ${renderDetailsCard('Registered Laboratory Details', [
        { label: 'Lab Name:', value: labName },
        { label: 'Clinic:', value: clinicName },
        { label: 'Contact No:', value: contactNo },
        ...(email ? [{ label: 'Email:', value: email }] : []),
        { label: 'Address:', value: address },
      ])}
      ${renderAlertBox(
        'Ready to manage lab operations',
        'You can now manage the lab catalog, assign lab assistants, and handle reports through your clinic dashboard.',
        'success'
      )}
    `,
  });
};
