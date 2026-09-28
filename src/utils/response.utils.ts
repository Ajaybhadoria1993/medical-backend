import { Response } from 'express';

/**
 * Common structure for success responses
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SuccessResponse<T = any> {
  success: true;
  message: string;
  data?: T;
}

/**
 * Sends a 200 OK success response
 */
export const sendOk = <T>(res: Response, message: string, data?: T) => {
  return res.status(200).json({
    success: true,
    message,
    data,
  });
};

/**
 * Sends a 201 Created success response
 */
export const sendCreated = <T>(res: Response, message: string, data?: T) => {
  return res.status(201).json({
    success: true,
    message,
    data,
  });
};

/**
 * Sends a 204 No Content success response
 */
export const sendNoContent = (res: Response, message: string) => {
  return res.status(204).json({
    success: true,
    message,
  });
};
