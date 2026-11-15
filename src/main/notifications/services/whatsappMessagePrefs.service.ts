import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import {
  CacheKeys,
  getOrSetCache,
  invalidateCache,
} from '../../../utils/cache.util';
import { WhatsAppMessagePrefsModel } from '../models/whatsappMessagePrefs.model';
import { WhatsAppPlatformOffsModel } from '../models/whatsappPlatformOffs.model';
import type { TenantRef } from '../registry/types';
import type { WhatsAppMessageOverrides } from '../types/whatsappMessagePrefs.types';
import type { WhatsAppTemplateKey } from '../types/whatsappTemplate.types';
import {
  CLINIC_WHATSAPP_MESSAGES,
  ClinicWhatsAppMessageKey,
} from '../utils/whatsappMessagePrefs.utils';

const CACHE_TTL_SECONDS = 300;

export class WhatsAppMessagePrefsService {
  static async getOverrides(
    owner: TenantRef
  ): Promise<WhatsAppMessageOverrides> {
    return getOrSetCache(
      CacheKeys.whatsappMessagePrefs(owner.type, owner.id),
      CACHE_TTL_SECONDS,
      () => this.loadOverrides(owner)
    );
  }

  /** Super Admin's switch wins over the owner's own choice. */
  static async isMessageOff(
    owner: TenantRef,
    key: WhatsAppTemplateKey
  ): Promise<boolean> {
    if ((await this.getPlatformOffs()).includes(key)) return true;
    const overrides = await this.getOverrides(owner);
    return overrides[key] === false;
  }

  /** Leaves out messages Super Admin turned off, so clinics never see them. */
  static async listClinicMessages(clinicId: string) {
    const [overrides, platformOffs] = await Promise.all([
      this.getOverrides({ type: 'clinic', id: clinicId }),
      this.getPlatformOffs(),
    ]);
    return this.toClinicList(overrides, platformOffs);
  }

  /** Keys not sent keep their saved choice, so it returns when Super Admin turns them back on. */
  static async saveClinicMessages(
    clinicId: string,
    messages: Partial<Record<ClinicWhatsAppMessageKey, boolean>>,
    updatedBy: string
  ) {
    // From the DB, not the cache: a write must never be built on a stale read.
    const saved = await this.loadOverrides({ type: 'clinic', id: clinicId });
    const overrides: WhatsAppMessageOverrides = {};
    for (const { key } of CLINIC_WHATSAPP_MESSAGES) {
      if ((messages[key] ?? saved[key]) === false) overrides[key] = false;
    }
    await database
      .insert(WhatsAppMessagePrefsModel)
      .values({ ownerType: 'clinic', ownerId: clinicId, overrides, updatedBy })
      .onConflictDoUpdate({
        target: [
          WhatsAppMessagePrefsModel.ownerType,
          WhatsAppMessagePrefsModel.ownerId,
        ],
        set: { overrides, updatedBy, updatedAt: new Date() },
      });
    await invalidateCache(CacheKeys.whatsappMessagePrefs('clinic', clinicId));
    // Built from what was just written; re-reading it would be a wasted query.
    return this.toClinicList(overrides, await this.getPlatformOffs());
  }

  static async listPlatformMessages() {
    const platformOffs = await this.getPlatformOffs();
    return CLINIC_WHATSAPP_MESSAGES.map(({ key, label }) => ({
      key,
      label,
      enabled: !platformOffs.includes(key),
    }));
  }

  static async setPlatformMessage(
    key: ClinicWhatsAppMessageKey,
    enabled: boolean,
    changedBy: string
  ) {
    if (enabled) {
      await database
        .delete(WhatsAppPlatformOffsModel)
        .where(eq(WhatsAppPlatformOffsModel.messageKey, key));
    } else {
      await database
        .insert(WhatsAppPlatformOffsModel)
        .values({ messageKey: key, turnedOffBy: changedBy })
        .onConflictDoNothing();
    }
    await invalidateCache(CacheKeys.whatsappPlatformOffs());
    return this.listPlatformMessages();
  }

  private static toClinicList(
    overrides: WhatsAppMessageOverrides,
    platformOffs: string[]
  ) {
    return CLINIC_WHATSAPP_MESSAGES.filter(
      ({ key }) => !platformOffs.includes(key)
    ).map(({ key, label }) => ({
      key,
      label,
      enabled: overrides[key] !== false,
    }));
  }

  private static async loadOverrides(
    owner: TenantRef
  ): Promise<WhatsAppMessageOverrides> {
    const [row] = await database
      .select({ overrides: WhatsAppMessagePrefsModel.overrides })
      .from(WhatsAppMessagePrefsModel)
      .where(
        and(
          eq(WhatsAppMessagePrefsModel.ownerType, owner.type),
          eq(WhatsAppMessagePrefsModel.ownerId, owner.id)
        )
      )
      .limit(1);
    return row?.overrides ?? {};
  }

  private static async getPlatformOffs(): Promise<string[]> {
    return getOrSetCache(
      CacheKeys.whatsappPlatformOffs(),
      CACHE_TTL_SECONDS,
      async () => {
        const rows = await database
          .select({ key: WhatsAppPlatformOffsModel.messageKey })
          .from(WhatsAppPlatformOffsModel);
        return rows.map((r) => r.key);
      }
    );
  }
}
