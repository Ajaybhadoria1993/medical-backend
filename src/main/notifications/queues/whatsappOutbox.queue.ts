import axios from 'axios';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import logger from '../../../utils/logger';
import { sendWhatsAppTemplate } from '../../../utils/smsClient';
import { WhatsAppTemplateMessage } from '../types/whatsappTemplate.types';
import { queueConnection } from './queueConnection';
import { onJobFailed } from './queueTelemetry';

const QUEUE_NAME = 'whatsapp-outbox';

interface WhatsAppOutboxJob {
  to: string;
  message: WhatsAppTemplateMessage;
  appointmentId?: string;
}

/**
 * Meta error codes that will never succeed on retry — a missing template, a
 * placeholder-count mismatch, an unregistered number, an expired token or an
 * unreachable handset. Retrying these just burns attempts and delays the log.
 * Everything else (429, 5xx, socket errors) is treated as transient.
 */
const PERMANENT_META_CODES = new Set([
  100, // unsupported parameter
  190, // token expired / invalid
  131026, // message undeliverable — recipient not on WhatsApp
  132000, // parameter count mismatch / bad param format
  132001, // template does not exist in this language
  132005, // template param text too long
  132012, // param format mismatch
  133010, // phone number not registered on Cloud API
]);

function metaErrorCode(err: unknown): number | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  return (err.response?.data as { error?: { code?: number } })?.error?.code;
}

function describe(err: unknown): string {
  if (!axios.isAxiosError(err)) return (err as Error).message;
  if (err.response) return JSON.stringify(err.response.data);
  return `${err.code ?? 'network error'}: ${err.message}`;
}

class WhatsAppOutbox {
  private queue: Queue<WhatsAppOutboxJob>;
  private worker: Worker<WhatsAppOutboxJob>;

  constructor() {
    this.queue = new Queue<WhatsAppOutboxJob>(QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        // Bound Redis growth: keep enough history to investigate, not forever.
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 1000 },
      },
    });

    this.worker = new Worker<WhatsAppOutboxJob>(
      QUEUE_NAME,
      async (job) => this.process(job),
      {
        connection: queueConnection,
        /*
         * Lower than the notification queue, and rate-limited on top: every job
         * is an outbound call to Meta, which throttles per number. Draining a
         * backlog as fast as the worker can go earns a 429 and turns a delay
         * into a failure.
         */
        concurrency: 3,
        limiter: { max: 20, duration: 1000 },
      }
    );

    this.worker.on('failed', (job, err) =>
      onJobFailed(QUEUE_NAME)(job, err, () => {
        const key = job?.data?.message?.key;
        const appt = job?.data?.appointmentId;
        return `${key ? ` (${key})` : ''}${appt ? ` for appointment ${appt}` : ''}`;
      })
    );

    this.worker.on('error', (err) => {
      logger.error(`WhatsApp outbox worker error: ${err.message}`);
    });
  }

  private async process(job: Job<WhatsAppOutboxJob>): Promise<void> {
    const { to, message } = job.data;

    try {
      // The key/params pairing is guaranteed by WhatsAppTemplateMessage;
      // TypeScript can't correlate the two across a generic call.
      await sendWhatsAppTemplate(to, message.key, message.params as never);
    } catch (err) {
      const code = metaErrorCode(err);
      if (code !== undefined && PERMANENT_META_CODES.has(code)) {
        throw new UnrecoverableError(
          `Meta rejected "${message.key}" permanently (code ${code}): ${describe(err)}`
        );
      }
      throw new Error(`Transient WhatsApp failure: ${describe(err)}`);
    }
  }

  async enqueue(job: WhatsAppOutboxJob, jobId?: string): Promise<void> {
    await this.queue.add(job.message.key, job, jobId ? { jobId } : undefined);
  }
}

export const whatsAppOutbox = new WhatsAppOutbox();

/**
 * Hand a template message to the outbox. Returns as soon as the job is queued,
 * so callers never wait on Meta — and unlike a bare fire-and-forget send, a
 * transient failure is retried instead of being logged and lost.
 */
export async function enqueueWhatsAppTemplate(
  to: string,
  message: WhatsAppTemplateMessage,
  appointmentId?: string,
  /** Makes a re-enqueue a no-op — a retried registry dispatch must not resend. */
  jobId?: string
): Promise<void> {
  try {
    await whatsAppOutbox.enqueue({ to, message, appointmentId }, jobId);
  } catch (err) {
    // Redis unavailable: log rather than break the calling operation, matching
    // how every other notification failure is handled.
    logger.error(
      `Failed to queue WhatsApp "${message.key}"${
        appointmentId ? ` for appointment ${appointmentId}` : ''
      }: ${(err as Error).message}`
    );
  }
}
