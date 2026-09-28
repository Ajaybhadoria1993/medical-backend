import Handlebars from 'handlebars';
import {
  CORE_IDENTITY_PLACEHOLDERS,
  FORBIDDEN_TEMPLATE_PATTERNS,
  HARD_CODED_REMOTE_IMAGE_PATTERN,
  LOOP_REQUIREMENTS,
  REQUIRED_CONDITIONAL_REFERENCES,
  REQUIRED_SCALAR_PLACEHOLDERS,
} from '../prescription.template.contract';

export const PRESCRIPTION_TEMPLATE_VALIDATION_ERROR_CODE =
  'PRESCRIPTION_TEMPLATE_VALIDATION_FAILED';

export type GeneratedTemplateValidationResult = {
  valid: boolean;
  issues: string[];
  normalizedTemplate: string;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const countOccurrences = (template: string, value: string) => {
  const matches = template.match(new RegExp(escapeRegex(value), 'g'));
  return matches?.length ?? 0;
};

const getLoopBody = (template: string, loopExpression: string) => {
  const regex = new RegExp(
    `${escapeRegex(loopExpression)}([\\s\\S]*?)\\{\\{\\/each\\}\\}`,
    'i'
  );

  return template.match(regex)?.[1] ?? null;
};

export const validateGeneratedPrescriptionTemplate = (
  template: string
): GeneratedTemplateValidationResult => {
  const normalizedTemplate = template.trim().replace(/\r\n/g, '\n');
  const issues: string[] = [];

  try {
    Handlebars.parse(normalizedTemplate);
    Handlebars.compile(normalizedTemplate);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown Handlebars parse error';

    issues.push(`Invalid Handlebars syntax: ${message}`);
  }

  for (const placeholder of REQUIRED_SCALAR_PLACEHOLDERS) {
    if (!normalizedTemplate.includes(placeholder)) {
      issues.push(`Missing required placeholder ${placeholder}`);
    }
  }

  for (const reference of REQUIRED_CONDITIONAL_REFERENCES) {
    const hasReference = reference.acceptedExpressions.some((expression) =>
      normalizedTemplate.includes(expression)
    );

    if (!hasReference) {
      issues.push(
        `Missing required conditional reference for ${reference.label}`
      );
    }
  }

  for (const requirement of LOOP_REQUIREMENTS) {
    const loopBody = getLoopBody(normalizedTemplate, requirement.loop);

    if (!loopBody) {
      issues.push(`Missing required loop ${requirement.loop}`);
      continue;
    }

    for (const itemPlaceholder of requirement.requiredInsideLoop) {
      if (!loopBody.includes(itemPlaceholder)) {
        issues.push(
          `Loop ${requirement.loop} is missing ${itemPlaceholder} inside the block`
        );
      }
    }

    if (requirement.acceptedAlternatives?.length) {
      const hasAlternative = requirement.acceptedAlternatives.some(
        (alternative: string) => loopBody.includes(alternative)
      );

      if (!hasAlternative) {
        issues.push(
          `Loop ${requirement.loop} is missing one of ${requirement.acceptedAlternatives.join(', ')}`
        );
      }
    }
  }

  for (const forbiddenPattern of FORBIDDEN_TEMPLATE_PATTERNS) {
    if (forbiddenPattern.pattern.test(normalizedTemplate)) {
      issues.push(
        `Forbidden template artifact detected: ${forbiddenPattern.label}`
      );
    }
  }

  if (HARD_CODED_REMOTE_IMAGE_PATTERN.test(normalizedTemplate)) {
    issues.push(
      'Hardcoded remote image assets are not allowed in generated templates'
    );
  }

  const bodyTemplate =
    normalizedTemplate.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    normalizedTemplate;

  for (const placeholder of CORE_IDENTITY_PLACEHOLDERS) {
    if (countOccurrences(bodyTemplate, placeholder) > 1) {
      issues.push(
        `Duplicate core identity placeholder detected: ${placeholder}`
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    normalizedTemplate,
  };
};
