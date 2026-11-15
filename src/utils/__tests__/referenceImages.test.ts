import { findReferenceImages } from '../referenceImages';
import { SPECIALTY_CATALOG } from '../specialtyCatalog';

// Every image set must be keyed by a catalog name, or no doctor ever sees it.
describe('findReferenceImages', () => {
  it('builds the S3 link from the speciality slug and file', () => {
    const [first] = findReferenceImages('Dietitian / Nutritionist');
    expect(first.url).toBe(
      'https://infninity-medisatu.s3.ap-south-1.amazonaws.com/assets/doctor-images/dietitian-nutritionist/balanced-healthy-plate-infographic.png'
    );
    expect(first.description).toBe('Balanced Healthy Plate Infographic');
  });

  it('matches the speciality ignoring case and spaces', () => {
    expect(findReferenceImages('  dentist ')).toHaveLength(10);
  });

  it('returns no images for a speciality without a set', () => {
    expect(findReferenceImages('Neurologist')).toEqual([]);
  });

  it('keys every image set by a catalog main speciality', () => {
    const withImages = SPECIALTY_CATALOG.filter(
      (g) => findReferenceImages(g.mainSpecialty).length > 0
    );
    expect(withImages).toHaveLength(23);
  });
});
