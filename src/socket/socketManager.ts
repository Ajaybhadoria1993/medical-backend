/* eslint-disable @typescript-eslint/no-explicit-any */
// src/socket/socketManager.ts
import { Server as HttpServer } from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { eq, and, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import { requireSocketAuth } from '../middlewear/socketAuth';
import {
  listUnreadNotificationsForUser,
  markManyRead,
  markAllNotificationsRead,
} from '../main/notifications/services/notifications.service';
import { database } from '../configurations/dbConnection';
import { ClinicAssignModel } from '../main/clinic/models/clinic.model';
import { UserModel } from '../main/users/models/user.model';
import { UserLabAssignmentsModel } from '../main/lab/models/lab.model';
import { StaffScopeService } from '../main/permissions/services/staffScope.service';
import { rooms } from '../main/realtime';
import {
  computeClinicEta,
  getClinicCoordinates,
} from '../main/clinic/services/distance.service';
import { TimeToNextService } from '../main/appointment-engine/services/timeToNext.service';
import {
  computeLiveQueuePayload,
  loadLiveQueueAppointment,
} from '../main/appointment-engine/services/liveQueueHelper';
import logger from '../utils/logger';
import redis from '../configurations/redisConfig';
import { envConfig } from '../utils/envConfig';

export type SocketEventPayload = {
  event: string;
  payload: any;
  room?: string;
  socketId?: string;
  correlationId?: string;
};

/**
 * Floor between two on-demand queue refreshes from one socket. Generous enough
 * for pull-to-refresh and screen-focus, tight enough that a client looping on
 * the event cannot turn a zero-DB read into a Redis hot spot.
 */
const QUEUE_REFRESH_MIN_INTERVAL_MS = 5000;

export class SocketManager {
  public io: IOServer;

  constructor(httpServer: HttpServer, options?: { cors?: any }) {
    this.io = new IOServer(httpServer, {
      cors: options?.cors ?? { origin: '*' },
      maxHttpBufferSize: 1e6, // 1MB max message size
      connectTimeout: 10000, // 10s handshake timeout
      pingInterval: 30000, // 30s ping interval (mobile-friendly)
      pingTimeout: 30000, // 30s ping timeout (mobile-friendly)
    });

    // Redis adapter for multi-instance Socket.IO (rooms work across nodes)
    try {
      const redisOpts = {
        host: envConfig.REDIS_HOST,
        port: envConfig.REDIS_PORT,
        password: envConfig.REDIS_PASSWORD,
        // Long-lived pub/sub, not request/response: a command must never give
        // up and throw MaxRetriesPerRequestError, which would take the process
        // down over a Redis blip. These two carry every cross-node emit now
        // that Kafka is gone, so they reconnect indefinitely instead.
        maxRetriesPerRequest: null,
        retryStrategy: (times: number) => Math.min(times * 200, 5000),
      };
      const pubClient = new Redis(redisOpts);
      const subClient = new Redis(redisOpts);

      // An 'error' event with no listener throws on an EventEmitter, so these
      // are not optional logging — without them a connection error is fatal.
      pubClient.on('error', (err) =>
        logger.error(`[SocketManager] Redis pub client: ${err.message}`)
      );
      subClient.on('error', (err) =>
        logger.error(`[SocketManager] Redis sub client: ${err.message}`)
      );

      this.io.adapter(createAdapter(pubClient, subClient));
      logger.info(
        '[SocketManager] Redis adapter attached for multi-instance support'
      );
    } catch (err) {
      logger.warn(
        '[SocketManager] Failed to attach Redis adapter. Falling back to in-memory (single instance only).',
        err
      );
    }

    this.io.use(requireSocketAuth);
    this.setupConnectionHandler();
  }

  private genCorrelationId() {
    const anyCrypto: any =
      (globalThis as any).crypto || (globalThis as any).require?.('crypto');
    if (anyCrypto && typeof anyCrypto.randomUUID === 'function')
      return anyCrypto.randomUUID();
    return `cid_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  }

  /**
   * Joins the narrower rooms the realtime bus targets, on top of the broad
   * `clinic:{id}` room. Two kinds: `clinic:{c}:role:{userType}`, free from the
   * handshake's user row, and `clinic:{c}:doctor:{d}`, where staff join the
   * doctors `StaffScopeService` assigns them (null meaning unrestricted, so
   * every doctor — the set ReceptionLiveQueueService builds from).
   *
   * The scope lookups are Redis-cached, so a burst of connections costs one
   * query per user per clinic per window rather than one per socket.
   *
   * Evaluated only at connect time, never re-checked on a timer: a staff member
   * whose assignment changes keeps their old rooms until the socket reconnects.
   * Never throws — a failed room join must not break an authenticated socket.
   */
  private async joinScopedRooms(
    socket: Socket,
    user: { id: string; userType?: string | null },
    clinicIds: string[]
  ): Promise<void> {
    const userType = user.userType ?? undefined;
    if (!userType || clinicIds.length === 0) return;

    const isDoctor = userType === 'Doctor';
    // Admins run reception screens as well as their own queue, so they may
    // need the whole board — narrowed per-clinic below via StaffScopeService.
    const watchesBoard = userType === 'Receptionist' || userType === 'Admin';

    for (const clinicId of clinicIds) {
      try {
        socket.join(rooms.clinicRole(clinicId, userType));

        if (isDoctor) {
          socket.join(rooms.clinicDoctor(clinicId, user.id));
        }

        if (watchesBoard) {
          const allowedDoctorIds =
            await StaffScopeService.getAccessibleDoctorIds(
              { id: user.id, userType },
              clinicId
            );

          const doctorIds =
            allowedDoctorIds === null
              ? await this.getClinicDoctorIds(clinicId)
              : allowedDoctorIds;

          for (const doctorId of doctorIds) {
            socket.join(rooms.clinicDoctor(clinicId, doctorId));
          }
        }
      } catch (e) {
        logger.warn(
          `[SocketManager] scoped room join failed for clinic=${clinicId}`,
          e
        );
      }
    }
  }

  /**
   * Doctor/Admin user ids for a clinic, Redis-cached for 10 minutes. Mirrors
   * ReceptionLiveQueueService's query so joined rooms match the rendered board.
   */
  private async getClinicDoctorIds(clinicId: string): Promise<string[]> {
    const cacheKey = `clinic:doctors:${clinicId}`;

    try {
      const cached = await redis.lrange(cacheKey, 0, -1);
      if (cached.length) return cached;
    } catch {
      // Cache miss and cache failure are the same thing here — fall through
      // to the query rather than dropping the rooms entirely.
    }

    const staff = await database
      .select({ userId: ClinicAssignModel.userId })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          inArray(UserModel.userType, ['Doctor', 'Admin'])
        )
      );

    const doctorIds = staff.map((s) => s.userId);

    if (doctorIds.length) {
      try {
        await redis.rpush(cacheKey, ...doctorIds);
        await redis.expire(cacheKey, 60 * 10);
      } catch {
        // Caching is an optimisation; a failure here is not worth surfacing.
      }
    }

    return doctorIds;
  }

  /**
   * Lab ids this user is assigned to (`UserLabAssignmentsModel`), Redis-cached
   * for 10 minutes on the same pattern as `getClinicDoctorIds` — a lab worklist
   * update should reach whoever works that lab without a per-connection query.
   */
  private async getUserLabIds(userId: string): Promise<string[]> {
    const cacheKey = `user:labs:${userId}`;

    try {
      const cached = await redis.lrange(cacheKey, 0, -1);
      if (cached.length) return cached;
    } catch {
      // Cache miss and cache failure are the same thing here — fall through
      // to the query rather than dropping the rooms entirely.
    }

    const assignments = await database
      .select({ labId: UserLabAssignmentsModel.labId })
      .from(UserLabAssignmentsModel)
      .where(eq(UserLabAssignmentsModel.userId, userId));

    const labIds = assignments.map((a) => a.labId);

    if (labIds.length) {
      try {
        await redis.rpush(cacheKey, ...labIds);
        await redis.expire(cacheKey, 60 * 10);
      } catch {
        // Caching is an optimisation; a failure here is not worth surfacing.
      }
    }

    return labIds;
  }

  /**
   * Joins every `lab:{labId}` room this user is assigned to. Separate from
   * `joinScopedRooms` because lab membership is per-user (an assignment
   * table), not derivable from `userType` the way doctor/reception rooms are.
   */
  private async joinLabRooms(socket: Socket, userId: string): Promise<void> {
    try {
      const labIds = await this.getUserLabIds(userId);
      for (const labId of labIds) {
        socket.join(rooms.lab(labId));
      }
    } catch (e) {
      logger.warn(`[SocketManager] lab room join failed for user=${userId}`, e);
    }
  }

  /**
   * Clinic ids a user is assigned to, Redis-cached with a DB fallback. The TTL
   * is 10 minutes and a socket outlives it, so reading Redis alone (as the join
   * handler used to) denied every join after expiry for an entitled user.
   */
  private async getUserClinicIds(userId: string): Promise<string[]> {
    const cacheKey = `user:clinics:${userId}`;

    const cached = await redis
      .lrange(cacheKey, 0, -1)
      .catch(() => [] as string[]);
    if (cached.length) return cached;

    const assignments = await database
      .select({ clinicId: ClinicAssignModel.clinicId })
      .from(ClinicAssignModel)
      .where(eq(ClinicAssignModel.userId, userId));

    const clinicIds = assignments.map((a) => a.clinicId);

    if (clinicIds.length) {
      await redis
        .rpush(cacheKey, ...clinicIds)
        .then(() => redis.expire(cacheKey, 60 * 10))
        .catch(() => {
          // Caching is an optimisation; a failure must not deny the join.
        });
    }

    return clinicIds;
  }

  /**
   * Whether a client may join a room it named. An allowlist, not a denylist:
   * the previous version fell through to `socket.join(room)`, so any
   * authenticated client could join `live-queue:*` or `appointment:*` by name
   * and receive another patient's queue or prescription URL.
   *
   * Only `user:<id>` (must be the caller's own) and `clinic:<uuid>` (must be
   * assigned) are reachable. Doctor/role rooms are joined on connect from the
   * user's own assignments, so honouring a request would mean trusting a
   * client-supplied doctor id; `live-queue:*` has its own ownership-checking
   * handler; `appointment:*` carries PDF URLs and has no membership rule.
   *
   * Refusals are logged, so a client legitimately needing a prefix shows up as
   * a warning rather than a feature that quietly stopped working.
   */
  private async mayJoinRoom(
    user: { id?: string } | null,
    room: unknown
  ): Promise<boolean> {
    if (typeof room !== 'string' || !room) return false;

    if (!user?.id) {
      logger.warn(`[SocketManager] Unauthenticated room join refused: ${room}`);
      return false;
    }

    if (room.startsWith('user:')) {
      if (room === `user:${user.id}`) return true;
      logger.warn(
        `[SocketManager] Unauthorized room join attempt: ${room} by user=${user.id}`
      );
      return false;
    }

    if (room.startsWith('clinic:')) {
      const clinicId = room.slice('clinic:'.length);

      // Exact match only. `clinic:{c}:doctor:{d}` also starts with `clinic:`,
      // and the old `room.replace('clinic:', '')` turned it into
      // "c:doctor:d" — never a member id, so those joins were always denied.
      if (!clinicId || clinicId.includes(':')) {
        logger.warn(
          `[SocketManager] Refused scoped clinic room join: ${room} by user=${user.id} (joined on connect, not by request)`
        );
        return false;
      }

      const clinicIds = await this.getUserClinicIds(user.id);
      if (clinicIds.includes(clinicId)) return true;

      logger.warn(
        `[SocketManager] Unauthorized clinic room join: ${room} by user=${user.id}`
      );
      return false;
    }

    logger.warn(
      `[SocketManager] Refused join to unrecognised room prefix: ${room} by user=${user.id}`
    );
    return false;
  }

  private setupConnectionHandler() {
    this.io.on('connection', async (socket: Socket) => {
      const user = (socket as any).data?.user ?? (socket as any).user ?? null;
      logger.info(
        `[SocketManager] client connected: ${socket.id}`,
        user ? `user=${user.id}` : ''
      );

      // Join user's private room + clinic rooms
      try {
        if (user?.id) {
          socket.join(`user:${user.id}`);
          logger.info(
            '[SocketManager] user joined private room',
            `user:${user.id}`
          );

          const clinicIds = await this.getUserClinicIds(user.id);

          for (const clinicId of clinicIds) {
            socket.join(`clinic:${clinicId}`);
          }

          await this.joinScopedRooms(socket, user, clinicIds);
          await this.joinLabRooms(socket, user.id);
        }
      } catch (e) {
        logger.warn('[SocketManager] join user room error', e);
      }

      // Send unread notifications on login
      try {
        if (user?.id) {
          const unread = await listUnreadNotificationsForUser(user.id, {
            limit: 100,
          });

          socket.emit('notification.initial_unread', {
            count: unread.length,
            notifications: unread.map((n) => ({
              notificationId: n.id,
              userId: n.userId,
              type: n.type,
              title: n.title,
              body: n.body,
              data: n.data ?? null,
              metadata: n.metadata ?? null,
              read: n.read,
              createdAt: n.createdAt,
            })),
          });
        }
      } catch (e) {
        logger.warn('[SocketManager] failed to emit unread notifications', e);
      }

      // Send cached queue state on connection (for clinic dashboard)
      try {
        if (user?.id) {
          const cacheKey = `user:clinics:${user.id}`;
          const clinicIds = await redis.lrange(cacheKey, 0, -1);

          if (clinicIds.length > 0) {
            const today = new Date().toISOString().split('T')[0];
            const timeToNextService = new TimeToNextService();

            const emitQueueStateForKey = async (
              clinicId: string,
              key: string
            ) => {
              const raw = await redis.get(key);
              if (!raw) return;

              try {
                const queueData = JSON.parse(raw);
                const timeToNextMinutes = await timeToNextService.compute(
                  queueData.clinicId,
                  queueData.doctorId,
                  today
                );

                socket.emit('queue.updated', {
                  clinicId: queueData.clinicId,
                  doctorId: queueData.doctorId,
                  date: queueData.date,
                  cumulativeDelay: queueData.cumulativeDelayMinutes,
                  lastCalculatedAt: queueData.lastCalculatedAt,
                  appointments: queueData.appointments.map((entry: any) => ({
                    appointmentId: entry.appointmentId,
                    status: entry.status,
                    appointmentTime: entry.scheduledTime,
                    estimatedWaitMinutes: entry.estimatedWaitMinutes,
                    cumulativeDelay: queueData.cumulativeDelayMinutes,
                  })),
                });

                socket.emit('timeToNext.updated', {
                  clinicId,
                  timeToNextMinutes,
                  ts: new Date().toISOString(),
                });
              } catch {
                // Skip malformed cache entries
              }
            };

            const emitQueueStateForClinic = async (clinicId: string) => {
              // Use SCAN instead of KEYS to avoid blocking Redis
              const pattern = `appointment_engine:delay:${clinicId}:*:${today}`;
              const keys: string[] = [];
              let cursor = '0';
              do {
                const [nextCursor, batch] = await redis.scan(
                  cursor,
                  'MATCH',
                  pattern,
                  'COUNT',
                  20
                );
                cursor = nextCursor;
                keys.push(...batch);
              } while (cursor !== '0');

              await Promise.all(
                keys.map((key) => emitQueueStateForKey(clinicId, key))
              );
            };

            await Promise.all(clinicIds.map(emitQueueStateForClinic));
          }
        }
      } catch (e) {
        logger.warn(
          '[SocketManager] failed to emit cached queue state on connection',
          e
        );
      }

      // ─── Notification handlers ─────────────────────────────────────────────

      socket.on(
        'notification.mark_read',
        async (
          data: { notificationId: string },
          ack?: (...args: any[]) => void
        ) => {
          try {
            if (!data?.notificationId) {
              if (ack)
                ack({ status: 'error', message: 'notificationId required' });
              return;
            }

            if (!user?.id) {
              if (ack)
                ack({ status: 'error', message: 'authentication required' });
              return;
            }

            // Scoped to the caller's own rows. This used to update by id alone
            // and return the whole row in the ack, so any authenticated client
            // holding a notification id could read and mark another user's
            // notification.
            const [updated] = await markManyRead(user.id, [
              data.notificationId,
            ]);

            if (!updated) {
              if (ack)
                ack({ status: 'error', message: 'notification not found' });
              return;
            }

            socket.emit('notification.marked_read', {
              notificationId: data.notificationId,
              read: true,
            });

            if (ack)
              ack({
                status: 'success',
                notificationId: data.notificationId,
              });
          } catch (err) {
            logger.error('[SocketManager] notification.mark_read error', err);
            if (ack) ack({ status: 'error', message: String(err) });
          }
        }
      );

      socket.on(
        'notification.mark_all_read',
        async (ack?: (...args: any[]) => void) => {
          try {
            if (!user?.id) {
              if (ack)
                ack({ status: 'error', message: 'authentication required' });
              return;
            }

            const result = await markAllNotificationsRead(user.id);

            socket.emit('notification.all_marked_read', {
              userId: user.id,
              count: result.count,
            });

            if (ack) ack({ status: 'success', count: result.count });
          } catch (err) {
            logger.error(
              '[SocketManager] notification.mark_all_read error',
              err
            );
            if (ack) ack({ status: 'error', message: String(err) });
          }
        }
      );

      // ─── Generic event forwarding ─────────────────────────────────────────

      socket.on(
        'event_to_server',
        async (msg: SocketEventPayload, ack?: (response: any) => void) => {
          try {
            if (!msg || !msg.event) {
              if (typeof ack === 'function')
                ack({ status: 'error', message: 'invalid payload' });
              return;
            }

            const correlationId = msg.correlationId ?? this.genCorrelationId();
            const payload = {
              ...msg.payload,
              from: user?.id ?? null,
              correlationId,
            };
            // Straight to the sockets; the Redis adapter fans out across nodes.
            // Previously a Kafka round trip, which is why chat reached nobody
            // whenever the broker was down.
            this.emitByKafkaMessage({
              event: msg.event,
              payload,
              socketId: socket.id,
              room: msg.room,
              correlationId,
              ts: new Date().toISOString(),
            } as SocketEventPayload);

            if (typeof ack === 'function')
              ack({ status: 'accepted', correlationId });
          } catch (err) {
            logger.error('[SocketManager] publish error', err);
            if (typeof ack === 'function')
              ack({ status: 'error', message: String(err) });
          }
        }
      );

      // ─── Room management ───────────────────────────────────────────────────

      socket.on('join', async (room: string) => {
        try {
          if (!(await this.mayJoinRoom(user, room))) return;
          socket.join(room);
        } catch (e) {
          logger.warn('[SocketManager] join room error', e);
        }
      });

      socket.on('leave', (room: string) => {
        try {
          // Only rooms this socket actually holds. Leaving one it was never in
          // is harmless in itself, but accepting arbitrary strings here is the
          // same shape of bug the join handler had.
          if (!socket.rooms.has(room)) return;
          socket.leave(room);
        } catch (e) {
          logger.warn('[SocketManager] leave room error', e);
        }
      });

      // ─── Live Queue (Patient) ──────────────────────────────────────────────

      socket.on(
        'join.live-queue',
        async (
          data: {
            appointmentId: string;
            latitude?: number;
            longitude?: number;
          },
          ack?: (response: any) => void
        ) => {
          // Reports a rejection through both channels: `ack` alone is invisible
          // to a client that emitted without a callback, which then reads as a
          // hung screen rather than "session expired" or "access denied".
          const fail = (message: string, code: string) => {
            if (ack) ack({ status: 'error', code, message });
            socket.emit('queue.error', {
              event: 'join.live-queue',
              code,
              message,
              appointmentId: data?.appointmentId ?? null,
            });
            logger.warn(
              `[SocketManager] join.live-queue rejected (${code}) for user=${
                user?.id ?? 'anonymous'
              } appointment=${data?.appointmentId ?? 'none'}: ${message}`
            );
          };

          try {
            if (!data?.appointmentId) {
              fail('appointmentId required', 'INVALID_PAYLOAD');
              return;
            }
            if (!user?.id) {
              fail('authentication required', 'UNAUTHENTICATED');
              return;
            }

            // Same access rule as the REST endpoint (temp id, ownership, today
            // in IST, open, has a doctor); a rejection carries its code.
            let appointment: Awaited<
              ReturnType<typeof loadLiveQueueAppointment>
            >;
            try {
              appointment = await loadLiveQueueAppointment(
                data.appointmentId,
                user.id
              );
            } catch (err) {
              const code = (err as { details?: { code?: string } })?.details
                ?.code;
              if (!code) throw err;
              fail((err as Error).message, code);
              return;
            }
            const resolvedId = appointment.id;

            // Join room and store metadata
            const lqRoom = `live-queue:${appointment.clinicId}:${appointment.doctorId}`;
            socket.join(lqRoom);
            (socket as any).liveQueueData = {
              appointmentId: resolvedId,
              clinicId: appointment.clinicId,
              doctorId: appointment.doctorId,
            };

            // Emit current queue state
            const payload: any = await computeLiveQueuePayload(
              resolvedId,
              appointment.clinicId,
              appointment.doctorId
            );

            // Optional: patient location supplied → attach clinic ETA
            if (
              typeof data.latitude === 'number' &&
              typeof data.longitude === 'number' &&
              !Number.isNaN(data.latitude) &&
              !Number.isNaN(data.longitude) &&
              data.latitude >= -90 &&
              data.latitude <= 90 &&
              data.longitude >= -180 &&
              data.longitude <= 180
            ) {
              const clinicGeo = await getClinicCoordinates(
                appointment.clinicId
              );

              if (clinicGeo.coordinates) {
                payload.eta = await computeClinicEta(
                  appointment.clinicId,
                  { latitude: data.latitude, longitude: data.longitude },
                  clinicGeo.coordinates
                );
              }
            }

            socket.emit('queue.update', payload);

            if (ack) ack({ status: 'success', message: 'Joined live queue' });
            logger.info(
              `[SocketManager] Patient ${user.id} joined live-queue for appointment=${resolvedId}`
            );
          } catch (err) {
            logger.error('[SocketManager] join.live-queue error', err);
            // The message is deliberately generic — an unexpected throw here
            // can carry driver/query detail that has no business reaching a
            // patient's device. The real error is in the log line above.
            if (ack)
              ack({
                status: 'error',
                code: 'INTERNAL_ERROR',
                message: 'Could not join the live queue',
              });
            socket.emit('queue.error', {
              event: 'join.live-queue',
              code: 'INTERNAL_ERROR',
              message: 'Could not join the live queue',
              appointmentId: data?.appointmentId ?? null,
            });
          }
        }
      );

      /**
       * On-demand refresh for a client already in the live queue — zero DB
       * queries when the cache is warm, reusing the appointment/clinic/doctor
       * stored on the socket at join time, so no ownership re-check is needed.
       *
       * Covers the moments a broadcast does not: pull-to-refresh, regained
       * focus, reconnect. The queue tick only pushes on a change, which
       * otherwise leaves a client no way to ask.
       */
      socket.on(
        'queue.refresh',
        async (_data: unknown, ack?: (response: any) => void) => {
          const lqData = (socket as any).liveQueueData;

          if (!lqData?.appointmentId) {
            const message = 'Join the live queue before refreshing';
            if (ack) ack({ status: 'error', code: 'NOT_JOINED', message });
            socket.emit('queue.error', {
              event: 'queue.refresh',
              code: 'NOT_JOINED',
              message,
              appointmentId: null,
            });
            return;
          }

          // Cheap throttle. A client looping on this would turn a zero-DB read
          // into a Redis hot spot, and on a cache miss into a query per call.
          const now = Date.now();
          const last = (socket as any).lastQueueRefreshAt ?? 0;
          if (now - last < QUEUE_REFRESH_MIN_INTERVAL_MS) {
            if (ack)
              ack({
                status: 'throttled',
                message: 'Refreshing too quickly; try again shortly',
              });
            return;
          }
          (socket as any).lastQueueRefreshAt = now;

          try {
            const { computeLiveQueuePayloadFromCache } =
              await import('../main/appointment-engine/services/liveQueueHelper');

            const result = await computeLiveQueuePayloadFromCache(
              lqData.appointmentId,
              lqData.clinicId,
              lqData.doctorId
            );

            if (!result) {
              // No longer in today's queue — the same outcome the broadcast
              // path reports, so a client handles one case rather than two.
              socket.emit('queue.completed', {
                appointmentId: lqData.appointmentId,
                status: 'unknown',
                message: 'Your appointment is no longer in the queue',
              });
              socket.leave(`live-queue:${lqData.clinicId}:${lqData.doctorId}`);
              (socket as any).liveQueueData = null;
              if (ack) ack({ status: 'success', inQueue: false });
              return;
            }

            socket.emit('queue.update', result.payload);
            if (ack)
              ack({
                status: 'success',
                inQueue: true,
                fromCache: result.fromCache,
              });
          } catch (err) {
            logger.error('[SocketManager] queue.refresh error', err);
            const message = 'Could not refresh the queue';
            if (ack) ack({ status: 'error', code: 'INTERNAL_ERROR', message });
            socket.emit('queue.error', {
              event: 'queue.refresh',
              code: 'INTERNAL_ERROR',
              message,
              appointmentId: lqData.appointmentId,
            });
          }
        }
      );

      socket.on('leave.live-queue', () => {
        const lqData = (socket as any).liveQueueData;
        if (lqData) {
          socket.leave(`live-queue:${lqData.clinicId}:${lqData.doctorId}`);
          (socket as any).liveQueueData = null;
        }
      });

      // ─── Clinic ETA (Patient) ──────────────────────────────────────────────

      socket.on(
        'clinic.eta',
        async (
          data: { clinicId: string; latitude: number; longitude: number },
          ack?: (response: any) => void
        ) => {
          try {
            if (!user?.id) {
              if (ack)
                ack({ status: 'error', message: 'authentication required' });
              return;
            }
            if (
              !data?.clinicId ||
              typeof data.latitude !== 'number' ||
              typeof data.longitude !== 'number' ||
              Number.isNaN(data.latitude) ||
              Number.isNaN(data.longitude)
            ) {
              if (ack)
                ack({
                  status: 'error',
                  message: 'clinicId, latitude and longitude are required',
                });
              return;
            }
            if (
              data.latitude < -90 ||
              data.latitude > 90 ||
              data.longitude < -180 ||
              data.longitude > 180
            ) {
              if (ack) ack({ status: 'error', message: 'Invalid coordinates' });
              return;
            }

            const clinicGeo = await getClinicCoordinates(data.clinicId);

            if (!clinicGeo.found) {
              if (ack) ack({ status: 'error', message: 'Clinic not found' });
              return;
            }
            if (!clinicGeo.coordinates) {
              if (ack)
                ack({
                  status: 'error',
                  message: 'Clinic location is not configured',
                });
              return;
            }

            const result = await computeClinicEta(
              data.clinicId,
              { latitude: data.latitude, longitude: data.longitude },
              clinicGeo.coordinates
            );

            socket.emit('clinic.eta.result', result);
            if (ack) ack({ status: 'success', data: result });
          } catch (err) {
            logger.error('[SocketManager] clinic.eta error', err);
            if (ack) ack({ status: 'error', message: String(err) });
          }
        }
      );

      socket.on('disconnect', (reason) => {
        logger.info(
          `[SocketManager] client disconnected: ${socket.id} reason=${reason}`
        );
      });
    });
  }

  // ─── Cross-node delivery ─────────────────────────────────────────────────

  /** Single delivery point for every emit. Old name kept to avoid churn. */
  emitByKafkaMessage(message: SocketEventPayload) {
    if (!message || !message.event) return;

    if (message.room) {
      try {
        const senderSocket = message.socketId
          ? (this.io.sockets.sockets as any).get(message.socketId)
          : undefined;

        if (senderSocket) {
          senderSocket.to(message.room).emit(message.event, message.payload);
        } else {
          this.io.to(message.room).emit(message.event, message.payload);
        }
      } catch (e) {
        logger.warn('[SocketManager] emit to room failed', e);
      }
      return;
    }

    if (message.socketId) {
      const s = (this.io.sockets.sockets as any).get(message.socketId);
      if (s) {
        try {
          s.emit(message.event, message.payload);
        } catch (e) {
          logger.warn('[SocketManager] emit to socket failed', e);
        }
      }
      return;
    }

    try {
      this.io.emit(message.event, message.payload);
    } catch (e) {
      logger.warn('[SocketManager] broadcast emit failed', e);
    }
  }

  async close() {
    try {
      await this.io.close();
    } catch (e) {
      logger.warn('SocketManager close error', e);
    }
  }
}
