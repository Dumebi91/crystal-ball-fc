/** Today's date in Lagos as YYYY-MM-DD. */
export function lagosDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "Sat 4:00pm WAT" */
export function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d).replace(' ', '').toLowerCase();
  return `${day} ${time} WAT`;
}
