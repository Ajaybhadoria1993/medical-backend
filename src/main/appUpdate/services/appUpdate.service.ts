import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { HttpError } from '../../../middlewear/errorHandler';
import { AppUpdateConfigModel } from '../models/appUpdate.model';
import {
  CreateUpdateConfigDto,
  UpdateUpdateConfigDto,
  GetUpdateConfigDto,
} from '../schemas/appUpdate.schemas';

export class AppUpdateService {
  private static CACHE_TTL = 300; // 5 minutes

  private static getCacheKey(appName: string, platform: string) {
    return `app_update:${appName}:${platform}`;
  }

  static async getAllConfigs() {
    const configs = await database.select().from(AppUpdateConfigModel);

    return configs;
  }

  static async getConfig(query: GetUpdateConfigDto) {
    const cacheKey = this.getCacheKey(query.app_name, query.platform);

    // 1. Check Redis cache
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 2. Cache miss — query database
    const [config] = await database
      .select()
      .from(AppUpdateConfigModel)
      .where(
        and(
          eq(AppUpdateConfigModel.app_name, query.app_name),
          eq(AppUpdateConfigModel.platform, query.platform)
        )
      )
      .limit(1);

    // 3. Store in cache
    if (config) {
      await redisClient.setex(cacheKey, this.CACHE_TTL, JSON.stringify(config));
    }

    return config || null;
  }

  static async createConfig(dto: CreateUpdateConfigDto) {
    const cacheKey = this.getCacheKey(dto.app_name, dto.platform);

    // 1. Check if config already exists for this app + platform
    const existing = await database
      .select({ id: AppUpdateConfigModel.id })
      .from(AppUpdateConfigModel)
      .where(
        and(
          eq(AppUpdateConfigModel.app_name, dto.app_name),
          eq(AppUpdateConfigModel.platform, dto.platform)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw HttpError.conflict(
        `Update configuration for ${dto.app_name} (${dto.platform}) already exists. Use PUT to modify.`
      );
    }

    // 2. Insert new record
    const [created] = await database
      .insert(AppUpdateConfigModel)
      .values({ ...dto })
      .returning();

    // 3. Invalidate cache
    await redisClient.del(cacheKey);

    return created;
  }

  static async updateConfig(dto: UpdateUpdateConfigDto) {
    const cacheKey = this.getCacheKey(dto.app_name, dto.platform);

    // 1. Check if config exists
    const [existing] = await database
      .select({ id: AppUpdateConfigModel.id })
      .from(AppUpdateConfigModel)
      .where(
        and(
          eq(AppUpdateConfigModel.app_name, dto.app_name),
          eq(AppUpdateConfigModel.platform, dto.platform)
        )
      )
      .limit(1);

    if (!existing) {
      throw HttpError.notFound(
        `No update configuration for ${dto.app_name} (${dto.platform}) exists. Use POST to create one.`
      );
    }

    // 2. Update the record
    const [updated] = await database
      .update(AppUpdateConfigModel)
      .set({ ...dto, updated_at: new Date() })
      .where(eq(AppUpdateConfigModel.id, existing.id))
      .returning();

    // 3. Invalidate cache
    await redisClient.del(cacheKey);

    return updated;
  }
}
