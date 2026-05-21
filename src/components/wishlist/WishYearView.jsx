import { useEffect, useMemo, useState } from 'react';
import { format, startOfYear, endOfYear, eachMonthOfInterval, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isWeekend, parseISO, isAfter, addDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from "@/lib/utils";
import { isWishOnDate, hasWishRange, getWishStartDate, getWishEndDate } from '@/utils/wishRange';
import { isDateWithinContract } from '@/components/training/trainingContractUtils';

export default function WishYearView({ doctor, year, wishes, shifts, contractInfo, occupiedWishDates, onToggle, onRangeSelect, minSelectableDate, activeType, isSchoolHoliday, isPublicHoliday }) {
  // Wunschmarkierung ist immer ausgeschaltet
  const showOccupiedDates = false;
  const months = eachMonthOfInterval({
    start: startOfYear(new Date(year, 0, 1)),
    end: endOfYear(new Date(year, 0, 1))
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStartDate, setDragStartDate] = useState(null);
  const [dragCurrentDate, setDragCurrentDate] = useState(null);

  const dragSelectedDateKeys = useMemo(() => {
    if (!dragStartDate || !dragCurrentDate) return new Set();

    let start = parseISO(format(dragStartDate, 'yyyy-MM-dd'));
    let end = parseISO(format(dragCurrentDate, 'yyyy-MM-dd'));
    if (!start || !end) return new Set();

    if (isAfter(start, end)) {
      const temp = start;
      start = end;
      end = temp;
    }

    const keys = new Set();
    let cursor = start;
    while (!isAfter(cursor, end)) {
      keys.add(format(cursor, 'yyyy-MM-dd'));
      cursor = addDays(cursor, 1);
    }
    return keys;
  }, [dragStartDate, dragCurrentDate]);

  const finishDragSelection = () => {
    if (!isDragging || !dragStartDate || !dragCurrentDate) return;

    let start = parseISO(format(dragStartDate, 'yyyy-MM-dd'));
    let end = parseISO(format(dragCurrentDate, 'yyyy-MM-dd'));

    if (isAfter(start, end)) {
      const temp = start;
      start = end;
      end = temp;
    }

    if (onRangeSelect) {
      onRangeSelect(start, end);
    } else if (onToggle) {
      onToggle(start);
    }

    setIsDragging(false);
    setDragStartDate(null);
    setDragCurrentDate(null);
  };

  useEffect(() => {
    const handleWindowMouseUp = () => {
      finishDragSelection();
    };

    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  });

  const handleDayMouseDown = (date, event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setIsDragging(true);
    setDragStartDate(date);
    setDragCurrentDate(date);
  };

  const handleDayMouseEnter = (date) => {
    if (!isDragging) return;
    setDragCurrentDate(date);
  };

  const handleDayMouseUp = () => {
    finishDragSelection();
  };

  const getDayStatus = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    
    // 1. Check Absences (ShiftEntry)
    const absencePositions = ["Urlaub", "Frei", "Krank", "Dienstreise", "Nicht verfügbar"];
    const shift = shifts.find(s => s.date === dateStr && absencePositions.includes(s.position));
    if (shift) return { type: 'absence', label: shift.position };

    // 2. Check Wishes
    const wish = wishes.find(w => isWishOnDate(w, dateStr));
    if (wish) return { type: 'wish', label: wish.type, data: wish };

    return null;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow-sm ${doctor.color || "bg-slate-100"}`}>
              {doctor.initials}
          </div>
          <div>
              <h2 className="text-xl font-bold text-slate-900">{doctor.name}</h2>
              <p className="text-slate-500">{doctor.role} • Wunschkiste {year}</p>
              {contractInfo && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-slate-500">Vertrag: {contractInfo.contractRangeLabel}</span>
                  <span className={contractInfo.remainingTone}>{contractInfo.remainingLabel}</span>
                </div>
              )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {months.map(month => (
          <MonthCalendar 
            key={month.toString()} 
            month={month} 
            getDayStatus={getDayStatus}
            occupiedWishDates={occupiedWishDates}
            onDateClick={onToggle}
            onDayMouseDown={handleDayMouseDown}
            onDayMouseEnter={handleDayMouseEnter}
            onDayMouseUp={handleDayMouseUp}
            dragSelectedDateKeys={dragSelectedDateKeys}
            minSelectableDate={minSelectableDate}
            contractInfo={contractInfo}
            isSchoolHoliday={isSchoolHoliday}
            isPublicHoliday={isPublicHoliday}
            showOccupiedDates={showOccupiedDates}
          />
        ))}
      </div>
    </div>
  );
}

function MonthCalendar({ month, getDayStatus, occupiedWishDates, onDateClick, onDayMouseDown, onDayMouseEnter, onDayMouseUp, dragSelectedDateKeys, minSelectableDate, contractInfo, isSchoolHoliday: checkSchoolHoliday, isPublicHoliday: checkPublicHoliday, showOccupiedDates }) {
  const days = eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(month)
  });

  const startDay = getDay(startOfMonth(month));
  const emptyDays = (startDay + 6) % 7;

  return (
    <div className="border rounded-md p-3">
      <div className="font-bold text-center mb-2 text-slate-700 capitalize">
        {format(month, 'MMMM', { locale: de })}
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs mb-1">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
          <div key={d} className="text-center text-slate-400 font-medium">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-sm">
        {Array(emptyDays).fill(null).map((_, i) => <div key={`empty-${i}`} />)}
        {days.map(date => {
          const status = getDayStatus(date);
          const isWeekendDay = isWeekend(date);
          const isHoliday = checkPublicHoliday ? checkPublicHoliday(date) : false;
          const isSchoolHoliday = checkSchoolHoliday ? checkSchoolHoliday(date) : false;
          
          let colorClass = "";
          let content = format(date, 'd');
          let title = isHoliday ? 'Feiertag' : isSchoolHoliday ? 'Ferien' : '';
          let style = {};

          // Green border if ANYONE has a wish here (only if enabled)
          const dateStr = format(date, 'yyyy-MM-dd');
          const minSelectableDateStr = minSelectableDate ? format(minSelectableDate, 'yyyy-MM-dd') : null;
          const isBeforeDeadline = !!minSelectableDateStr && dateStr < minSelectableDateStr;
          const isBoundaryDate = !!minSelectableDateStr && dateStr === minSelectableDateStr;
          const isContractDisabled = !isDateWithinContract(date, contractInfo?.contractStart, contractInfo?.contractEnd);
          const isContractEnd = Boolean(contractInfo?.contractEnd) && dateStr === contractInfo.contractEnd;
          const isOccupied = showOccupiedDates && occupiedWishDates && occupiedWishDates.has(dateStr);
          const borderClass = isOccupied ? "ring-2 ring-emerald-400/60 z-10" : "";
          const isDragSelected = dragSelectedDateKeys?.has(dateStr);
          
          // Find the actual wish object if status is 'wish'
          // We need to pass the wish object in getDayStatus to access priority/status
          // But getDayStatus currently returns { type, label }. 
          // Let's modify getDayStatus in parent or fetch it here if passed.
          // Actually, status currently comes from parent getDayStatus. 
          // We need to update getDayStatus signature in parent WishList.js (wait, it's in WishYearView.js)
          
          // Wait, `getDayStatus` is defined inside `WishYearView` component in the same file.
          // I need to update `getDayStatus` in `WishYearView` to return the full wish object.
          
            if (isContractDisabled) {
              colorClass = "text-slate-300 cursor-not-allowed";
              style = {
                backgroundColor: '#f8fafc',
                backgroundImage: 'repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.22) 0, rgba(148, 163, 184, 0.22) 4px, transparent 4px, transparent 10px)'
              };
              title = 'Außerhalb der Vertragslaufzeit';
            } else if (status) {
              if (status.type === 'absence') {
                  colorClass = "bg-slate-100 text-slate-400 cursor-not-allowed"; 
                  title = `${status.label} (Abwesenheit)`;
              } else if (status.type === 'wish') {
                  const wish = status.data; // Needs update in getDayStatus
                  const isApproved = wish?.status === 'approved';
                  const isRejected = wish?.status === 'rejected';
                  const isPending = wish?.status === 'pending' || !wish?.status;
                  
                  let baseColor = "";
                  let ringColor = "";

                  if (status.label === 'service') {
                      baseColor = isRejected ? "bg-green-50 text-green-300" : "bg-green-100 text-green-700";
                      ringColor = "ring-green-600";
                      title = `Dienstwunsch (${wish?.priority || 'mittel'})`;
                  } else {
                      baseColor = isRejected ? "bg-red-50 text-red-300" : "bg-red-100 text-red-700";
                      ringColor = "ring-red-600";
                      title = `Kein Dienst (${wish?.priority || 'mittel'})`;
                  }

                  if (isRejected) {
                      colorClass = `${baseColor} ring-1 ring-slate-200 relative overflow-hidden`;
                      // Strikethrough effect via CSS or class
                      title += " - Abgelehnt";
                  } else if (isApproved) {
                      colorClass = `${baseColor} ring-2 ${ringColor} font-extrabold hover:brightness-95`;
                      title += " - Genehmigt";
                  } else {
                      // Pending
                      colorClass = `${baseColor} ring-1 ${ringColor} border-dashed border-2 border-white hover:brightness-95`;
                      title += " - Ausstehend";
                  }
                  
                  if (wish?.reason) title += `\nGrund: ${wish.reason}`;
                    if (hasWishRange(wish)) title += `\nZeitraum: ${getWishStartDate(wish)} bis ${getWishEndDate(wish)}`;
                  if (wish?.admin_comment) title += `\nAdmin: ${wish.admin_comment}`;
              }
          } else {
              // Base colors
              if (isHoliday) {
                  colorClass = "text-blue-900 hover:bg-blue-100";
                  style = { 
                      backgroundColor: '#eff6ff', // blue-50
                      backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(59, 130, 246, 0.1) 5px, rgba(59, 130, 246, 0.1) 10px)'
                  };
              } else if (isSchoolHoliday) {
                  colorClass = "text-green-900 hover:bg-green-100";
                  style = { 
                      backgroundColor: '#f0fdf4', // green-50
                      backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(34, 197, 94, 0.1) 5px, rgba(34, 197, 94, 0.1) 10px)'
                  };
              } else if (isWeekendDay) {
                  colorClass = "bg-slate-50 text-slate-400 hover:bg-slate-100";
              } else {
                  colorClass = "hover:bg-slate-100 text-slate-700";
              }
          }

          const finalStyle = {
              ...style,
              ...(status ? {} : (isOccupied ? { boxShadow: "inset 0 0 0 2px #34d399" } : {}))
          };

          return (
            <button
              key={date.toString()}
              data-testid={`wishlist-day-${dateStr}`}
              onMouseDown={(e) => !isBeforeDeadline && !isContractDisabled && onDayMouseDown?.(date, e)}
              onMouseEnter={() => !isBeforeDeadline && !isContractDisabled && onDayMouseEnter?.(date)}
              onMouseUp={() => onDayMouseUp?.()}
              onDragStart={(e) => e.preventDefault()}
              className={cn(
                "aspect-square flex items-center justify-center rounded-sm transition-colors text-xs sm:text-sm select-none relative",
                colorClass,
                !status && borderClass,
                isDragSelected && !isContractDisabled && "ring-2 ring-indigo-500 bg-indigo-100 text-indigo-900",
                isBeforeDeadline && "opacity-35 cursor-not-allowed hover:bg-transparent",
                isBoundaryDate && "ring-2 ring-cyan-500"
              )}
              style={finalStyle}
              title={
                (isBeforeDeadline ? `Gesperrt bis ${minSelectableDateStr}. ` : '') +
                (isContractDisabled ? 'Außerhalb der Vertragslaufzeit. ' : '') +
                title + ' ' + format(date, 'dd.MM.yyyy') +
                (isBoundaryDate ? ' (ab hier aktiv)' : '') +
                (isOccupied ? ' (Wunsch vorhanden)' : '')
              }
            >
              {content}
              {isContractEnd && (
                  <span className="pointer-events-none absolute inset-y-0 right-0 w-[2px] bg-rose-500" aria-hidden="true" />
              )}
            </button>
          );
          })}
      </div>
    </div>
  );
}
