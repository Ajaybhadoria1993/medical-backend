import { TokenService } from '../services/token.service';
import { database } from '../../../configurations/dbConnection';
import * as authUtils from '../../../utils/authUtils';
import { HttpError } from '../../../middlewear/errorHandler';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/authUtils');

describe('TokenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('issueTokenPair', () => {
    it("signs an access + refresh token and replaces this user's single row", async () => {
      (authUtils.signJwt as jest.Mock).mockReturnValue('access_token');
      (authUtils.signRefreshToken as jest.Mock).mockReturnValue(
        'refresh_token'
      );
      (authUtils.hashToken as jest.Mock).mockReturnValue('hashed_refresh');

      const deleteWhere = jest.fn().mockResolvedValue(undefined);
      (database.delete as jest.Mock).mockReturnValue({ where: deleteWhere });

      const values = jest.fn().mockResolvedValue(undefined);
      (database.insert as jest.Mock).mockReturnValue({ values });

      const result = await TokenService.issueTokenPair('user-1');

      expect(result).toEqual({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
      });
      // Existing row for this user is deleted before the new one is inserted
      expect(database.delete).toHaveBeenCalled();
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          tokenHash: 'hashed_refresh',
        })
      );
    });
  });

  describe('rotateRefreshToken', () => {
    it('throws 401 when the refresh JWT signature/expiry is invalid', async () => {
      (authUtils.verifyRefreshToken as jest.Mock).mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await expect(
        TokenService.rotateRefreshToken('bad.token')
      ).rejects.toThrow(
        new HttpError(401, 'Session expired, please login again.')
      );
    });

    it('revokes the session and throws 401 on refresh-token reuse', async () => {
      (authUtils.verifyRefreshToken as jest.Mock).mockReturnValue({
        sub: 'user-1',
        jti: 'jti-1',
        platform: 'web',
      });
      (authUtils.hashToken as jest.Mock).mockReturnValue('hashed_refresh');

      // Row lookup returns nothing => reuse/unknown token for this user
      (database.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      const deleteWhere = jest.fn().mockResolvedValue(undefined);
      (database.delete as jest.Mock).mockReturnValue({ where: deleteWhere });

      await expect(
        TokenService.rotateRefreshToken('used.token')
      ).rejects.toThrow(
        new HttpError(401, 'Session expired, please login again.')
      );

      expect(database.delete).toHaveBeenCalled();
    });
  });

  describe('revokeToken / revokeAllForUser', () => {
    it("deletes the user's row on logout", async () => {
      (authUtils.verifyRefreshToken as jest.Mock).mockReturnValue({
        sub: 'user-1',
        jti: 'jti-1',
        platform: 'web',
      });
      const deleteWhere = jest.fn().mockResolvedValue(undefined);
      (database.delete as jest.Mock).mockReturnValue({ where: deleteWhere });

      await TokenService.revokeToken('some.token');

      expect(database.delete).toHaveBeenCalled();
      expect(deleteWhere).toHaveBeenCalled();
    });

    it('is a no-op when the refresh token is already invalid', async () => {
      (authUtils.verifyRefreshToken as jest.Mock).mockImplementation(() => {
        throw new Error('expired');
      });

      await expect(
        TokenService.revokeToken('bad.token')
      ).resolves.toBeUndefined();
      expect(database.delete).not.toHaveBeenCalled();
    });
  });
});
