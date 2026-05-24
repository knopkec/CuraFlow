import ScheduleBoard from '@/components/schedule/ScheduleBoard';
import PoolShiftsPanel from '@/components/schedule/PoolShiftsPanel';

export default function SchedulePage() {
  return (
    <div className="h-full flex flex-col" data-testid="schedule-page">
      <PoolShiftsPanel />
      <div className="flex-1 min-h-0">
        <ScheduleBoard />
      </div>
    </div>
  );
}
