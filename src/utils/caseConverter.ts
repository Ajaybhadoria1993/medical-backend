import _ from 'lodash';

/**
 * Function for converting the string or key in camel case
 * @param key
 * @returns
 */
export const convertToCamelCase = (key: string): string => {
  return _.camelCase(key);
};

/**
 * Function for converting the string or key in snake case
 * @param key
 * @returns
 */
export const convertToSnakeCase = (key: string): string => {
  return _.snakeCase(key);
};

/**
 * Function for converting the string or key in kebab case
 * @param key
 * @returns
 */
export const convertToKebabCase = (key: string): string => {
  return _.kebabCase(key);
};
