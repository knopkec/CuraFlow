import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';

export const DEMO_PREFIX = 'demo-';

function demoId(suffix) {
  return `${DEMO_PREFIX}${suffix}`;
}

function isoDate(value) {
  return format(value, 'yyyy-MM-dd');
}

function monthKey(value) {
  return format(value, 'yyyy-MM');
}

function monthParts(value) {
  const [year, month] = monthKey(value).split('-');
  return [Number(year), Number(month)];
}

export function buildDemoSeedData(referenceDate = new Date()) {
  const today = startOfMonth(referenceDate);
  const previousMonthDate = startOfMonth(subMonths(today, 1));
  const currentMonthDate = today;
  const nextMonthDate = startOfMonth(addMonths(today, 1));
  const currentWeekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(currentWeekStart, index));
  const monthWindowEnd = endOfMonth(nextMonthDate);

  const currentMonth = monthKey(currentMonthDate);
  const previousMonth = monthKey(previousMonthDate);
  const nextMonth = monthKey(nextMonthDate);
  const [currentYearValue, currentMonthValue] = monthParts(currentMonthDate);
  const [previousYearValue, previousMonthValue] = monthParts(previousMonthDate);
  const [nextYearValue, nextMonthValue] = monthParts(nextMonthDate);

  const doctorIds = {
    anna: demoId('doctor-anna'),
    bruno: demoId('doctor-bruno'),
    clara: demoId('doctor-clara'),
    david: demoId('doctor-david'),
    emma: demoId('doctor-emma'),
    felix: demoId('doctor-felix'),
    irene: demoId('doctor-irene'),
  };

  const workplaceIds = {
    foreground: demoId('workplace-foreground'),
    background: demoId('workplace-background'),
    ct: demoId('workplace-ct'),
    mri: demoId('workplace-mri'),
    sono: demoId('workplace-sono'),
    consult: demoId('workplace-consult'),
  };

  const qualificationIds = {
    radiation: demoId('qualification-radiation'),
    mri: demoId('qualification-mri'),
    ultrasound: demoId('qualification-ultrasound'),
  };

  return {
    metadata: {
      previousMonth,
      currentMonth,
      nextMonth,
      currentWeekDates: weekDates.map(isoDate),
      monthWindowEnd: isoDate(monthWindowEnd),
    },
    teamRoles: [
      [demoId('role-chief'), 'Chefarzt', 0, true, false, true, false, 'Demo role for chief physician'],
      [demoId('role-senior'), 'Oberarzt', 1, true, false, true, false, 'Demo role for senior physician'],
      [demoId('role-specialist'), 'Facharzt', 2, true, true, true, false, 'Demo role for specialist'],
      [demoId('role-resident'), 'Assistenzarzt', 3, false, true, false, false, 'Demo role for resident'],
      [demoId('role-non-rad'), 'Nicht-Radiologe', 4, false, false, false, true, 'Excluded from statistics'],
    ],
    doctors: [
      [doctorIds.anna, 'Anna Adler', 'AA', 'Facharzt', 'anna.adler@demo.curaflow.local', 'anna.adler@demo.curaflow.local', 1, true, false, true, 38.5],
      [doctorIds.bruno, 'Bruno Berg', 'BB', 'Oberarzt', 'bruno.berg@demo.curaflow.local', 'bruno.berg@demo.curaflow.local', 2, true, false, true, 40.0],
      [doctorIds.clara, 'Clara Conrad', 'CC', 'Assistenzarzt', 'clara.conrad@demo.curaflow.local', 'clara.conrad@demo.curaflow.local', 3, true, false, true, 35.0],
      [doctorIds.david, 'David Dorn', 'DD', 'Facharzt', 'david.dorn@demo.curaflow.local', 'david.dorn@demo.curaflow.local', 4, true, false, true, 30.0],
      [doctorIds.emma, 'Emma Eber', 'EE', 'Nicht-Radiologe', 'emma.eber@demo.curaflow.local', 'emma.eber@demo.curaflow.local', 5, true, true, false, 20.0],
      [doctorIds.felix, 'Felix Falk', 'FF', 'Assistenzarzt', 'felix.falk@demo.curaflow.local', 'felix.falk@demo.curaflow.local', 6, true, false, true, 32.0],
      [doctorIds.irene, 'Irene Ivers', 'II', 'Facharzt', 'irene.ivers@demo.curaflow.local', 'irene.ivers@demo.curaflow.local', 7, false, false, false, 24.0],
    ],
    workplaces: [
      [workplaceIds.foreground, 'Dienst Vordergrund', 'Dienste', 1, true, false, 1, 1, 1],
      [workplaceIds.background, 'Dienst Hintergrund', 'Dienste', 2, true, false, 2, 1, 1],
      [workplaceIds.ct, 'CT', 'Dienste', 3, true, false, 2, 1, 2],
      [workplaceIds.mri, 'MRT Rotation', 'Rotationen', 4, true, true, null, 1, 1],
      [workplaceIds.sono, 'Sono Rotation', 'Rotationen', 5, true, true, null, 1, 1],
      [workplaceIds.consult, 'Demo / Konsil', 'Demonstrationen & Konsile', 6, true, false, null, 1, 1],
    ],
    qualifications: [
      [qualificationIds.radiation, 'Strahlenschutz Demo', 'SSD', 'Berechtigung fuer strahlenrelevante Dienste', 'Pflicht', 1, true, 60],
      [qualificationIds.mri, 'MRT Demo', 'MRT', 'MRT-Fachkunde', 'Fachlich', 2, false, null],
      [qualificationIds.ultrasound, 'Sono Demo', 'SON', 'Ultraschall-Rotation', 'Fachlich', 3, false, null],
    ],
    doctorQualifications: [
      [demoId('doctor-qualification-anna-radiation'), doctorIds.anna, qualificationIds.radiation, '2024-01-01', '2029-01-01'],
      [demoId('doctor-qualification-bruno-radiation'), doctorIds.bruno, qualificationIds.radiation, '2023-06-01', '2028-06-01'],
      [demoId('doctor-qualification-clara-mri'), doctorIds.clara, qualificationIds.mri, '2024-09-01', null],
      [demoId('doctor-qualification-david-mri'), doctorIds.david, qualificationIds.mri, '2024-01-15', null],
      [demoId('doctor-qualification-felix-ultrasound'), doctorIds.felix, qualificationIds.ultrasound, '2024-03-01', '2025-03-01'],
    ],
    workplaceQualifications: [
      [demoId('workplace-qualification-ct-radiation'), workplaceIds.ct, qualificationIds.radiation, true, false],
      [demoId('workplace-qualification-mri-mri'), workplaceIds.mri, qualificationIds.mri, true, false],
      [demoId('workplace-qualification-sono-ultrasound'), workplaceIds.sono, qualificationIds.ultrasound, true, false],
    ],
    shiftEntries: [
      [demoId(`shift-${isoDate(weekDates[0])}-foreground`), isoDate(weekDates[0]), doctorIds.anna, 'Dienst Vordergrund', 1],
      [demoId(`shift-${isoDate(weekDates[0])}-background`), isoDate(weekDates[0]), doctorIds.bruno, 'Dienst Hintergrund', 2],
      [demoId(`shift-${isoDate(weekDates[0])}-ct`), isoDate(weekDates[0]), doctorIds.clara, 'CT', 3],
      [demoId(`shift-${isoDate(weekDates[0])}-mri`), isoDate(weekDates[0]), doctorIds.david, 'MRT Rotation', 4],
      [demoId(`shift-${isoDate(weekDates[0])}-consult`), isoDate(weekDates[0]), doctorIds.felix, 'Demo / Konsil', 5],
      [demoId(`shift-${isoDate(weekDates[1])}-foreground`), isoDate(weekDates[1]), doctorIds.anna, 'Dienst Vordergrund', 1],
      [demoId(`shift-${isoDate(weekDates[1])}-background`), isoDate(weekDates[1]), doctorIds.bruno, 'Dienst Hintergrund', 2],
      [demoId(`shift-${isoDate(weekDates[1])}-sono`), isoDate(weekDates[1]), doctorIds.clara, 'Sono Rotation', 3],
      [demoId(`shift-${isoDate(weekDates[1])}-travel`), isoDate(weekDates[1]), doctorIds.david, 'Dienstreise', 4],
      [demoId(`shift-${isoDate(weekDates[1])}-vacation`), isoDate(weekDates[1]), doctorIds.emma, 'Urlaub', 5],
      [demoId(`shift-${isoDate(weekDates[2])}-foreground`), isoDate(weekDates[2]), doctorIds.felix, 'Dienst Vordergrund', 1],
      [demoId(`shift-${isoDate(weekDates[2])}-background`), isoDate(weekDates[2]), doctorIds.bruno, 'Dienst Hintergrund', 2],
      [demoId(`shift-${isoDate(weekDates[2])}-ct`), isoDate(weekDates[2]), doctorIds.anna, 'CT', 3],
      [demoId(`shift-${isoDate(weekDates[2])}-mri`), isoDate(weekDates[2]), doctorIds.david, 'MRT Rotation', 4],
      [demoId(`shift-${isoDate(weekDates[2])}-sick`), isoDate(weekDates[2]), doctorIds.emma, 'Krank', 5],
      [demoId(`shift-${isoDate(weekDates[3])}-foreground`), isoDate(weekDates[3]), doctorIds.anna, 'Dienst Vordergrund', 1],
      [demoId(`shift-${isoDate(weekDates[3])}-background`), isoDate(weekDates[3]), doctorIds.bruno, 'Dienst Hintergrund', 2],
      [demoId(`shift-${isoDate(weekDates[3])}-ct`), isoDate(weekDates[3]), doctorIds.clara, 'CT', 3],
      [demoId(`shift-${isoDate(weekDates[3])}-consult`), isoDate(weekDates[3]), doctorIds.david, 'Demo / Konsil', 4],
      [demoId(`shift-${isoDate(weekDates[3])}-unavailable`), isoDate(weekDates[3]), doctorIds.felix, 'Nicht verfügbar', 5],
      [demoId(`shift-${isoDate(weekDates[4])}-foreground`), isoDate(weekDates[4]), doctorIds.anna, 'Dienst Vordergrund', 1],
      [demoId(`shift-${isoDate(weekDates[4])}-background`), isoDate(weekDates[4]), doctorIds.bruno, 'Dienst Hintergrund', 2],
      [demoId(`shift-${isoDate(weekDates[4])}-free`), isoDate(weekDates[4]), doctorIds.clara, 'Frei', 3],
      [demoId(`shift-${isoDate(weekDates[4])}-sono`), isoDate(weekDates[4]), doctorIds.david, 'Sono Rotation', 4],
      [demoId(`shift-${isoDate(weekDates[4])}-consult`), isoDate(weekDates[4]), doctorIds.emma, 'Demo / Konsil', 5],
    ],
    wishRequests: [
      [demoId(`wish-anna-${currentMonth}`), doctorIds.anna, currentMonth, isoDate(weekDates[1]), isoDate(weekDates[1]), 'Dienst Vordergrund', 'service', 'approved', 'Approved service preference'],
      [demoId(`wish-bruno-${currentMonth}`), doctorIds.bruno, currentMonth, isoDate(weekDates[2]), isoDate(weekDates[3]), 'Dienst Hintergrund', 'no_service', 'pending', 'Avoid background duty during training'],
      [demoId(`wish-clara-${nextMonth}`), doctorIds.clara, nextMonth, `${nextMonth}-05`, `${nextMonth}-07`, 'Sono Rotation', 'service', 'rejected', 'Rejected next-month ultrasound request'],
      [demoId(`wish-david-${previousMonth}`), doctorIds.david, previousMonth, `${previousMonth}-10`, `${previousMonth}-10`, 'MRT Rotation', 'service', 'approved', 'Completed prior-month rotation preference'],
      [demoId(`wish-emma-${currentMonth}`), doctorIds.emma, currentMonth, isoDate(weekDates[4]), isoDate(weekDates[5]), 'Urlaub', 'no_service', 'approved', 'Current-month approved vacation wish'],
    ],
    trainingRotations: [
      [demoId(`training-clara-${currentMonth}`), doctorIds.clara, 'Sono Rotation', workplaceIds.sono, isoDate(weekDates[1]), isoDate(weekDates[3]), 'planned', 'Current-week demo training block'],
      [demoId(`training-david-${nextMonth}`), doctorIds.david, 'MRT Einarbeitung', workplaceIds.mri, `${nextMonth}-08`, `${nextMonth}-12`, 'planned', 'Next-month rotation for future navigation'],
      [demoId(`training-felix-${previousMonth}`), doctorIds.felix, 'CT Hospitation', workplaceIds.ct, `${previousMonth}-15`, `${previousMonth}-18`, 'transferred', 'Previous-month transferred training example'],
    ],
    staffingPlanEntries: [
      [demoId(`staffing-anna-${previousMonth}`), doctorIds.anna, previousYearValue, previousMonthValue, '0.8'],
      [demoId(`staffing-anna-${currentMonth}`), doctorIds.anna, currentYearValue, currentMonthValue, '1.0'],
      [demoId(`staffing-anna-${nextMonth}`), doctorIds.anna, nextYearValue, nextMonthValue, '1.0'],
      [demoId(`staffing-bruno-${currentMonth}`), doctorIds.bruno, currentYearValue, currentMonthValue, '1.0'],
      [demoId(`staffing-clara-${currentMonth}`), doctorIds.clara, currentYearValue, currentMonthValue, '0.9'],
      [demoId(`staffing-david-${currentMonth}`), doctorIds.david, currentYearValue, currentMonthValue, '0.8'],
      [demoId(`staffing-emma-${currentMonth}`), doctorIds.emma, currentYearValue, currentMonthValue, '0.5'],
      [demoId(`staffing-felix-${currentMonth}`), doctorIds.felix, currentYearValue, currentMonthValue, '0.7'],
    ],
    customHolidays: [
      [demoId(`holiday-${currentMonth}`), 'Demo Feiertag', `${currentMonth}-01`, 'NW'],
      [demoId(`holiday-${nextMonth}`), 'Demo Brueckentag', `${nextMonth}-15`, 'NW'],
    ],
    systemSettings: [
      [demoId('system-setting-current-month'), 'demo_seed_current_month', currentMonth],
      [demoId('system-setting-next-month'), 'demo_seed_next_month', nextMonth],
      [demoId('system-setting-demo-banner'), 'demo_banner_text', `Rolling demo seeded for ${currentMonth}`],
    ],
    colorSettings: [
      [demoId('color-setting-vacation'), 'Urlaub', 'position', '#22c55e', '#ffffff'],
      [demoId('color-setting-duty'), 'Dienste', 'section', '#dbeafe', '#1e3a8a'],
      [demoId('color-setting-training'), 'Rotationen', 'section', '#fae8ff', '#86198f'],
    ],
    scheduleNotes: [
      [demoId(`note-${isoDate(weekDates[0])}`), isoDate(weekDates[0]), 'Demo note for the first visible planning day'],
      [demoId(`note-${isoDate(weekDates[3])}`), isoDate(weekDates[3]), 'Demo note for absence and consult examples'],
    ],
    scheduleRules: [
      [demoId('schedule-rule-coverage'), 'Demo Mindestbesetzung', 'minimum_staffing', JSON.stringify({ sections: ['Dienste'], enforce: true }), true],
      [demoId('schedule-rule-rotation'), 'Demo Rotationsschutz', 'rotation_spacing', JSON.stringify({ minDaysBetween: 2 }), true],
    ],
    scheduleBlocks: [
      [demoId(`block-${isoDate(weekDates[5])}-ct`), isoDate(weekDates[5]), 'CT', null, 'Weekend CT is blocked in the demo'],
    ],
    demoSettings: [
      [demoId('demo-setting-landing'), 'landing_notice', `Demo data covers ${previousMonth} to ${nextMonth}`],
      [demoId('demo-setting-window-end'), 'seed_window_end', isoDate(monthWindowEnd)],
    ],
    voiceAliases: [
      [demoId('voice-alias-anna'), 'a nna', 'Anna Adler'],
      [demoId('voice-alias-bruno'), 'bruh no', 'Bruno Berg'],
    ],
    systemLogs: [
      [demoId('system-log-seed'), 'info', 'demo-seed', `Rolling demo data prepared for ${currentMonth}`, JSON.stringify({ currentMonth, nextMonth })],
    ],
  };
}
