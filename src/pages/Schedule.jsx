import ScheduleBoard from '@/components/schedule/ScheduleBoard';

export default function SchedulePage() {
  return (
    <div className="h-full flex flex-col" data-testid="schedule-page">
      <div className="flex-1 min-h-0">
        <ScheduleBoard />
      </div>
    </div>
  );
}
