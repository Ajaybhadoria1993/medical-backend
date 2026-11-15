import { Job, Queue, Worker } from 'bullmq';
import { sendEmail } from '../../../utils/email';
import logger from '../../../utils/logger';
import { getAttachmentPort, type EmailAttachmentRef } from '../ports';
import { renderEmailTemplate } from '../templates';
import { queueConnection } from './queueConnection';
import { onJobFailed } from './queueTelemetry';

const QUEUE_NAME = 'email-outbox';
// Finished jobs are kept 30 days, so a replayed event inside that time sends no second email.
const KEEP_SECONDS = 30 * 24 * 60 * 60;

export interface EmailOutboxJob {
  to: string;
  subject: string;
  template: string;
  props: Record<string, unknown>;
  attachments?: EmailAttachmentRef[];
}

/** Renders at send time; a missing file sends the email without it rather than not at all. */
async function deliver(job: EmailOutboxJob) {
  const files = [];
  for (const ref of job.attachments ?? []) {
    try {
      const file = await getAttachmentPort()?.resolve(ref);
      if (file) files.push(file);
    } catch (err) {
      logger.error(
        `[EmailOutbox] attachment ${ref.kind} ${ref.id} unavailable:`,
        err
      );
    }
  }
  const html = renderEmailTemplate(job.template, {
    ...job.props,
    invoiceAttached: files.length > 0,
  });
  await sendEmail(job.to, job.subject, html, files.length ? files : undefined);
}

class EmailOutbox {
  private queue = new Queue<EmailOutboxJob>(QUEUE_NAME, {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: KEEP_SECONDS },
      removeOnFail: { age: KEEP_SECONDS },
    },
  });

  constructor() {
    const worker = new Worker<EmailOutboxJob>(
      QUEUE_NAME,
      (job: Job<EmailOutboxJob>) => deliver(job.data),
      {
        connection: queueConnection,
      }
    );
    worker.on('failed', (job, err) =>
      onJobFailed(QUEUE_NAME)(job, err, () => ` (${job?.data?.template})`)
    );
    worker.on('error', (err) =>
      logger.error(`[EmailOutbox] worker error: ${err.message}`)
    );
  }

  add(data: EmailOutboxJob, jobId?: string) {
    return this.queue.add(data.template, data, jobId ? { jobId } : undefined);
  }
}

let outbox: EmailOutbox | null = null;

/** Created on first use: a Worker opens Redis connections, which importing this module must not do. */
export async function enqueueEmail(
  data: EmailOutboxJob,
  jobId?: string
): Promise<void> {
  outbox ??= new EmailOutbox();
  await outbox.add(data, jobId);
}
