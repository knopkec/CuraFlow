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