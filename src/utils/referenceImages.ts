const REFERENCE_IMAGES_BASE_URL =
  'https://infninity-mediarogya.s3.ap-south-1.amazonaws.com/assets/doctor-images';

// Uploaded teaching images per main speciality, as [file, title]; the folder
// is the speciality slug. Add a row here when an image is added to S3.
const IMAGES: Record<string, readonly (readonly [string, string])[]> = {
  'Ayurvedic Doctor': [
    [
      'abhyanga-ayurvedic-massage-guide.png',
      'Abhyanga Ayurvedic Massage Guide',
    ],
    [
      'ayurvedic-daily-routine-infographic.png',
      'Ayurvedic Daily Routine Infographic',
    ],
    [
      'ayurvedic-digestive-fire-infographic.png',
      'Ayurvedic Digestive Fire Infographic',
    ],
    [
      'ayurvedic-medicinal-herbs-infographic.png',
      'Ayurvedic Medicinal Herbs Infographic',
    ],
    [
      'ayurvedic-prakriti-constitution-guide.png',
      'Ayurvedic Prakriti Constitution Guide',
    ],
    [
      'ayurvedic-six-tastes-infographic.png',
      'Ayurvedic Six Tastes Infographic',
    ],
    [
      'ayurvedic-tridosha-balance-infographic.png',
      'Ayurvedic Tridosha Balance Infographic',
    ],
    [
      'panchakarma-five-ayurvedic-therapies.png',
      'Panchakarma: Five Ayurvedic Therapies',
    ],
    ['sapta-dhatu-seven-body-tissues.png', 'Sapta Dhatu: Seven Body Tissues'],
    [
      'six-seasons-in-ayurveda-infographic.png',
      'Six Seasons in Ayurveda Infographic',
    ],
  ],
  Cardiologist: [
    [
      'cholesterol-plaque-progression-infographic.png',
      'Cholesterol Plaque Progression Infographic',
    ],
    [
      'coronary-artery-disease-comparison.png',
      'Coronary Artery Disease Comparison',
    ],
    ['healthy-heart-vs-heart-failure.png', 'Healthy Heart vs Heart Failure'],
    [
      'heart-attack-warning-signs-infographic.png',
      'Heart Attack Warning Signs Infographic',
    ],
    [
      'heart-valve-disorders-infographic.png',
      'Heart Valve Disorders Infographic',
    ],
    [
      'heart-and-coronary-artery-comparison.png',
      'Heart and Coronary Artery Comparison',
    ],
    [
      'heart-healthy-lifestyle-infographic.png',
      'Heart-Healthy Lifestyle Infographic',
    ],
    [
      'labeled-anatomical-heart-diagram.png',
      'Labeled Anatomical Heart Diagram',
    ],
    [
      'normal-rhythm-vs-atrial-fibrillation.png',
      'Normal Rhythm vs Atrial Fibrillation',
    ],
    [
      'six-step-coronary-angioplasty-infographic.png',
      'Six-Step Coronary Angioplasty Infographic',
    ],
    [
      'understanding-blood-pressure-readings.png',
      'Understanding Blood Pressure Readings',
    ],
  ],
  Dentist: [
    [
      'dental-brushing-and-flossing-guide.png',
      'Dental Brushing and Flossing Guide',
    ],
    [
      'dental-implant-anatomy-and-procedure.png',
      'Dental Implant Anatomy and Procedure',
    ],
    [
      'from-healthy-teeth-to-professional-cleaning.png',
      'From Healthy Teeth to Professional Cleaning',
    ],
    [
      'gum-health-comparison-infographic.png',
      'Gum Health Comparison Infographic',
    ],
    ['healthy-smile-care-infographic.png', 'Healthy Smile Care Infographic'],
    ['root-canal-treatment-steps.png', 'Root Canal Treatment Steps'],
    [
      'teeth-alignment-treatment-infographic.png',
      'Teeth Alignment Treatment Infographic',
    ],
    [
      'tooth-anatomy-infographic-cutaway.png',
      'Tooth Anatomy Infographic Cutaway',
    ],
    [
      'tooth-decay-progression-infographic.png',
      'Tooth Decay Progression Infographic',
    ],
    [
      'wisdom-teeth-normal-eruption-and-impaction-types.png',
      'Wisdom Teeth: Normal Eruption and Impaction Types',
    ],
  ],
  Dermatologist: [
    ['abcde-skin-cancer-warning-signs.png', 'ABCDE Skin Cancer Warning Signs'],
    [
      'detailed-human-skin-anatomy-infographic.png',
      'Detailed Human Skin Anatomy Infographic',
    ],
    [
      'hair-growth-cycle-and-alopecia-infographic.png',
      'Hair Growth Cycle and Alopecia Infographic',
    ],
    [
      'healthy-skin-vs-eczema-medical-comparison.png',
      'Healthy Skin vs Eczema: Medical Comparison',
    ],
    ['how-acne-forms-and-lesion-types.png', 'How Acne Forms and Lesion Types'],
    [
      'normal-skin-vs-psoriasis-infographic.png',
      'Normal Skin vs. Psoriasis Infographic',
    ],
    [
      'protected-vs-sun-damaged-skin-uv-education.png',
      'Protected vs Sun-Damaged Skin: UV Education',
    ],
    ['skin-pigmentation-explained.png', 'Skin Pigmentation Explained'],
    [
      'understanding-fungal-skin-infections.png',
      'Understanding Fungal Skin Infections',
    ],
    ['vitiligo-pigmentation-explained.png', 'Vitiligo: Pigmentation Explained'],
  ],
  'Dietitian / Nutritionist': [
    [
      'balanced-healthy-plate-infographic.png',
      'Balanced Healthy Plate Infographic',
    ],
    ['blood-sugar-nutrition-guide.png', 'Blood Sugar Nutrition Guide'],
    [
      'dietary-fiber-soluble-vs-insoluble.png',
      'Dietary Fiber: Soluble vs. Insoluble',
    ],
    [
      'digestive-system-infographic-poster.png',
      'Digestive System Infographic Poster',
    ],
    [
      'healthy-weight-management-balance-cycle.png',
      'Healthy Weight Management Balance Cycle',
    ],
    [
      'hydration-and-water-balance-infographic.png',
      'Hydration and Water Balance Infographic',
    ],
    [
      'iron-deficiency-and-anemia-infographic.png',
      'Iron Deficiency and Anemia Infographic',
    ],
    [
      'macronutrients-fuel-build-support.png',
      'Macronutrients: Fuel, Build, Support',
    ],
    [
      'portion-control-healthy-serving-guide.png',
      'Portion Control: Healthy Serving Guide',
    ],
    [
      'vitamins-and-minerals-infographic.png',
      'Vitamins and Minerals Infographic',
    ],
  ],
  'ENT Specialist': [
    [
      'conductive-vs-sensorineural-hearing-loss.png',
      'Conductive vs Sensorineural Hearing Loss',
    ],
    ['healthy-tonsils-vs-tonsillitis.png', 'Healthy Tonsils vs. Tonsillitis'],
    [
      'healthy-vs-inflamed-sinuses-infographic.png',
      'Healthy vs. Inflamed Sinuses Infographic',
    ],
    ['human-ear-anatomy-infographic.png', 'Human Ear Anatomy Infographic'],
    ['normal-ear-vs-ear-infection.png', 'Normal Ear vs. Ear Infection'],
    [
      'normal-vs-enlarged-adenoids-infographic.png',
      'Normal vs Enlarged Adenoids Infographic',
    ],
    ['normal-vs-deviated-nasal-septum.png', 'Normal vs. Deviated Nasal Septum'],
    ['normal-vs-impacted-ear-canal.png', 'Normal vs. Impacted Ear Canal'],
    ['normal-vs-nodule-vocal-cords.png', 'Normal vs. Nodule Vocal Cords'],
    [
      'normal-vs-polyp-blocked-nasal-airflow.png',
      'Normal vs. Polyp-Blocked Nasal Airflow',
    ],
  ],
  'Emergency Medicine Specialist': [
    [
      'anaphylaxis-causes-symptoms-treatment.png',
      'Anaphylaxis: Causes, Symptoms, Treatment',
    ],
    ['burn-injury-depth-infographic.png', 'Burn Injury Depth Infographic'],
    [
      'cpr-basic-life-support-steps-infographic.png',
      'CPR Basic Life Support Steps Infographic',
    ],
    [
      'emergency-abcde-assessment-infographic.png',
      'Emergency ABCDE Assessment Infographic',
    ],
    [
      'heart-attack-normal-vs-blocked-arteries.png',
      'Heart Attack: Normal vs. Blocked Arteries',
    ],
    [
      'hypoglycemia-emergency-management-infographic.png',
      'Hypoglycemia Emergency Management Infographic',
    ],
    [
      'pneumothorax-normal-vs-collapsed-lung.png',
      'Pneumothorax: Normal vs Collapsed Lung',
    ],
    [
      'seizure-emergency-first-aid-infographic.png',
      'Seizure Emergency First Aid Infographic',
    ],
    [
      'shock-normal-vs-reduced-circulation.png',
      'Shock: Normal vs. Reduced Circulation',
    ],
    [
      'stroke-warning-signs-and-fast-method.png',
      'Stroke Warning Signs and FAST Method',
    ],
  ],
  Endocrinologist: [
    [
      'adrenal-glands-stress-hormone-infographic.png',
      'Adrenal Glands: Stress Hormone Infographic',
    ],
    [
      'cortisol-disorders-cushing-vs-addison.png',
      'Cortisol Disorders: Cushing vs Addison',
    ],
    [
      'diabetes-mellitus-type-1-vs-type-2.png',
      'Diabetes Mellitus: Type 1 vs. Type 2',
    ],
    [
      'human-endocrine-system-infographic.png',
      'Human Endocrine System Infographic',
    ],
    [
      'insulin-resistance-normal-vs-reduced-uptake.png',
      'Insulin Resistance: Normal vs. Reduced Uptake',
    ],
    [
      'osteoporosis-bone-density-infographic.png',
      'Osteoporosis: Bone Density Infographic',
    ],
    [
      'pcos-hormonal-balance-infographic.png',
      'PCOS Hormonal Balance Infographic',
    ],
    [
      'parathyroid-disorders-infographic.png',
      'Parathyroid Disorders Infographic',
    ],
    [
      'pituitary-gland-master-endocrine-infographic.png',
      'Pituitary Gland: Master Endocrine Infographic',
    ],
    [
      'thyroid-disorders-a-visual-comparison.png',
      'Thyroid Disorders: A Visual Comparison',
    ],
  ],
  Gastroenterologist: [
    [
      'crohns-vs-ulcerative-colitis-infographic.png',
      'Crohn’s vs. Ulcerative Colitis Infographic',
    ],
    ['fatty-liver-disease-infographic.png', 'Fatty Liver Disease Infographic'],
    [
      'gallstones-normal-vs-affected-gallbladder.png',
      'Gallstones: Normal vs. Affected Gallbladder',
    ],
    [
      'gastritis-healthy-vs-inflamed-stomach.png',
      'Gastritis: Healthy vs Inflamed Stomach',
    ],
    [
      'human-digestive-system-infographic.png',
      'Human Digestive System Infographic',
    ],
    [
      'ibs-gut-brain-interaction-infographic.png',
      'IBS Gut-Brain Interaction Infographic',
    ],
    [
      'normal-vs-acid-reflux-infographic.png',
      'Normal vs. Acid Reflux Infographic',
    ],
    [
      'pancreatitis-normal-vs-inflamed-pancreas.png',
      'Pancreatitis: Normal vs Inflamed Pancreas',
    ],
    [
      'peptic-ulcer-disease-infographic.png',
      'Peptic Ulcer Disease Infographic',
    ],
    ['upper-gi-endoscopy-guide.png', 'Upper GI Endoscopy Guide'],
  ],
  'General Physician': [
    [
      'blood-pressure-explained-infographic.png',
      'Blood Pressure Explained Infographic',
    ],
    ['blood-sugar-and-diabetes-guide.png', 'Blood Sugar and Diabetes Guide'],
    [
      'common-cold-vs-influenza-symptom-comparison.png',
      'Common Cold vs Influenza: Symptom Comparison',
    ],
    [
      'dehydration-symptoms-and-hydration-solutions.png',
      'Dehydration Symptoms and Hydration Solutions',
    ],
    [
      'digestive-system-infographic-with-disorders.png',
      'Digestive System Infographic with Disorders',
    ],
    [
      'human-anatomy-organ-callout-infographic.png',
      'Human Anatomy Organ Callout Infographic',
    ],
    [
      'respiratory-system-and-lung-conditions-infographic.png',
      'Respiratory System and Lung Conditions Infographic',
    ],
    [
      'thyroid-function-comparison-infographic.png',
      'Thyroid Function Comparison Infographic',
    ],
    [
      'urinary-system-health-infographic.png',
      'Urinary System Health Infographic',
    ],
    [
      'wellness-wheel-for-healthy-living.png',
      'Wellness Wheel for Healthy Living',
    ],
  ],
  'General Surgeon': [
    [
      'appendicitis-normal-vs-inflamed-appendix.png',
      'Appendicitis: Normal vs Inflamed Appendix',
    ],
    [
      'breast-lump-comparison-medical-infographic.png',
      'Breast Lump Comparison Medical Infographic',
    ],
    [
      'gallbladder-health-and-gallstones-infographic.png',
      'Gallbladder Health and Gallstones Infographic',
    ],
    [
      'hemorrhoids-anatomy-and-comparison.png',
      'Hemorrhoids: Anatomy and Comparison',
    ],
    [
      'hernia-types-and-surgical-repair-infographic.png',
      'Hernia Types and Surgical Repair Infographic',
    ],
    [
      'labeled-abdominal-anatomy-infographic.png',
      'Labeled Abdominal Anatomy Infographic',
    ],
    [
      'laparoscopic-and-open-surgery-comparison.png',
      'Laparoscopic and Open Surgery Comparison',
    ],
    [
      'normal-vs-obstructed-intestine-guide.png',
      'Normal vs. Obstructed Intestine Guide',
    ],
    [
      'stages-of-surgical-wound-healing-and-care.png',
      'Stages of Surgical Wound Healing and Care',
    ],
    [
      'thyroid-conditions-medical-infographic.png',
      'Thyroid Conditions Medical Infographic',
    ],
  ],
  Geriatrician: [
    [
      'age-related-hearing-loss-infographic.png',
      'Age-Related Hearing Loss Infographic',
    ],
    [
      'aging-and-the-human-body-infographic.png',
      'Aging and the Human Body Infographic',
    ],
    [
      'alzheimers-disease-healthy-vs-affected-brain.png',
      'Alzheimer’s Disease: Healthy vs. Affected Brain',
    ],
    [
      'dehydration-in-older-adults-signs-and-prevention.png',
      'Dehydration in Older Adults: Signs and Prevention',
    ],
    [
      'fall-prevention-risks-and-safety-measures.png',
      'Fall Prevention: Risks and Safety Measures',
    ],
    [
      'healthy-aging-wellness-infographic.png',
      'Healthy Aging Wellness Infographic',
    ],
    [
      'osteoarthritis-healthy-vs-damaged-joints.png',
      'Osteoarthritis: Healthy vs. Damaged Joints',
    ],
    [
      'osteoporosis-healthy-vs-weak-bones.png',
      'Osteoporosis: Healthy vs Weak Bones',
    ],
    [
      'polypharmacy-medication-management-guide.png',
      'Polypharmacy Medication Management Guide',
    ],
    [
      'sarcopenia-muscle-loss-explained.png',
      'Sarcopenia: Muscle Loss Explained',
    ],
  ],
  'Homeopathic Doctor': [
    [
      'acute-vs-chronic-conditions-infographic.png',
      'Acute vs. Chronic Conditions Infographic',
    ],
    [
      'constitutional-assessment-infographic.png',
      'Constitutional Assessment Infographic',
    ],
    [
      'homeopathic-case-taking-infographic.png',
      'Homeopathic Case Taking Infographic',
    ],
    [
      'homeopathic-potencies-infographic.png',
      'Homeopathic Potencies Infographic',
    ],
    [
      'homeopathic-remedy-preparation-infographic.png',
      'Homeopathic Remedy Preparation Infographic',
    ],
    [
      'homeopathic-remedy-sources-infographic.png',
      'Homeopathic Remedy Sources Infographic',
    ],
    [
      'homeopathy-principles-infographic.png',
      'Homeopathy Principles Infographic',
    ],
    [
      'human-immune-system-response-infographic.png',
      'Human Immune System Response Infographic',
    ],
    [
      'preventive-healthcare-wellness-infographic.png',
      'Preventive Healthcare Wellness Infographic',
    ],
    [
      'symptom-tracking-health-infographic.png',
      'Symptom Tracking Health Infographic',
    ],
  ],
  Ophthalmologist: [
    [
      'cataract-surgery-six-step-visual-guide-1.png',
      'Cataract Surgery: Six-Step Visual Guide (1)',
    ],
    [
      'comparing-normal-dry-and-wet-amd.png',
      'Comparing Normal, Dry, and Wet AMD',
    ],
    [
      'diabetic-eye-disease-infographic.png',
      'Diabetic Eye Disease Infographic',
    ],
    [
      'eye-vision-types-and-corrections.png',
      'Eye Vision Types and Corrections',
    ],
    ['glaucoma-healthy-eye-vs-damage.png', 'Glaucoma: Healthy Eye vs Damage'],
    [
      'intravitreal-injection-and-retina-recovery.png',
      'Intravitreal Injection and Retina Recovery',
    ],
    [
      'lasik-surgery-steps-and-vision-results.png',
      'LASIK Surgery: Steps and Vision Results',
    ],
    [
      'labeled-3d-eye-anatomy-infographic.png',
      'Labeled 3D Eye Anatomy Infographic',
    ],
    [
      'normal-vision-vs-cataract-cloudiness.png',
      'Normal Vision vs Cataract Cloudiness',
    ],
    [
      'retinal-vein-occlusion-infographic.png',
      'Retinal Vein Occlusion Infographic',
    ],
  ],
  'Orthopedic Doctor': [
    [
      'acl-injury-normal-vs-torn-anatomy.png',
      'ACL Injury: Normal vs Torn Anatomy',
    ],
    [
      'bone-fractures-and-healing-stages.png',
      'Bone Fractures and Healing Stages',
    ],
    [
      'detailed-human-skeleton-anatomy-infographic.png',
      'Detailed Human Skeleton Anatomy Infographic',
    ],
    [
      'healthy-bone-vs-osteoporosis-infographic.png',
      'Healthy Bone vs Osteoporosis Infographic',
    ],
    ['healthy-knee-vs-osteoarthritis.png', 'Healthy Knee vs. Osteoarthritis'],
    [
      'knee-replacement-before-and-after.png',
      'Knee Replacement: Before and After',
    ],
    ['natural-hip-vs-hip-replacement.png', 'Natural Hip vs. Hip Replacement'],
    [
      'normal-spine-vs-scoliosis-medical-infographic.png',
      'Normal Spine vs Scoliosis: Medical Infographic',
    ],
    [
      'normal-vs-herniated-disc-infographic.png',
      'Normal vs Herniated Disc Infographic',
    ],
    [
      'rotator-cuff-health-and-injury-guide.png',
      'Rotator Cuff Health and Injury Guide',
    ],
  ],
  Physiotherapist: [
    [
      'ankle-sprain-anatomy-and-recovery-guide.png',
      'Ankle Sprain Anatomy and Recovery Guide',
    ],
    [
      'correct-vs-poor-posture-alignment.png',
      'Correct vs. Poor Posture Alignment',
    ],
    [
      'human-muscular-system-infographic.png',
      'Human Muscular System Infographic',
    ],
    [
      'joint-range-of-motion-infographic.png',
      'Joint Range of Motion Infographic',
    ],
    ['knee-joint-anatomy-infographic.png', 'Knee Joint Anatomy Infographic'],
    [
      'knee-rehabilitation-exercise-guide.png',
      'Knee Rehabilitation Exercise Guide',
    ],
    [
      'lower-back-pain-and-sciatica-explained.png',
      'Lower Back Pain and Sciatica Explained',
    ],
    [
      'muscle-strain-grades-and-healing-process.png',
      'Muscle Strain Grades and Healing Process',
    ],
    [
      'neck-pain-and-cervical-spine-infographic.png',
      'Neck Pain and Cervical Spine Infographic',
    ],
    [
      'shoulder-rotator-cuff-injury-guide.png',
      'Shoulder Rotator Cuff Injury Guide',
    ],
  ],
  'Plastic Surgeon': [
    [
      'blepharoplasty-eyelid-surgery-infographic.png',
      'Blepharoplasty Eyelid Surgery Infographic',
    ],
    [
      'burn-depth-and-healing-infographic.png',
      'Burn Depth and Healing Infographic',
    ],
    [
      'cleft-conditions-and-surgical-repair-infographic.png',
      'Cleft Conditions and Surgical Repair Infographic',
    ],
    [
      'dermatology-scar-types-comparison.png',
      'Dermatology Scar Types Comparison',
    ],
    [
      'facelift-anatomy-and-surgical-steps.png',
      'Facelift Anatomy and Surgical Steps',
    ],
    [
      'facial-anatomy-layers-infographic.png',
      'Facial Anatomy Layers Infographic',
    ],
    [
      'liposuction-before-during-and-after.png',
      'Liposuction: Before, During, and After',
    ],
    [
      'rhinoplasty-anatomy-and-surgical-corrections-infographic.png',
      'Rhinoplasty Anatomy and Surgical Corrections Infographic',
    ],
    [
      'skin-grafting-types-procedure-and-healing.png',
      'Skin Grafting: Types, Procedure, and Healing',
    ],
    [
      'wound-healing-stages-infographic.png',
      'Wound Healing Stages Infographic',
    ],
  ],
  Psychiatrist: [
    [
      'adhd-types-and-symptoms-infographic.png',
      'ADHD Types and Symptoms Infographic',
    ],
    [
      'anxiety-disorders-brain-and-body-infographic.png',
      'Anxiety Disorders: Brain and Body Infographic',
    ],
    [
      'bipolar-disorder-mood-and-energy-infographic.png',
      'Bipolar Disorder Mood and Energy Infographic',
    ],
    ['depression-symptoms-infographic.png', 'Depression Symptoms Infographic'],
    ['human-brain-anatomy-infographic.png', 'Human Brain Anatomy Infographic'],
    [
      'mental-health-treatment-ecosystem.png',
      'Mental Health Treatment Ecosystem',
    ],
    [
      'neurotransmitters-how-brain-cells-communicate.png',
      'Neurotransmitters: How Brain Cells Communicate',
    ],
    [
      'schizophrenia-symptoms-infographic.png',
      'Schizophrenia Symptoms Infographic',
    ],
    [
      'sleep-disorders-normal-sleep-vs-insomnia.png',
      'Sleep Disorders: Normal Sleep vs. Insomnia',
    ],
    ['understanding-the-ocd-cycle.png', 'Understanding the OCD Cycle'],
  ],
  Psychologist: [
    ['5-4-3-2-1-grounding-technique.png', '5-4-3-2-1 Grounding Technique'],
    [
      'cbt-triangle-thoughts-feelings-behaviours.png',
      'CBT Triangle: Thoughts, Feelings, Behaviours',
    ],
    [
      'cognitive-distortions-infographic.png',
      'Cognitive Distortions Infographic',
    ],
    ['depression-symptoms-infographic.png', 'Depression Symptoms Infographic'],
    [
      'emotional-regulation-window-of-tolerance.png',
      'Emotional Regulation Window of Tolerance',
    ],
    ['human-brain-anatomy-infographic.png', 'Human Brain Anatomy Infographic'],
    [
      'mental-well-being-self-care-wheel.png',
      'Mental Well-Being Self-Care Wheel',
    ],
    [
      'sleep-cycle-and-mental-health-infographic.png',
      'Sleep Cycle and Mental Health Infographic',
    ],
    [
      'stress-response-fight-flight-freeze.png',
      'Stress Response: Fight, Flight, Freeze',
    ],
    ['understanding-the-anxiety-cycle.png', 'Understanding the Anxiety Cycle'],
  ],
  Pulmonologist: [
    [
      'asthma-normal-vs-inflamed-airways.png',
      'Asthma: Normal vs Inflamed Airways',
    ],
    ['copd-healthy-and-damaged-lungs.png', 'COPD: Healthy & Damaged Lungs'],
    [
      'human-respiratory-system-infographic.png',
      'Human Respiratory System Infographic',
    ],
    [
      'inhaler-technique-six-correct-steps.png',
      'Inhaler Technique: Six Correct Steps',
    ],
    [
      'obstructive-sleep-apnea-airway-comparison.png',
      'Obstructive Sleep Apnea: Airway Comparison',
    ],
    [
      'pneumonia-healthy-vs-infected-lungs.png',
      'Pneumonia: Healthy vs. Infected Lungs',
    ],
    [
      'pulmonary-embolism-normal-vs-blocked-artery.png',
      'Pulmonary Embolism: Normal vs. Blocked Artery',
    ],
    [
      'pulmonary-fibrosis-healthy-vs-scarred-lungs.png',
      'Pulmonary Fibrosis: Healthy vs. Scarred Lungs',
    ],
    [
      'pulmonary-tuberculosis-healthy-vs-infected-lungs.png',
      'Pulmonary Tuberculosis: Healthy vs Infected Lungs',
    ],
    [
      'spirometry-and-lung-function-infographic.png',
      'Spirometry and Lung Function Infographic',
    ],
  ],
  'Speech Therapist': [
    [
      'aphasia-brain-language-areas-and-effects.png',
      'Aphasia: Brain Language Areas and Effects',
    ],
    [
      'breathing-and-voice-production-infographic.png',
      'Breathing and Voice Production Infographic',
    ],
    [
      'childhood-speech-milestones-roadmap.png',
      'Childhood Speech Milestones Roadmap',
    ],
    ['healthy-vocal-cords-vs-nodules.png', 'Healthy Vocal Cords vs. Nodules'],
    [
      'human-speech-anatomy-infographic.png',
      'Human Speech Anatomy Infographic',
    ],
    [
      'receptive-and-expressive-language-guide.png',
      'Receptive and Expressive Language Guide',
    ],
    ['speech-sound-production-guide.png', 'Speech Sound Production Guide'],
    [
      'speech-therapy-sound-to-sentence.png',
      'Speech Therapy: Sound to Sentence',
    ],
    [
      'stuttering-fluent-and-disfluent-speech-patterns.png',
      'Stuttering: Fluent and Disfluent Speech Patterns',
    ],
    [
      'swallowing-mechanism-normal-vs-dysphagia.png',
      'Swallowing Mechanism: Normal vs. Dysphagia',
    ],
  ],
  Urologist: [
    [
      'healthy-vs-infected-urinary-tract.png',
      'Healthy vs. Infected Urinary Tract',
    ],
    [
      'normal-bladder-vs-bladder-stones.png',
      'Normal Bladder vs Bladder Stones',
    ],
    [
      'normal-kidney-vs-hydronephrosis-infographic.png',
      'Normal Kidney vs. Hydronephrosis Infographic',
    ],
    ['normal-kidney-vs-kidney-stones.png', 'Normal Kidney vs. Kidney Stones'],
    [
      'normal-vs-cancerous-prostate-anatomy.png',
      'Normal vs Cancerous Prostate Anatomy',
    ],
    [
      'normal-vs-enlarged-prostate-infographic.png',
      'Normal vs. Enlarged Prostate Infographic',
    ],
    [
      'normal-vs-overactive-bladder-function.png',
      'Normal vs. Overactive Bladder Function',
    ],
    [
      'ureteroscopy-and-laser-lithotripsy-guide.png',
      'Ureteroscopy and Laser Lithotripsy Guide',
    ],
    [
      'urinary-incontinence-types-and-causes.png',
      'Urinary Incontinence Types and Causes',
    ],
    ['urinary-system-anatomy-and-flow.png', 'Urinary System Anatomy and Flow'],
  ],
  'Vascular Specialist': [
    [
      'angioplasty-and-stent-placement-infographic.png',
      'Angioplasty and Stent Placement Infographic',
    ],
    ['carotid-artery-and-stroke-risk.png', 'Carotid Artery and Stroke Risk'],
    ['diabetic-foot-care-infographic.png', 'Diabetic Foot Care Infographic'],
    [
      'healthy-vein-vs-deep-vein-thrombosis.png',
      'Healthy Vein vs Deep Vein Thrombosis',
    ],
    ['healthy-vs-damaged-vein-valves.png', 'Healthy vs. Damaged Vein Valves'],
    [
      'human-vascular-system-infographic.png',
      'Human Vascular System Infographic',
    ],
    [
      'normal-vs-aneurysmal-abdominal-aorta.png',
      'Normal vs Aneurysmal Abdominal Aorta',
    ],
    [
      'peripheral-artery-disease-infographic.png',
      'Peripheral Artery Disease Infographic',
    ],
    [
      'varicose-veins-flow-and-symptoms.png',
      'Varicose Veins: Flow and Symptoms',
    ],
    ['venous-leg-ulcer-healing-guide.png', 'Venous Leg Ulcer Healing Guide'],
  ],
};

export interface ReferenceImage {
  id: string;
  url: string;
  filename: string;
  description: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const byKey = new Map(
  Object.entries(IMAGES).map(([speciality, items]) => [
    speciality.toLowerCase(),
    items.map(([filename, description]): ReferenceImage => {
      const id = `${slug(speciality)}/${filename}`;
      return {
        id,
        url: `${REFERENCE_IMAGES_BASE_URL}/${id}`,
        filename,
        description,
      };
    }),
  ])
);

/** The default gallery images for a main speciality; [] when it has none. */
export function findReferenceImages(speciality: string): ReferenceImage[] {
  return byKey.get(speciality.trim().toLowerCase()) ?? [];
}
