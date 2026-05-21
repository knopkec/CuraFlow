import { describe, expect, it } from 'vitest';

import { buildWishFulfillmentStats } from '../wishFulfillmentUtils';

describe('buildWishFulfillmentStats', () => {
  it('calculates fulfillment from each doctors own shifts across wish ranges', () => {
    const stats = buildWishFulfillmentStats({
      doctors: [
        { id: 'doctor-anna', name: 'Anna Adler', role: 'doctor' },
        { id: 'doctor-bert', name: 'Bert Braun', role: 'doctor' },
      ],
      wishes: [
        {
          id: 'wish-anna-service',
          doctor_id: 'doctor-anna',
          type: 'service',
          start_date: '2026-05-01',
          end_date: '2026-05-03',
          status: 'approved',
        },
        {
          id: 'wish-anna-free',
          doctor_id: 'doctor-anna',
          type: 'free',
          date: '2026-05-04',
          status: 'rejected',
        },
        {
          id: 'wish-bert-service',
          doctor_id: 'doctor-bert',
          type: 'service',
          date: '2026-05-02',
          status: 'approved',
        },
      ],
      shifts: [
        {
          id: 'shift-anna-service',
          doctor_id: 'doctor-anna',
          date: '2026-05-02',
          position: 'Dienst Vordergrund',
        },
        {
          id: 'shift-anna-rotation',
          doctor_id: 'doctor-anna',
          date: '2026-05-04',
          position: 'Sono Rotation',
        },
        {
          id: 'shift-bert-other',
          doctor_id: 'doctor-bert',
          date: '2026-05-02',
          position: 'Sono Rotation',
        },
        {
          id: 'shift-unrelated',
          doctor_id: 'doctor-other',
          date: '2026-05-02',
          position: 'Dienst Hintergrund',
        },
      ],
    });

    expect(stats).toEqual([
      {
        name: 'Anna Adler',
        role: 'doctor',
        total: 2,
        fulfilled: 2,
        rate: 100,
        approved: 1,
        rejected: 1,
      },
      {
        name: 'Bert Braun',
        role: 'doctor',
        total: 1,
        fulfilled: 0,
        rate: 0,
        approved: 1,
        rejected: 0,
      },
    ]);
  });
});
