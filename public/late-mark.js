// Whether a time-in counts as late on the attendance screens.
// Same threshold the payroll engine uses: at or above the grace period the day is late.
// An approved offset does not clear it.
export const graceFloor = grace => Math.max(1, Number.isFinite(Number(grace)) ? Number(grace) : 0);
export const clockMinutes = hm => {
  const [h, m] = String(hm || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};
export function lateMinutes(timeIn, scheduledIn) {
  const arrived = clockMinutes(timeIn), scheduled = clockMinutes(scheduledIn);
  return arrived === null || scheduled === null ? 0 : arrived - scheduled;
}
export const isGraceLate = (raw, grace) => raw >= graceFloor(grace);
