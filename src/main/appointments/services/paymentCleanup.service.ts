import { Queue, Worker } from 'bullmq';
import { PaymentReservationService } from './paymentReservation.service';

interface PaymentCleanupJobData {
  appointmentId: string;
}

class PaymentCleanupQueue {
  private queue: Queue;
  private worker: Worker;

  constructor() {
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    };

    this.queue = new Queue('appointment-payment-cleanup', { connection });

    this.worker = new Worker(
      'appointment-payment-cleanup',
      this.processJob.bind(this),
      { connection }
    );
  }

  private async processJob(job: { data: PaymentCleanupJobData }) {
    const { appointmentId } = job.data;
    await PaymentReservationService.cleanupExpired(appointmentId);
  }

  async schedulePaymentCleanup(appointmentId: string, delayMs: number) {
    await this.queue.add(
      `payment_cleanup_${appointmentId}`,
      { appointmentId },
      {
        delay: delayMs,
        jobId: `payment_cleanup_${appointmentId}`,
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
  }
}

export const paymentCleanupQueue = new PaymentCleanupQueue();
