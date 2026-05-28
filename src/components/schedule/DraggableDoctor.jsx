import { Draggable } from '@hello-pangea/dnd';
import { User, Clock } from 'lucide-react';
import { resolveDoctorTargetWeeklyHours } from '@/components/schedule/doctorWorkTime';

export default function DraggableDoctor({ doctor, index, style, isDragDisabled, isBeingDragged, compactLabel, isCompactMode = false, workTimeModel, centralEmployee = null, plannedHours, showTimeAccount = false }) {
  const chipLabel = compactLabel || doctor.initials || doctor.name.substring(0, 3);
  const targetWeekly = resolveDoctorTargetWeeklyHours(doctor, workTimeModel, centralEmployee);
  const planned = plannedHours || 0;
  const pct = targetWeekly ? (planned / targetWeekly) * 100 : null;

  return (
    <Draggable draggableId={`sidebar-doc-${doctor.id}`} index={index} isDragDisabled={isDragDisabled}>
      {(provided, snapshot) => {
        const isDragging = snapshot.isDragging;
        // Show compact version when being dragged (from central state) or snapshot says dragging
        const isCompact = isBeingDragged || isDragging;

        const containerStyle = {
          ...provided.draggableProps.style,
          backgroundColor: isCompact ? 'transparent' : (style?.backgroundColor || '#ffffff'),
          color: isCompact ? undefined : (style?.color || '#000000'),
          border: isCompact ? 'none' : undefined,
          boxShadow: isCompact ? 'none' : undefined,
          zIndex: isDragging ? 9999 : 'auto',
          // When compact (dragging), match grid chip size
          width: isCompact ? '49px' : undefined,
          height: isCompact ? '49px' : undefined,
        };

        const containerClass = isCompact 
          ? 'flex items-center justify-center mb-2'
          : 'flex items-center rounded-md shadow-sm border border-slate-200 hover:opacity-90 transition-colors select-none mb-2';

        return (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...(isCompact ? provided.dragHandleProps : {})}
            data-testid={`schedule-sidebar-doctor-${doctor.id}`}
            className={containerClass}
            style={containerStyle}
          >
            {isCompact ? (
              <div 
                className="flex items-center justify-center rounded-md font-bold border shadow-lg ring-2 ring-indigo-400 w-full h-full"
                style={{
                  backgroundColor: style?.backgroundColor || '#ffffff',
                  color: style?.color || '#000000',
                  fontSize: '14px',
                }}
              >
                <span className="whitespace-nowrap leading-none">{chipLabel}</span>
              </div>
            ) : (
              <>
                <div 
                  {...provided.dragHandleProps}
                  data-testid={`schedule-sidebar-doctor-handle-${doctor.id}`}
                  className={`flex-shrink-0 font-bold text-xs h-full py-2 bg-white/50 rounded-l-md flex items-center justify-center cursor-grab active:cursor-grabbing hover:bg-black/10 transition-colors ${isCompactMode ? 'w-11' : 'w-10'}`}
                  title="Ziehen zum Verschieben"
                >
                  {chipLabel || <User size={12} />}
                </div>
                <div className="flex-1 min-w-0 px-2 py-1.5">
                  <span className="text-sm font-medium truncate block">{doctor.name}</span>
                  {showTimeAccount && targetWeekly !== null && (
                    <div className="flex items-center gap-1 text-[10px] leading-tight mt-0.5">
                      <Clock size={9} className="text-slate-400 flex-shrink-0" />
                      <span className={
                        pct > 100 ? 'text-red-600 font-semibold' :
                        pct >= 80 ? 'text-emerald-600' :
                        'text-slate-400'
                      }>
                        {planned > 0 ? `${planned.toFixed(1)}` : '0'}
                      </span>
                      <span className="text-slate-400">/ {targetWeekly}h</span>
                      {pct > 100 && <span className="text-red-500" title="Überplanung!">⚠</span>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      }}
    </Draggable>
  );
}
