export const dateValue = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const timeValue = (date, precise = false) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  + (precise ? `:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}` : '');
export const parseTime = (input, precise = false) => {
  if (precise) {
    const match = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/.exec(input.trim());
    return match ? match[0] : null;
  }
  const match = /^(\d{1,2}):([0-5]\d)$|^(\d{1,2})([0-5]\d)$/.exec(input.trim());
  if (!match) return null;
  const hour = Number(match[1] ?? match[3]);
  return hour < 24 ? `${String(hour).padStart(2, '0')}:${match[2] ?? match[4]}` : null;
};
export const localTimestamp = (day, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !time) return null;
  const precise = time.length > 5;
  if (parseTime(time, precise) !== time) return null;
  const value = new Date(`${day}T${time}`);
  return Number.isFinite(value.getTime()) && dateValue(value) === day && timeValue(value, precise) === time ? value : null;
};
