import React from 'react';
import ScheduleBoard from '@/components/schedule/ScheduleBoard';

export default function SchedulePage() {
  return (
    <div className="h-full" data-testid="schedule-page">
      <ScheduleBoard />
    </div>
  );
}
