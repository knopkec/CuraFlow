const DEFAULT_FULLTIME_HOURS = 38.5;
const DEFAULT_FULLTIME_DAILY_HOURS = 7.7;

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveDoctorTargetWeeklyHours(doctor, workTimeModel = null, centralEmployee = null) {
  const localWeeklyHours = parsePositiveNumber(doctor?.target_weekly_hours);
  if (localWeeklyHours !== null) {
    return localWeeklyHours;
  }

  const centralWeeklyHours = parsePositiveNumber(centralEmployee?.target_hours_per_week);
  if (centralWeeklyHours !== null) {
    return centralWeeklyHours;
  }

  const modelWeeklyHours = parsePositiveNumber(workTimeModel?.hours_per_week);
  if (modelWeeklyHours !== null) {
    return modelWeeklyHours;
  }

  const centralModelWeeklyHours = parsePositiveNumber(centralEmployee?.model_hours_per_week);
  if (centralModelWeeklyHours !== null) {
    return centralModelWeeklyHours;
  }

  const doctorFte = parsePositiveNumber(doctor?.fte);
  if (doctorFte !== null) {
    return Math.round(doctorFte * DEFAULT_FULLTIME_HOURS * 10) / 10;
  }

  return null;
}

export function resolveDoctorTargetDailyHours(doctor, workTimeModel = null, centralEmployee = null) {
  const localWeeklyHours = parsePositiveNumber(doctor?.target_weekly_hours);
  if (localWeeklyHours !== null) {
    return localWeeklyHours / 5;
  }

  const centralWeeklyHours = parsePositiveNumber(centralEmployee?.target_hours_per_week);
  if (centralWeeklyHours !== null) {
    return centralWeeklyHours / 5;
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

  const doctorFte = parsePositiveNumber(doctor?.fte);
  if (doctorFte !== null) {
    return doctorFte * DEFAULT_FULLTIME_DAILY_HOURS;
  }

  return null;
}