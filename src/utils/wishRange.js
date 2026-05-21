import { format, parseISO, isValid } from 'date-fns';

const normalizeDateString = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = value instanceof Date ? value : parseISO(String(value));
  if (!isValid(parsed)) return null;
  return format(parsed, 'yyyy-MM-dd');
};

export const getWishStartDate = (wish) => normalizeDateString(wish?.range_start || wish?.start_date || wish?.date);

export const getWishEndDate = (wish) => normalizeDateString(
  wish?.range_end || wish?.end_date || wish?.date || wish?.start_date || wish?.range_start
);

export const hasWishRange = (wish) => {
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);
  return !!start && !!end && start !== end;
};

export const isWishOnDate = (wish, dateValue) => {
  const day = normalizeDateString(dateValue);
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);

  if (!day || !start || !end) return false;
  return day >= start && day <= end;
};

export const getWishDateLabel = (wish) => {
  const start = getWishStartDate(wish);
  const end = getWishEndDate(wish);

  if (!start && !end) return '-';
  if (!start || !end || start === end) return start || end;
  return `${start} bis ${end}`;
};
