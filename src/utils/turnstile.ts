import axios from 'axios';
import { envConfig } from './envConfig';
import logger from './logger';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

/**
 * Verifies the Cloudflare Turnstile token
 * @param token The CAPTCHA token received from the frontend
 * @param remoteIp The IP address of the user (optional)
 * @returns boolean indicating if verification was successful
 */
export const verifyTurnstileToken = async (
  token: string,
  remoteIp?: string
): Promise<boolean> => {
  try {
    if (!token) {
      logger.warn('Turnstile verification failed: No token provided');
      return false;
    }

    const response = await axios.post<TurnstileResponse>(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        secret: envConfig.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: remoteIp,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const { success, 'error-codes': errorCodes } = response.data;

    if (!success) {
      logger.error('Turnstile verification failed:', {
        errorCodes,
        token: token.substring(0, 10) + '...',
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error during Turnstile verification:', error);
    return false;
  }
};
