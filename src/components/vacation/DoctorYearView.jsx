import React, { useState } from 'react';
import { format, startOfYear, endOfYear, eachMonthOfInterval, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, isWeekend, isWithinInterval, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from "@/lib/utils";
import { useQuery } from '@tanstack/react-query';
import { db, base44 } from "@/api/client";
import { DEFAULT_COLORS } from '@/components/settings/ColorSettingsDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getContractTooltipLabel, isDateWithinContract } from '@/components/training/trainingContractUtils';

export default function DoctorYearView({
  doctor,
  year,
  shifts,
  onToggle,
  onRangeSelect,
  activeType,
  rangeStart,
  contractInfo,
  customColors: propCustomColors,
  isSchoolHoliday,
  isPublicHoliday,
  dayTestIdPrefix = 'year-day',
}) {
  const [dragStart, setDragStart] = useState(null);
  const [dragCurrent, setDragCurrent] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  React.useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging) {
        if (dragStart && dragCurrent && !isSameDay(dragStart, dragCurrent)) {
            // Range selection finished
            onRangeSelect && onRangeSelect(dragStart, dragCurrent);
        }
        // If same day, we treat it as a click which is handled by the button onClick/onMouseUp combination, 
        // but actually we suppress onClick if we handled drag?
        // Let's rely on standard onClick for single clicks if we didn't drag range.
        
        setIsDragging(false);
        setDragStart(null);
        setDragCurrent(null);
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isDragging, dragStart, dragCurrent, onRangeSelect]);

  const handleMouseDown = (date) => {
      // Only left click
      setDragStart(date);
      setDragCurrent(date);
      setIsDragging(true);
  };

  const handleMouseEnter = (date) => {
      if (isDragging) {
          setDragCurrent(date);
      }
  };

  const { data: colorSettings = [] } = useQuery({
    queryKey: ['colorSettings'],
    queryFn: () => db.ColorSetting.list(),
    staleTime: 1000 * 60 * 10, // 10 minutes
    cacheTime: 1000 * 60 * 30, // 30 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const getCustomColor = (position) => {
      const setting = colorSettings.find(s => s.name === position && s.category === 'position');
      if (setting) return { backgroundColor: setting.bg_color, color: setting.text_color };
      if (DEFAULT_COLORS.positions[position]) return { backgroundColor: DEFAULT_COLORS.positions[position].bg, color: DEFAULT_COLORS.positions[position].text };
      return null;
  };

  // Get future absences for email
  const today = startOfDay(new Date());
  const absenceTypes = ["Urlaub", "Frei", "Krank", "Dienstreise", "Nicht verfügbar"];
  const futureAbsences = shifts
      .filter(s => {
          const shiftDate = new Date(s.date);
          return absenceTypes.includes(s.position) && shiftDate >= today;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Kalender/Dienstplan-Emails gehen an die Kalender-Adresse
  const doctorEmail = doctor?.google_email || doctor?.email;

  const generateAbsenceICS = (absences) => {
      const events = absences.map(shift => {
          const d = new Date(shift.date);
          const dateStr = d.toISOString().split('T')[0].replaceAll('-', '');
          
          const nextDay = new Date(d);
          nextDay.setHours(12);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split('T')[0].replaceAll('-', '');
          
          return [
              'BEGIN:VEVENT',
              `UID:absence-${shift.id || shift.date}@radioplan`,
              `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
              `DTSTART;VALUE=DATE:${dateStr}`,
              `DTEND;VALUE=DATE:${nextDayStr}`,
              `SUMMARY:${shift.position}`,
              `DESCRIPTION:Abwesenheit: ${shift.position}`,
              'END:VEVENT'
          ].join('\r\n');
      }).join('\r\n');

      return [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//RadioPlan//NONSGML v1.0//EN',
          'CALSCALE:GREGORIAN',
          'METHOD:PUBLISH',
          events,
          'END:VCALENDAR'
      ].join('\r\n');
  };

  const handleSendAbsenceEmail = async () => {
      if (!doctorEmail || futureAbsences.length === 0) return;
      
      setIsSendingEmail(true);
      try {
          const formatter = new Intl.DateTimeFormat('de-DE', {
              weekday: 'long',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
          });

          const dateList = futureAbsences.map(s => {
              const date = new Date(s.date);
              return `- ${formatter.format(date)}: ${s.position}`;
          }).join('\n');

          let body = `Hallo ${doctor.name},\n\n`;
          body += `Hier ist eine Übersicht deiner eingetragenen Abwesenheiten:\n\n${dateList}`;
          body += `\n\nViele Grüße,\nDein CuraFlow-System`;

          await base44.integrations.Core.SendEmail({
              to: doctorEmail.trim(),
              subject: `[CuraFlow] Deine Abwesenheiten`,
              body: body
          });

          alert('E-Mail erfolgreich gesendet!');
          setEmailDialogOpen(false);
      } catch (error) {
          console.error('Failed to send email:', error);
          alert('Fehler beim Senden der E-Mail: ' + error.message);
      } finally {
          setIsSendingEmail(false);
      }
  };

  const months = eachMonthOfInterval({
    start: startOfYear(new Date(year, 0, 1)),
    end: endOfYear(new Date(year, 0, 1))
  });

  const getShiftStatus = (date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const shift = shifts.find(s => s.date === dateStr);
    return shift ? shift.position : null;
  };

    const isDateDisabled = (date) => !isDateWithinContract(date, contractInfo?.contractStart, contractInfo?.contractEnd);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow-sm ${doctor.color || "bg-slate-100"}`}>
              {doctor.initials}
          </div>
          <div>
              <h2 className="text-xl font-bold text-slate-900" title={getContractTooltipLabel(contractInfo) || undefined}>{doctor.name}</h2>
              <p className="text-slate-500">{doctor.role} • Jahresplanung {year}</p>
          </div>
        </div>
        
        {doctorEmail && futureAbsences.length > 0 && (
            <Button 
                variant="outline" 
                size="sm"
                onClick={() => setEmailDialogOpen(true)}
                className="gap-2"
            >
                <Mail className="w-4 h-4" />
                Abwesenheiten senden
            </Button>
        )}
      </div>
      
      {/* Email Confirmation Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
          <DialogContent className="max-w-md">
              <DialogHeader>
                  <DialogTitle>Abwesenheiten per E-Mail senden</DialogTitle>
                  <DialogDescription>
                      Folgende {futureAbsences.length} Abwesenheiten werden gesendet:
                  </DialogDescription>
              </DialogHeader>
              
              <div className="max-h-[300px] overflow-y-auto border rounded-md p-3 bg-slate-50 text-sm space-y-1">
                  {futureAbsences.slice(0, 20).map((s, idx) => {
                      const date = new Date(s.date);
                      return (
                          <div key={idx} className="flex justify-between">
                              <span>{format(date, 'dd.MM.yyyy (EEEE)', { locale: de })}</span>
                              <span className="text-slate-500">{s.position}</span>
                          </div>
                      );
                  })}
                  {futureAbsences.length > 20 && (
                      <div className="text-slate-400 italic pt-2">
                          ... und {futureAbsences.length - 20} weitere
                      </div>
                  )}
              </div>
              
              <div className="bg-indigo-50 border border-indigo-100 rounded-md p-3 text-sm">
                  <span className="font-medium text-indigo-800">Empfänger:</span>
                  <span className="ml-2 text-indigo-600">{doctorEmail}</span>
              </div>
              
              <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
                      Abbrechen
                  </Button>
                  <Button 
                      onClick={handleSendAbsenceEmail} 
                      disabled={isSendingEmail}
                      className="gap-2"
                  >
                      {isSendingEmail ? (
                          <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Sende...
                          </>
                      ) : (
                          <>
                              <Mail className="w-4 h-4" />
                              Jetzt senden
                          </>
                      )}
                  </Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {months.map(month => (
          <MonthCalendar 
            key={month.toString()} 
            month={month} 
            getShiftStatus={getShiftStatus}
            onDateClick={(date, e) => {
                // If we were dragging a range, don't trigger click toggle
                if (isDateDisabled(date) || (isDragging && dragStart && dragCurrent && !isSameDay(dragStart, dragCurrent))) {
                    return;
                }
                onToggle(date, getShiftStatus(date), e);
            }}
            onMouseDown={(date) => {
                if (!isDateDisabled(date)) handleMouseDown(date);
            }}
            onMouseEnter={(date) => {
                if (!isDateDisabled(date)) handleMouseEnter(date);
            }}
            dragStart={dragStart}
            dragCurrent={dragCurrent}
            isDragging={isDragging}
            activeType={activeType}
            rangeStart={rangeStart}
            contractInfo={contractInfo}
            isDateDisabled={isDateDisabled}
            customColors={propCustomColors}
            getCustomColor={getCustomColor}
            isSchoolHoliday={isSchoolHoliday}
            isPublicHoliday={isPublicHoliday}
            dayTestIdPrefix={dayTestIdPrefix}
          />
        ))}
      </div>
    </div>
  );
}

function MonthCalendar({ month, getShiftStatus, onDateClick, onMouseDown, onMouseEnter, dragStart, dragCurrent, isDragging, activeType, rangeStart, contractInfo, isDateDisabled, customColors, getCustomColor, isSchoolHoliday: checkSchoolHoliday, isPublicHoliday: checkPublicHoliday, dayTestIdPrefix }) {
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
          const status = getShiftStatus(date);
                    const disabled = isDateDisabled ? isDateDisabled(date) : false;
                    const isContractEnd = Boolean(contractInfo?.contractEnd) && format(date, 'yyyy-MM-dd') === contractInfo.contractEnd;
          const isWeekendDay = isWeekend(date);
          // Use passed functions or defaults if missing
          const isHoliday = checkPublicHoliday ? checkPublicHoliday(date) : false;
          const isSchoolHoliday = checkSchoolHoliday ? checkSchoolHoliday(date) : false;
          const isRangeStart = rangeStart && isSameDay(date, rangeStart);
          
          const isDragged = isDragging && dragStart && dragCurrent && isWithinInterval(date, {
              start: dragStart < dragCurrent ? dragStart : dragCurrent,
              end: dragCurrent > dragStart ? dragCurrent : dragStart
          });

          // Color mapping
          let colorClass = "";
          let style = {};

          const dynamicColor = status ? getCustomColor(status) : null;

          if (disabled) {
              style = {
                  backgroundColor: '#f8fafc',
                  backgroundImage: 'repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.22) 0, rgba(148, 163, 184, 0.22) 4px, transparent 4px, transparent 10px)'
              };
              colorClass = "text-slate-300 cursor-not-allowed";
          } else if (customColors && customColors[status]) {
              const colorVal = customColors[status];
              if (typeof colorVal === 'object' && colorVal.backgroundColor) {
                  // Inline style object (new format from Training & Vacation)
                  style = colorVal;
                  colorClass = "hover:opacity-90 font-medium";
              } else if (typeof colorVal === 'string') {
                  // Legacy Tailwind class string
                  colorClass = `${colorVal} text-white hover:opacity-90`;
              }
          } else if (dynamicColor) {
              style = dynamicColor;
              colorClass = "hover:opacity-90 font-medium";
          } else if (status === 'Urlaub') colorClass = "bg-green-500 text-white hover:bg-green-600";
          else if (status === 'Frei') colorClass = "bg-slate-500 text-white hover:bg-slate-600";
          else if (status === 'Krank') colorClass = "bg-red-500 text-white hover:bg-red-600";
          else if (status === 'Dienstreise') colorClass = "bg-blue-500 text-white hover:bg-blue-600";
          else if (status === 'Nicht verfügbar') colorClass = "bg-orange-500 text-white hover:bg-orange-600";
          else if (status) colorClass = "bg-slate-200 text-slate-500"; 
          else if (isHoliday) {
              colorClass = "text-blue-900 hover:bg-blue-200 font-medium";
              style = { 
                  backgroundColor: '#eff6ff', // blue-50
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(59, 130, 246, 0.1) 5px, rgba(59, 130, 246, 0.1) 10px)'
              };
          }
          else if (isSchoolHoliday) {
              colorClass = "text-green-900 hover:bg-green-200";
              style = { 
                  backgroundColor: '#f0fdf4', // green-50
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(34, 197, 94, 0.1) 5px, rgba(34, 197, 94, 0.1) 10px)'
              };
          }
          else if (isWeekendDay) colorClass = "bg-slate-50 text-slate-400 hover:bg-slate-100";
          else colorClass = "hover:bg-slate-100 text-slate-700";

          if (isRangeStart && !disabled) {
              colorClass += " ring-2 ring-indigo-500 ring-offset-1 z-10";
          }
          
          if (isDragged && !disabled) {
              colorClass += " ring-2 ring-indigo-400 ring-offset-1 z-20 opacity-80";
          }

          return (
            <button
              key={date.toString()}
              data-testid={`${dayTestIdPrefix}-${format(date, 'yyyy-MM-dd')}`}
                            onMouseDown={() => {
                                if (!disabled) onMouseDown(date);
                            }}
                            onMouseEnter={() => {
                                if (!disabled) onMouseEnter(date);
                            }}
                            onClick={(e) => {
                                if (!disabled) onDateClick(date, e);
                            }}
              className={cn(
                                "aspect-square flex items-center justify-center rounded-sm transition-colors text-xs sm:text-sm select-none relative",
                colorClass
              )}
              style={style}
                            title={disabled ? `Außerhalb der Vertragslaufzeit ${format(date, 'dd.MM.yyyy')}` : (status || (isHoliday ? 'Feiertag' : isSchoolHoliday ? 'Ferien' : '') + ' ' + format(date, 'dd.MM.yyyy'))}
            >
              {format(date, 'd')}
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
