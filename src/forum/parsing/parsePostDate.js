/** Convert the forum's displayed publication time without changing its timezone. */
export function parsePostDate(dateElement) {
  const text = dateElement.clone().find('a').remove().end().text();
  const match = text.match(/(\d{4})-(\d{2})-(\d{2}),?\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?/i);
  if (!match) return null;
  const [, year, month, day, rawHour, minute, period] = match;
  let hour = Number(rawHour);
  if (period) hour = (hour % 12) + (period.toLowerCase() === 'pm' ? 12 : 0);
  if (hour > 23 || Number(minute) > 59) return null;
  return `${day}.${month}.${year}, ${String(hour).padStart(2, '0')}:${minute}`;
}
