// All upload middleware now uses AWS S3 via the centralized s3 configuration.
// This file re-exports from s3/ for backward compatibility with existing route imports.
export {
  upload,
  uploadBannerImage,
  uploadBannerForm,
  uploadClinicLogo,
  uploadClinicForm,
  uploadClinicFormV2,
  uploadPatientGallery,
  uploadDoctorGallery,
  uploadConsentFile,
  uploadDoctorManualTemplate,
  uploadDoctorManualPrescription,
  uploadProfilePicture,
  uploadPatientTest,
  uploadPrescription,
} from '../configurations/s3';
