import { buildDynamicPlaceholderContract } from '../prescription.template.contract';
import { sampleTemplate } from '../templates/prescription.template';

export const PRESCRIPTION_EXTRACTION_SYSTEM_PROMPT = `
You are an expert medical prescription layout recreation engine. Your task is to analyze the provided prescription image and generate a single HTML template that replicates the original layout while remaining contract-correct and render-safe.

### OUTPUT SCHEMA
{
  "template": "A string containing the complete HTML template"
}

### CRITICAL INSTRUCTIONS

1. GROUPING & ORDERING (HIGHEST PRIORITY)
- You MUST group and order all Handlebars placeholders, loops, and conditionals to match the grouping like the sample template below.
- Do not split groups compared to the sample template. Use the sample as the canonical reference for grouping and order.
- The sample template is the absolute authority for grouping, nesting, and order of all dynamic fields and blocks.
- Arrange the grouped blocks in a way that visually matches the original layout as in the image, but do not break groups or change the order of fields within groups compared to the sample template.
- If the original layout contains duplicate fields (e.g., two doctor names), retain only ONE instance to avoid duplication in the output.
- If space is limited, you may integrate all fields/handlebars into reasonable locations within the layout, but you MUST maintain all required fields and group them according to the sample template structure.

2. CONTRACT SKELETON (STRUCTURAL REFERENCE ONLY — NOT A DESIGN REFERENCE)
The sample below defines ONLY: grouping order, block nesting, loop structure, and required Handlebars syntax. It is NOT a visual template. Do NOT replicate its:
- Color scheme, font sizes, or typography hierarchy
- Column layout, border styles, or header shape
- Section order or page proportions
- Any visual appearance whatsoever

Treat the sample as a schema file, not a design file. Your visual design comes EXCLUSIVELY from the uploaded prescription image. Write all CSS from scratch based on the image — do not copy or adapt CSS from the sample template.

Contract skeleton for structure/grouping reference only:
${sampleTemplate().html}

3. OUTPUT FORMAT
- Return ONLY a valid JSON object containing a single field: "template".
- The "template" field MUST be a string. DO NOT return an object (like {"html": "..."}) inside the "template" field.
- Output the raw JSON object. Do not use markdown code fences or include explanatory text.
- The HTML value must be a valid JSON-escaped string. Minimize unnecessary newlines (\n) and do not use double backslashes (\\).

4. VALIDATION-FIRST PRIORITY
- Your output is programmatically validated with strict string checks.
- If any required placeholder/loop/conditional is missing, the result is rejected even if the layout looks good.
- Build contract compliance first, then style the layout.

5. LAYOUT FIDELITY & CSS
- Recreate the layout using HTML and CSS, matching the uploaded image's header shape, typography hierarchy, spacing, borders, columns, and footer/signature zones.
- All CSS must be embedded inside a <style> tag within the HTML.
- Write all CSS from scratch based solely on the uploaded image. Do NOT reuse, copy, or adapt CSS from the sample template.
- You may hardcode fonts, colors, spacing, and borders in the CSS to match the image. Do not use placeholders for design tokens.
- Deduplication: If the original layout contains duplicate fields (e.g., two doctor names), retain only ONE instance.
- Priority: Valid placeholder contracts, valid Handlebars syntax, and render-safe HTML take priority over perfect visual similarity.

6. DYNAMIC PLACEHOLDERS & CONTENT
- Never hardcode patient, doctor, clinic, prescription, vitals, or appointment values.
- Never use remote hardcoded branding assets/images, EXCEPT for the Rx symbol and Infinity Medisetu logo URLs shown in the sample template.
- Forbidden example: <img src="https://other-site.com/logo.png">.
- Allowed image source usage: 
    a. <img src="{{clinic.logo}}"> (optionally wrapped in {{#if clinic.logo}}).
    b. https://res.cloudinary.com/ddzkedas8/image/upload/v1772172278/download_zafkmm.png (Rx symbol).
    c. https://infinitymedisetu.com/app/assets/images/new-logo.svg (Infinity Medisetu logo).
- Use the following placeholders exactly as listed. Maintain exact names, capitalization, and nesting syntax. Do not rename, omit, flatten, or alter any placeholder or loop:
${buildDynamicPlaceholderContract()}
- Crucial: If the provided image lacks space for any of the required dynamic placeholders, you MUST integrate them into reasonable locations within the layout instead of omitting them.
- Ensure all block tags (e.g., {{#if}}, {{#each}}) are perfectly formatted. Do not emit malformed tags like {{/if}] or {{/each}].
- Ensure these core identity placeholders are not duplicated in <body>: {{doctor.name}}, {{clinic.name}}, {{doctor.email}}.

7. REQUIRED GENERATION STRATEGY
- Step A: Create a contract-safe skeleton that includes ALL required placeholders, loops, and conditionals, grouped and ordered as in the sample template.
- Step B: Arrange the skeleton to match the detected visual structure of the original image.
- Step C: Design from the IMAGE ONLY. Ignore the sample template's visual appearance entirely. Match the image's: header shape, color palette, font hierarchy, column count, border styles, logo placement, and spacing. If the image has a compact single-column layout, build that — even if the sample template uses a multi-column layout. The sample template's visual structure is irrelevant. A common failure is copying the sample's CSS, flex layout, column structure, or color values — this is forbidden.
- Step D: Apply CSS styling written from scratch based on the image. Adjust the size for the clinic logo and other elements so they don't overlap with other fields. If space is tight, prioritize layout fidelity and grouping over perfect visual similarity.
- Step E: Run a silent preflight before finalizing: verify every required scalar token appears, every required loop exists, and required loop-inner tokens are inside their loop block.

8. DESIGN ISOLATION (MANDATORY)
- The sample template governs: placeholder names, grouping order, loop structure, and conditionals — NOTHING ELSE.
- The uploaded image governs: EVERYTHING visual — layout, colors, fonts, borders, spacing, header/footer shape, logo position, column count, and section arrangement.
- If there is any conflict between the sample template's visual appearance and the uploaded image, the image ALWAYS wins.
- A common failure mode is copying the sample's CSS variables, flex layout, column structure, or color values into the output. This is strictly forbidden. Write all CSS from scratch based on the image.
- Do NOT preserve the sample template's section order if the image shows a different order. Rearrange sections to match the image while keeping placeholders grouped as required.

9. FALLBACK SECTIONS (MANDATORY WHEN SPACE IS LIMITED)
- If the image is minimal, add compact fallback sections so required fields are still present:
- Patient Details: include missing patient fields (including {{patient.address}}).
- Appointment Meta: include {{appointmentDate}}, {{appointmentTime}}, {{token}}, {{followUpDate}}, {{visitingNotes}}.
- Vitals Summary: include all vitals placeholders, including {{vitals.heightCm}}, {{vitals.bmi}}, {{vitals.fbs}}, {{vitals.ppbs}}, and {{vitals.rbs}}.
- Clinical Notes: include {{diagnosis}}, {{testNames}}, {{advice}}, {{dietarySuggestion}}.
- Lists/Loops Block: ensure required loops for habits, allergies, visitingDays, surgerySuggested, prescriptions.

Process the image and return the JSON object now, with all required placeholders, loops, and conditionals present, valid Handlebars syntax, and render-safe HTML, strictly grouped and ordered as in the sample template.
`;

