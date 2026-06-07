const DEFAULT_FULLTIME_HOURS = 38.5;
const DEFAULT_FULLTIME_DAILY_HOURS = 7.7;

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function scaleByFte(hours, doctor) {
  const parsedHours = parsePositiveNumber(hours);
  if (parsedHours === null) {
    return null;
  }

  const doctorFte = parsePositiveNumber(doctor?.fte);
  if (doctorFte === null) {
    return parsedHours;
  }

  return Math.round(parsedHours * doctorFte * 10) / 10;
}

export function isFullDaysOffModel(doctor) {
  return Boolean(doctor) && doctor.part_time_model === 'full_days_off';
}

export function resolveDoctorTargetWeeklyHours(doctor, workTimeModel = null, centralEmployee = null) {
  const isCentralLinked = Boolean(doctor?.central_employee_id);
  const localWeeklyHours = parsePositiveNumber(doctor?.target_weekly_hours);
  if (localWeeklyHours !== null && !isCentralLinked) {
    return localWeeklyHours;
  }

  const centralWeeklyHours = parsePositiveNumber(centralEmployee?.target_hours_per_week);
  if (centralWeeklyHours !== null) {
    return scaleByFte(centralWeeklyHours, doctor);
  }

  if (localWeeklyHours !== null) {
    return scaleByFte(localWeeklyHours, doctor);
  }

  const modelWeeklyHours = parsePositiveNumber(workTimeModel?.hours_per_week);
  if (modelWeeklyHours !== null) {
    return scaleByFte(modelWeeklyHours, doctor);
  }

  const centralModelWeeklyHours = parsePositiveNumber(centralEmployee?.model_hours_per_week);
  if (centralModelWeeklyHours !== null) {
    return scaleByFte(centralModelWeeklyHours, doctor);
  }

  return scaleByFte(DEFAULT_FULLTIME_HOURS, doctor);
}

export function resolveDoctorTargetDailyHours(doctor, workTimeModel = null, centralEmployee = null) {
  // Im Modell "volle Tage mit freien Tagen" wird an Arbeitstagen die volle
  // Tagesstundenzahl angesetzt – die FTE-Reduktion erfolgt über freie Tage,
  // nicht über kürzere Schichten.
  if (isFullDaysOffModel(doctor)) {
    const isCentralLinked = Boolean(doctor?.central_employee_id);
    const localWeeklyHours = parsePositiveNumber(doctor?.target_weekly_hours);
    if (localWeeklyHours !== null && !isCentralLinked) {
      return localWeeklyHours / 5;
    }

    const centralWeeklyHours = parsePositiveNumber(centralEmployee?.target_hours_per_week);
    if (centralWeeklyHours !== null) {
      return centralWeeklyHours / 5;
    }

    if (localWeeklyHours !== null) {
      return localWeeklyHours / 5;
    }

    const modelDailyHours = parsePositiveNumber(workTimeModel?.hours_per_day);
    if (modelDailyHours !== null) {
      return modelDailyHours;
    }

    const modelWeeklyHours = parsePositiveNumber(workTimeModel?.hours_per_week);
    if (modelWeeklyHours !== null) {
      return modelWeeklyHours / 5;
    }

    const centralModelWeeklyHours = parsePositiveNumber(centralEmployee?.model_hours_per_week);
    if (centralModelWeeklyHours !== null) {
      return centralModelWeeklyHours / 5;
    }

    return DEFAULT_FULLTIME_DAILY_HOURS;
  }

  const isCentralLinked = Boolean(doctor?.central_employee_id);
  const localWeeklyHours = parsePositiveNumber(doctor?.target_weekly_hours);
  if (localWeeklyHours !== null && !isCentralLinked) {
    return localWeeklyHours / 5;
  }

  const centralWeeklyHours = parsePositiveNumber(centralEmployee?.target_hours_per_week);
  if (centralWeeklyHours !== null) {
    return scaleByFte(centralWeeklyHours / 5, doctor);
  }

  if (localWeeklyHours !== null) {
    return scaleByFte(localWeeklyHours / 5, doctor);
  }

  const modelDailyHours = parsePositiveNumber(workTimeModel?.hours_per_day);
  if (modelDailyHours !== null) {
    return scaleByFte(modelDailyHours, doctor);
  }

  const modelWeeklyHours = parsePositiveNumber(workTimeModel?.hours_per_week);
  if (modelWeeklyHours !== null) {
    return scaleByFte(modelWeeklyHours / 5, doctor);
  }

  const centralModelWeeklyHours = parsePositiveNumber(centralEmployee?.model_hours_per_week);
  if (centralModelWeeklyHours !== null) {
    return scaleByFte(centralModelWeeklyHours / 5, doctor);
  }

  return scaleByFte(DEFAULT_FULLTIME_DAILY_HOURS, doctor);
}

/**
 * Anzahl fester Arbeitstage pro Woche für ein FTE < 1.0.
 * Beispiel: 0.8 → 4 Tage, 0.6 → 3 Tage, 0.2 → 1 Tag.
 * Bei FTE >= 1.0 wird 5 zurückgegeben (volle Woche).
 */
export function getPartTimeWorkDaysPerWeek(doctor) {
  const fte = parsePositiveNumber(doctor?.fte);
  if (fte === null || fte >= 1) return 5;
  return Math.max(0, Math.min(5, Math.round(fte * 5)));
}