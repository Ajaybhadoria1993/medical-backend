import { Queue, Worker } from 'bullmq';
import { queueConnection } from '../../notifications/queues/queueConnection';
import { PaymentReservationService } from './paymentReservation.service';

interface PaymentCleanupJobData {
  appointmentId: string;
}

class PaymentCleanupQueue {
  private queue: Queue;
  private worker: Worker;

  constructor() {
    this.queue = new Queue('appointment-payment-cleanup', {
      connection: queueConnection,
    });

    this.worker = new Worker(
      'appointment-payment-cleanup',
      this.processJob.bind(this),
      { connection: queueConnection }
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