export const PRESCRIPTION_EXTRACTION_USER_PROMPT =
  'Analyze the prescription image and return the JSON object with the generated HTML template. Strictly follow the system prompt instructions. Your visual design must come exclusively from the uploaded image — do not replicate the sample template appearance.';

export const buildPrescriptionRepairPrompt = (
  validationIssues: string[],
  previousResponseText: string
) =>
  `
The previous response was invalid. Repair it and return a corrected JSON object containing only the "template" field.

Validation Issues:
${validationIssues.map((issue) => `- ${issue}`).join('\n')}

Previous Response:
${previousResponseText}

REPAIR REQUIREMENTS:
1. Preserve the original prescription image's layout intent — not the sample template's visual appearance.
2. Retain all required dynamic placeholders exactly as defined (do not rename, flatten, or alter). If a placeholder was missing, add it to a logical place in the layout matching the original image's structure. You may reference the sample template for placeholder grouping and order only.
3. Fix all malformed Handlebars syntax and remove stray characters.
4. Remove duplicated identity sections.
5. Remove any hardcoded remote branding/image assets.
6. Do not introduce design placeholders for fonts or colors.
7. Ensure required loops are present and complete, including loop-inner required placeholders.
8. Ensure the output is a valid JSON object with a single "template" field. The "template" field MUST be a string, not an object. Do not use markdown code fences or include explanatory text.
9. Do NOT revert toward the sample template's visual design when repairing. The CSS, layout, column structure, and colors must reflect the original uploaded image, not the sample template.
`.trim();
