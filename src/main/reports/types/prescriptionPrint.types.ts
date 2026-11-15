/** A treatment plan as the prescription prints it: no prices, one row per visit. */
export interface PrintTreatmentPlan {
  title: string;
  status: string;
  steps: { n: number; name: string; when: string }[];
}
