/**
 * Unit tests for TimeToNextService.computeAndBroadcast (broadcast throttling)
 *
 * Validates: Requirements 4.6
 *
 * Tests the throttling logic that:
 * - Only emits WebSocket events when the time-to-next value changes by ≥ 1 minute
 * - Stores last broadcast value in Redis with 1h TTL
 * - Handles Redis failures gracefully (broadcasts anyway)
 */

import redisClient from '../../../configurations/redisConfig';

// Mock the app module (socketManager)
jest.mock('../../../app', () => ({
  socketManager: {
    io: {
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    },
  },
}));

// Mock the DelayTrackerService
jest.mock('../services/delayTracker.service', () => ({
  DelayTrackerService: jest.fn().mockImplementation(() => ({
    getQueueDelayData: jest.fn(),
    recalculate: jest.fn(),
  })),
}));

import { TimeToNextService } from '../services/timeToNext.service';
import { DelayTrackerService } from '../services/delayTracker.service';

const mockRedisGet = redisClient.get as jest.Mock;
const mockRedisSet = redisClient.set as jest.Mock;
const mockRedisDel = redisClient.del as jest.Mock;

describe('TimeToNextService - computeAndBroadcast (broadcast throttling)', () => {
  let service: TimeToNextService;
  let mockSocketEmit: jest.Mock;
  let mockSocketTo: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new TimeToNextService();

    // Access the mocked socketManager
    const { socketManager } = require('../../../app');
    mockSocketTo = socketManager.io.to;
    mockSocketEmit = mockSocketTo().emit;

    // Default: recalculate returns a queue with one upcoming appointment
    const mockDelayTracker = (DelayTrackerService as jest.Mock).mock.results[0]
      ?.value;
    if (mockDelayTracker) {
      mockDelayTracker.getQueueDelayData.mockResolvedValue({
        clinicId: 'clinic1',
        doctorId: 'doctor1',
        date: '2025-01-15',
        cumulativeDelayMinutes: 5,
        appointments: [
          {
            appointmentId: 'apt1',
            patientId: 'patient1',
            userId: 'user1',
            status: 'Upcoming',
            scheduledTime: '10:00',
            tokenNo: null,
            projectedStartTime: '10:05',
            estimatedWaitMinutes: 5,
            durationMinutes: 15,
          },
        ],
      });
    }
  });

  it('should broadcast when no previous value exists in Redis (first broadcast)', async () => {
    // No previous broadcast stored
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');

    // Mock compute to return a known value
    jest.spyOn(service, 'compute').mockResolvedValue(15);

    await service.computeAndBroadcast('clinic1', 'doctor1', '2025-01-15');

    // Should broadcast
    expect(mockSocketTo).toHaveBeenCalledWith('clinic:clinic1');
    expect(mockSocketEmit).toHaveBeenCalledWith(
      'timeToNext.updated',
      expect.objectContaining({
        clinicId: 'clinic1',
        timeToNextMinutes: 15,
      })
    );

    // Should store value in Redis with 1h TTL (3600 seconds)
    expect(mockRedisSet).toHaveBeenCalledWith(
      'appointment_engine:time_to_next:clinic1:doctor1',
      '15',
      'EX',
      3600
    );
  });

  it('should NOT broadcast when new value differs by less than 1 minute', async () => {
    // Last broadcast was 15 minutes
    mockRedisGet.mockResolvedValue('15');

    // Compute returns 15 (same value — no change)
    jest.spyOn(service, 'compute').mockResolvedValue(15);

    await service.computeAndBroadcast('clinic1', 'doctor1', '2025-01-15');

    // Should NOT emit
    expect(mockSocketEmit).not.toHaveBeenCalled();
    // Should NOT update Redis
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('should broadcast when difference is exactly 1 minute', async () => {
    // Last broadcast was 10 minutes
    mockRedisGet.mockResolvedValue('10');
    mockRedisSet.mockResolvedValue('OK');

    // Compute returns 11 (diff = 1)
    jest.spyOn(service, 'compute').mockResolvedValue(11);

    await service.computeAndBroadcast('clinic1', 'doctor1', '2025-01-15');

    // Should broadcast (diff >= 1)
    expect(mockSocketEmit).toHaveBeenCalledWith(
      'timeToNext.updated',
      expect.objectContaining({
        clinicId: 'clinic1',
        timeToNextMinutes: 11,
      })
    );
    expect(mockRedisSet).toHaveBeenCalledWith(
      'appointment_engine:time_to_next:clinic1:doctor1',
      '11',
      'EX',
      3600
    );
  });

  it('should broadcast when value changes significantly (≥ 1 minute difference)', async () => {
    // Last broadcast was 20 minutes
    mockRedisGet.mockResolvedValue('20');
    mockRedisSet.mockResolvedValue('OK');

    // Compute returns 15 (diff = 5, which is ≥ 1)
    jest.spyOn(service, 'compute').mockResolvedValue(15);

    await service.computeAndBroadcast('clinic1', 'doctor1', '2025-01-15');

    // Should broadcast
    expect(mockSocketEmit).toHaveBeenCalledWith(
      'timeToNext.updated',
      expect.objectContaining({
        timeToNextMinutes: 15,
      })
    );
  });

  it('should broadcast null and delete Redis key when no further appointments', async () => {
    // Last broadcast was 5 minutes
    mockRedisGet.mockResolvedValue('5');
    mockRedisDel.mockResolvedValue(1);

    // Compute returns null (no more appointments)
    jest.spyOn(service, 'compute').mockResolvedValue(null);

    await service.computeAndBroadcast('clinic1', 'doctor1', '2025-01-15');

    // Should broadcast null
    expect(mockSocketEmit).toHaveBeenCalledWith(
      'timeToNext.updated',
      expect.objectContaining({
        clinicId: 'clinic1',
        timeToNextMinutes: null,
      })
    );
    // Should delete the Redis key (not set)
    expect(mockRedisDel).toHaveBeenCalledWith(
      'appointment_engine:time_to_next:clinic1:doctor1'
    );
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('should NOT broadcast when compute returns null and no previous broadcast exists', async () => {
    // No previous broadcast
    mockRedisGet.mockResolvedValue(null);

    // Compute returns null
    jest.spyOn(service, 'compute').mockResolvedValue(null);

    await service.computeAndBroadcast('clinic1', 'doctor1', '2025-01-15');

    // Should NOT broadcast (null with no prior value is a no-op)
    expect(mockSocketEmit).not.toHaveBeenCalled();
  });

  it('should still broadcast on Redis failure (graceful degradation)', async () => {
    // Redis fails
    mockRedisGet.mockRejectedValue(new Error('Redis connection lost'));

    jest.spyOn(service, 'compute').mockResolvedValue(10);

    await service.computeAndBroadcast('clinic1', 'doctor1', '2025-01-15');

    // Should still emit (fallback behavior)
    expect(mockSocketEmit).toHaveBeenCalledWith(
      'timeToNext.updated',
      expect.objectContaining({
        timeToNextMinutes: 10,
      })
    );
  });

  it('should return the computed value regardless of broadcast decision', async () => {
    mockRedisGet.mockResolvedValue('10');
    jest.spyOn(service, 'compute').mockResolvedValue(10);

    const result = await service.computeAndBroadcast(
      'clinic1',
      'doctor1',
      '2025-01-15'
    );

    // Should return the computed value even when not broadcasting
    expect(result).toBe(10);
  });

  it('should use correct Redis key format with clinicId and doctorId', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    jest.spyOn(service, 'compute').mockResolvedValue(7);

    await service.computeAndBroadcast('clinic-abc', 'doctor-xyz', '2025-01-15');

    expect(mockRedisGet).toHaveBeenCalledWith(
      'appointment_engine:time_to_next:clinic-abc:doctor-xyz'
    );
    expect(mockRedisSet).toHaveBeenCalledWith(
      'appointment_engine:time_to_next:clinic-abc:doctor-xyz',
      '7',
      'EX',
      3600
    );
  });
});
