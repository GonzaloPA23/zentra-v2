import { format, isValid, parseISO } from 'date-fns';

function normalizeDateInput(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return isValid(date) ? date : null;
  }

  const raw = String(value).trim();
  if (!raw || raw === '0000-00-00' || raw === '0000-00-00 00:00:00') {
    return null;
  }

  const normalized = raw.includes(' ') && !raw.includes('T')
    ? raw.replace(' ', 'T')
    : raw;

  const isoDate = parseISO(normalized);
  if (isValid(isoDate)) {
    return isoDate;
  }

  const fallbackDate = new Date(normalized);
  return isValid(fallbackDate) ? fallbackDate : null;
}

export function getSafeDate(value) {
  return normalizeDateInput(value);
}

export function formatSafeDate(value, pattern = 'dd/MM/yyyy', fallback = '-') {
  const date = normalizeDateInput(value);
  return date ? format(date, pattern) : fallback;
}

export function toSafeDateInputValue(value, fallback = '') {
  const date = normalizeDateInput(value);
  return date ? format(date, 'yyyy-MM-dd') : fallback;
}

export function getDateInputValueForTimeZone(
  value = new Date(),
  timeZone = 'America/Lima',
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function getPeruTodayDateInputValue() {
  return getDateInputValueForTimeZone(new Date(), 'America/Lima');
}

export function toSafeLocaleDateString(value, locale = 'es-PE', fallback = '-') {
  const date = normalizeDateInput(value);
  return date ? date.toLocaleDateString(locale) : fallback;
}
