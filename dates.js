export const indiaDate = (time = Date.now()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
export const expiryFor = (validity, now = Date.now()) => Date.parse(`${indiaDate(now + validity * 86400000)}T23:59:59+05:30`);
export function validVisitDate(value, validity, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed=Date.parse(value+'T12:00:00+05:30');
  return Number.isFinite(parsed) && indiaDate(parsed)===value && value>=indiaDate(now) && value<=indiaDate(expiryFor(validity,now));
}
export const displayVisitDate=value=>value?new Date(value+'T12:00:00+05:30').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}):'';
