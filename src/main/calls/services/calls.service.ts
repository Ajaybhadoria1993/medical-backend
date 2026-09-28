import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import type { AuthUser } from '../../../middlewear/auth.middleware';
import { HttpError } from '../../../middlewear/errorHandler';
import { CacheKeys } from '../../../utils/cache.util';
import logger from '../../../utils/logger';
import { realtimeBus, rooms, target } from '../../realtime';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import type {
  ActiveCallsResponse,
  CallPerson,
  CallType,
  CallView,
  ClinicCall,
} from '../types/calls.types';
import {
  CALL_KEEP_SECONDS,
  CALL_RING_MS,
  resolveStatus,
  toCallView,
} from '../utils/calls.utils';

type Actor = Pick<AuthUser, 'id'>;
type Entry = { raw: string; call: ClinicCall };

const ENDED = 'This call has ended.';

// Compare-and-set on one hash field, so two receptionists answering at once can't both win.
const CAS_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if (cur or '') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1`;

export class CallsService {
  static async getActive(
    user: Actor,
    clinicId: string,
    withReceptionists: boolean
  ): Promise<ActiveCallsResponse> {
    const now = Date.now();
    const entries = await this.readAll(clinicId, now);

    const incoming = entries
      .map((e) => e.call)
      .filter(
        (c) =>
          resolveStatus(c, now) === 'ringing' &&
          c.recipientIds.includes(user.id) &&
          !c.declinedIds.includes(user.id)
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => toCallView(c, now));

    const mine = entries.find((e) => e.call.doctor.id === user.id);

    return {
      incoming,
      myCall: mine ? toCallView(mine.call, now) : null,
      ...(withReceptionists && {
        receptionists: await this.onlineReceptionists(clinicId, user.id),
      }),
      serverTime: new Date(now).toISOString(),
    };
  }

  static async placeCall(
    user: Actor,
    clinicId: string,
    input: { type: CallType; receptionistId?: string }
  ): Promise<CallView> {
    const now = Date.now();
    const current = (await this.readAll(clinicId, now)).find(
      (e) => e.call.doctor.id === user.id
    );
    if (current && resolveStatus(current.call, now) === 'ringing') {
      throw new HttpError(409, 'You already have a call ringing.');
    }

    const online = await this.onlineReceptionists(clinicId, user.id);
    const picked = input.receptionistId
      ? online.find((r) => r.id === input.receptionistId)
      : null;
    if (input.receptionistId && !picked) {
      throw new HttpError(
        409,
        'That receptionist is no longer online. Choose someone else.'
      );
    }
    if (online.length === 0) {
      throw new HttpError(409, 'No receptionist is online right now.');
    }

    const [doctor] = await database
      .select({
        name: UserModel.name,
        profileImage: UserProfileModel.profileImage,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(UserModel.id, user.id))
      .limit(1);

    const call: ClinicCall = {
      id: randomUUID(),
      clinicId,
      type: input.type,
      doctor: {
        id: user.id,
        name: doctor?.name ?? 'Doctor',
        profileImage: doctor?.profileImage ?? null,
      },
      target: picked ?? null,
      recipientIds: picked ? [picked.id] : online.map((r) => r.id),
      declinedIds: [],
      status: 'ringing',
      answeredBy: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CALL_RING_MS).toISOString(),
      endedAt: null,
    };

    // A lost race means another tab of this doctor placed a call first.
    if (!(await this.cas(clinicId, user.id, current?.raw ?? '', call))) {
      throw new HttpError(409, 'You already have a call ringing.');
    }
    realtimeBus.notify(target.calls(clinicId), 'call_placed');
    return toCallView(call, now);
  }

  static answer(user: Actor, clinicId: string, callId: string) {
    return this.update(clinicId, callId, 'call_answered', async (call, now) => {
      this.assertRinging(call, user.id, now);
      return {
        ...call,
        status: 'answered' as const,
        answeredBy: { id: user.id, name: await this.userName(user.id) },
        endedAt: new Date(now).toISOString(),
      };
    });
  }

  static decline(user: Actor, clinicId: string, callId: string) {
    return this.update(clinicId, callId, 'call_declined', (call, now) => {
      this.assertRinging(call, user.id, now);
      const declinedIds = [...new Set([...call.declinedIds, user.id])];
      const allDeclined = call.recipientIds.every((id) =>
        declinedIds.includes(id)
      );
      return {
        ...call,
        declinedIds,
        ...(allDeclined && {
          status: 'busy' as const,
          endedAt: new Date(now).toISOString(),
        }),
      };
    });
  }

  static cancel(user: Actor, clinicId: string, callId: string) {
    return this.update(clinicId, callId, 'call_cancelled', (call, now) => {
      if (call.doctor.id !== user.id) throw new HttpError(404, ENDED);
      // Already ended (answered while the doctor clicked): keep that outcome.
      if (resolveStatus(call, now) !== 'ringing') return call;
      return {
        ...call,
        status: 'cancelled' as const,
        endedAt: new Date(now).toISOString(),
      };
    });
  }

  private static assertRinging(call: ClinicCall, userId: string, now: number) {
    if (!call.recipientIds.includes(userId)) throw new HttpError(404, ENDED);
    if (call.status === 'answered' && call.answeredBy) {
      throw new HttpError(
        409,
        `${call.answeredBy.name} already answered this call.`
      );
    }
    if (resolveStatus(call, now) !== 'ringing') throw new HttpError(409, ENDED);
  }

  private static async update(
    clinicId: string,
    callId: string,
    reason: string,
    change: (call: ClinicCall, now: number) => ClinicCall | Promise<ClinicCall>
  ): Promise<CallView> {
    // Retries only when another write landed between our read and our CAS.
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = Date.now();
      const entry = (await this.readAll(clinicId, now)).find(
        (e) => e.call.id === callId
      );
      if (!entry) throw new HttpError(404, ENDED);

      const next = await change(entry.call, now);
      if (next === entry.call) return toCallView(next, now);

      if (await this.cas(clinicId, next.doctor.id, entry.raw, next)) {
        realtimeBus.notify(target.calls(clinicId), reason);
        return toCallView(next, now);
      }
    }
    throw new HttpError(409, 'The call just changed. Please try again.');
  }

  private static async readAll(
    clinicId: string,
    now: number
  ): Promise<Entry[]> {
    const key = CacheKeys.clinicCalls(clinicId);
    const hash = await redisClient.hgetall(key);
    const entries: Entry[] = [];
    const stale: string[] = [];

    for (const [doctorId, raw] of Object.entries(hash)) {
      try {
        const call = JSON.parse(raw) as ClinicCall;
        const ageMs = now - Date.parse(call.createdAt);
        if (ageMs > CALL_KEEP_SECONDS * 1000) stale.push(doctorId);
        else entries.push({ raw, call });
      } catch {
        stale.push(doctorId);
      }
    }

    if (stale.length) {
      redisClient.hdel(key, ...stale).catch((err) => {
        logger.warn(`[Calls] Failed to prune clinic=${clinicId}`, err);
      });
    }
    return entries;
  }

  private static async cas(
    clinicId: string,
    doctorId: string,
    expectedRaw: string,
    next: ClinicCall
  ): Promise<boolean> {
    const result = await redisClient.eval(
      CAS_SCRIPT,
      1,
      CacheKeys.clinicCalls(clinicId),
      doctorId,
      expectedRaw,
      JSON.stringify(next),
      CALL_KEEP_SECONDS
    );
    return result === 1;
  }

  // Assignment is checked now, not at connect time, so a doctor added mid-shift is covered at once.
  private static async onlineReceptionists(
    clinicId: string,
    doctorId: string
  ): Promise<CallPerson[]> {
    const { socketManager } = require('../../../app');
    const sockets = await socketManager.io
      .in(rooms.clinicRole(clinicId, 'Receptionist'))
      .fetchSockets();

    const byId = new Map<string, string>();
    for (const s of sockets as { data?: { user?: Record<string, string> } }[]) {
      const u = s.data?.user;
      if (u?.userType === 'Receptionist' && !byId.has(u.id)) {
        byId.set(u.id, u.name || 'Receptionist');
      }
    }

    const people = [...byId].map(([id, name]) => ({ id, name }));
    const allowed = await Promise.all(
      people.map(async (p) => {
        const ids = await StaffScopeService.getAccessibleDoctorIds(
          { id: p.id, userType: 'Receptionist' },
          clinicId
        );
        return ids === null || ids.includes(doctorId);
      })
    );
    return people.filter((_, i) => allowed[i]);
  }

  private static async userName(userId: string): Promise<string> {
    const [row] = await database
      .select({ name: UserModel.name })
      .from(UserModel)
      .where(eq(UserModel.id, userId))
      .limit(1);
    return row?.name ?? 'Reception';
  }
}
