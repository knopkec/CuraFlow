import React from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const getDoctorShortLabel = (doctor) => doctor?.initials || doctor?.name?.substring(0, 3) || '';

// Format TIME value (HH:MM:SS or HH:MM) to compact display (H:MM or HH:MM)
const formatShiftTime = (timeStr) => {
  if (!timeStr) return null;
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, '0')}`;
};

const getTimeLabel = (shift) => {
  const start = formatShiftTime(shift.start_time);
  const end = formatShiftTime(shift.end_time);
  if (!start || !end) return null;
  return `${start}–${end}`;
};

function LateStartIndicator({ tooltip, compact = false }) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={compact
              ? 'absolute -top-1 -left-1 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/80 text-[10px] leading-none text-white cursor-help'
              : 'inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-900/80 text-xs leading-none text-white cursor-help'}
            aria-label={tooltip}
          >
            🌙
          </span>
        </TooltipTrigger>
        <TooltipContent side={compact ? 'top' : 'bottom'}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function DraggableShift({ shift, doctor, index, onRemove: _onRemove, displayMode = 'compact', compactLabel = null, isDragDisabled, fontSize = 14, boxSize = 48, currentUserDoctorId, highlightMyName = true, isBeingDragged = false, qualificationStatus = null, fairnessInfo = null, wishMarker = null, draggableIdPrefix = '', timeslotLabel = null, timeslotLabelTone = 'default', timeLabelOverride = null, showLateStartIndicator = false, lateStartTooltip = 'Später Dienst mit Rotationsmöglichkeit', ...props }) {
  const isPreview = shift.isPreview;
  const isCurrentUser = currentUserDoctorId && doctor.id === currentUserDoctorId;
  const isFullWidth = displayMode === 'full';
  const chipLabel = compactLabel || getDoctorShortLabel(doctor);
  const displayText = isFullWidth ? doctor.name : chipLabel;
  const displayFontSize = fontSize;
  const timeLabel = timeLabelOverride || getTimeLabel(shift);
  const timeslotBadgeClasses = timeslotLabelTone === 'warning'
    ? 'bg-amber-300 text-amber-950'
    : 'bg-indigo-600 text-white';

  // Build fairness tooltip text for preview service shifts
  const fairnessTooltip = React.useMemo(() => {
    if (!fairnessInfo) return null;
    const lines = [`Dienste (4 Wo. + Vorschläge): ${fairnessInfo.total}`];
    if (fairnessInfo.fg > 0 || fairnessInfo.bg > 0) {
      lines.push(`  VG: ${fairnessInfo.fg} | HG: ${fairnessInfo.bg}`);
    }
    lines.push(`Wochenende: ${fairnessInfo.weekend}`);
    if (fairnessInfo.wishText) {
      lines.push(fairnessInfo.wishText);
    }
    return lines.join('\n');
  }, [fairnessInfo]);

  const combinedTooltip = [fairnessTooltip, wishMarker?.title].filter(Boolean).join('\n');
  
  // Qualification warning/error indicator
  const QualWarning = qualificationStatus === 'excluded' ? (
    <div 
      data-testid={`schedule-shift-qualification-warning-${shift.id}`}
      className="absolute -top-0.5 -right-0.5 z-20 text-red-600"
      style={{ fontSize: Math.max(fontSize * 0.7, 8) }}
      title="NOT-Qualifikation: Arzt darf hier nicht eingeteilt werden!"
    >
      ⊘
    </div>
  ) : qualificationStatus === 'unqualified' ? (
    <div 
      data-testid={`schedule-shift-qualification-warning-${shift.id}`}
      className="absolute -top-0.5 -right-0.5 z-20 text-amber-600"
      style={{ fontSize: Math.max(fontSize * 0.7, 8) }}
      title="Fehlende Pflicht-Qualifikation (Override)"
    >
      ⚠
    </div>
  ) : null;

  const wishMarkerColor = wishMarker?.color === 'green' ? '#22c55e' : '#ef4444';

  const dynamicStyle = {
      fontSize: `${fontSize}px`,
      ...(isFullWidth 
          ? { width: '100%', height: '100%', minHeight: `${boxSize * 0.8}px` } 
          : { width: `${boxSize}px`, height: `${boxSize}px` }
      )
  };

  // When isBeingDragged (from central state) - compact dimensions for correct measurement
  // This runs BEFORE react-beautiful-dnd measures the element
  if (isBeingDragged) {
    return (
      <Draggable draggableId={`${draggableIdPrefix}shift-${shift.id}`} index={index} isDragDisabled={isDragDisabled}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className="flex items-center justify-center"
            style={{
              ...provided.draggableProps.style,
              backgroundColor: 'transparent',
              border: 'none',
              boxShadow: 'none',
              width: `${boxSize}px`,
              height: `${boxSize}px`,
              zIndex: 9999,
            }}
          >
            <div 
              className="flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400"
              style={{
                backgroundColor: props.style?.backgroundColor || '#f1f5f9',
                color: props.style?.color || '#0f172a',
                width: `${boxSize}px`,
                height: `${boxSize}px`,
                fontSize: `${fontSize}px`,
              }}
            >
              <span className="whitespace-nowrap leading-none">{chipLabel}</span>
            </div>
          </div>
        )}
      </Draggable>
    );
  }

  return (
    <Draggable draggableId={`${draggableIdPrefix}shift-${shift.id}`} index={index} isDragDisabled={isDragDisabled}>
      {(provided, snapshot) => {
        // When dragging, use compact dimensions to fix cursor offset issue.
        // The drag clone should be small so its center aligns with cursor.

        const isDragging = snapshot.isDragging;

        // Style for the outer container (the "Ghost")
        // If dragging: compact size for better cursor alignment
        // If not dragging: use dynamicStyle and normal colors
        const containerStyle = isDragging ? {
             ...provided.draggableProps.style,
             backgroundColor: 'transparent',
             border: 'none',
             boxShadow: 'none',
             zIndex: 9999,
             cursor: 'none',
             width: `${boxSize}px`,
             height: `${boxSize}px`,
        } : {
             ...provided.draggableProps.style,
             ...dynamicStyle, // Apply normal layout dimensions
             backgroundColor: props.style?.backgroundColor || '#f1f5f9',
             backgroundImage: wishMarker ? `linear-gradient(135deg, ${wishMarkerColor} 0, ${wishMarkerColor} 50%, transparent 50%, transparent 100%)` : undefined,
             backgroundRepeat: 'no-repeat',
             backgroundSize: wishMarker ? '14px 14px' : undefined,
             backgroundPosition: wishMarker ? 'top left' : undefined,
             color: props.style?.color || '#0f172a',
             zIndex: 'auto'
        };

        const containerClass = isDragging 
            ? `flex items-center justify-center cursor-none` // Center the badge
          : `relative flex items-center ${isFullWidth ? 'justify-start overflow-hidden' : 'justify-center'} rounded-md font-bold border shadow-sm transition-colors ${isPreview ? 'opacity-50 border-dashed border-indigo-400 cursor-grab hover:opacity-80 hover:border-indigo-600' : ''} ${!isDragging && isCurrentUser && highlightMyName ? 'ring-2 ring-red-500 ring-offset-1 z-10' : ''} ${isFullWidth ? '' : 'cursor-grab active:cursor-grabbing'}`;

        return (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...(isFullWidth ? {} : provided.dragHandleProps)}
            data-testid={`schedule-shift-${shift.id}`}
            className={containerClass}
            style={containerStyle}
            title={combinedTooltip || (isPreview ? 'Vorschlag — per Drag & Drop verschieben' : undefined)}
          >
            {isDragging ? (
                // The visual badge - square like small chips
                <div className={`
                  relative flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400 z-[9999]
                `}
                style={{
                    backgroundColor: props.style?.backgroundColor || '#f1f5f9',
                    color: props.style?.color || '#0f172a',
                    width: `${boxSize}px`,
                    height: `${boxSize}px`,
                    fontSize: `${fontSize}px`,
                }}
                >
                  <span className="whitespace-nowrap leading-none">
                   {chipLabel}
                    </span>
                    {showLateStartIndicator && <LateStartIndicator tooltip={lateStartTooltip} compact />}
                </div>
            ) : isFullWidth ? (
                <>
                    {QualWarning}
                    <div 
                        {...provided.dragHandleProps}
                        className="flex-shrink-0 font-bold flex items-center justify-center cursor-grab active:cursor-grabbing rounded-l-md h-full bg-white/50 hover:bg-black/10 transition-colors"
                        style={{ width: `${boxSize}px`, fontSize: `${fontSize}px` }}
                        title={combinedTooltip || "Ziehen zum Verschieben"}
                    >
                      {chipLabel}
                    </div>
                    <span 
                      className="block min-w-0 basis-0 flex-1 truncate px-1 leading-tight text-center" 
                        style={{ fontSize: `${displayFontSize}px` }}
                    >
                        {displayText}
                    </span>
                    {showLateStartIndicator && <LateStartIndicator tooltip={lateStartTooltip} />}
                    {timeslotLabel && (
                      <span
                        className={`flex-shrink-0 rounded px-1 font-semibold mr-1 whitespace-nowrap ${timeslotBadgeClasses}`}
                        style={{ fontSize: `${Math.max(fontSize * 0.72, 9)}px`, lineHeight: '1.4', maxWidth: `${boxSize * 1.7}px`, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={timeslotLabel}
                      >
                        {timeslotLabel}
                      </span>
                    )}
                    {timeLabel && (
                        <span
                            className="flex-shrink-0 text-slate-500 font-normal mr-1 whitespace-nowrap"
                            style={{ fontSize: `${Math.max(fontSize * 0.65, 8)}px`, lineHeight: '1.4' }}
                        >
                            {timeLabel}
                        </span>
                    )}
                    {fairnessInfo && (
                        <span
                            className="flex-shrink-0 rounded px-1 text-white font-semibold mr-1"
                            style={{ fontSize: `${Math.max(fontSize * 0.65, 8)}px`, backgroundColor: fairnessInfo.total >= 4 ? '#ef4444' : fairnessInfo.total >= 2 ? '#f59e0b' : '#22c55e', lineHeight: '1.4' }}
                            title={fairnessTooltip}
                        >
                            {fairnessInfo.total}D{fairnessInfo.weekend > 0 ? ` ${fairnessInfo.weekend}W` : ''}{fairnessInfo.wishText ? ' ★' : ''}
                        </span>
                    )}
                </>
            ) : (
                <div className="absolute inset-0 rounded-md bg-white/50 hover:bg-black/10 transition-colors z-0" />
            )}
            {!isDragging && !isFullWidth && (
                <>
                {QualWarning}
                <div className="flex flex-col items-center justify-center w-full relative z-10">
                  <span 
                    className="px-0.5 leading-none text-center whitespace-nowrap" 
                      style={{ fontSize: `${displayFontSize}px` }}
                  >
                      {displayText}
                  </span>
                  {timeLabel && (
                    <span 
                      className="leading-none text-center whitespace-nowrap opacity-60"
                      style={{ fontSize: `${Math.max(displayFontSize * 0.55, 7)}px`, marginTop: '1px' }}
                    >
                      {timeLabel}
                    </span>
                  )}
                </div>
                {showLateStartIndicator && <LateStartIndicator tooltip={lateStartTooltip} compact />}
                {fairnessInfo && (
                    <div
                        className="absolute -bottom-1 -right-1 z-20 rounded-full px-1 text-white font-bold leading-none"
                        style={{ fontSize: `${Math.max(fontSize * 0.55, 7)}px`, backgroundColor: fairnessInfo.total >= 4 ? '#ef4444' : fairnessInfo.total >= 2 ? '#f59e0b' : '#22c55e', padding: '1px 3px' }}
                        title={fairnessTooltip}
                    >
                        {fairnessInfo.total}
                    </div>
                )}
                {timeslotLabel && (
                    <div
                    className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-20 rounded px-1 font-semibold leading-none whitespace-nowrap ${timeslotBadgeClasses}`}
                    style={{ fontSize: `${Math.max(fontSize * 0.62, 8)}px`, padding: '1px 4px', maxWidth: `${boxSize + 12}px`, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={timeslotLabel}
                    >
                        {timeslotLabel}
                    </div>
                )}
                </>
            )}
          </div>
        );
      }}
    </Draggable>
  );
}
