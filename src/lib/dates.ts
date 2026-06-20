// Day 1 corresponds to 2026-06-01; each subsequent day adds 1 calendar day.

const SIM_START_ISO = "2026-06-01";
const SIM_DAY_ONE = 1;

/** Convert simulation day number to a Date object (UTC midnight). */
export function dayToDate(day: number): Date {
  const d = new Date(`${SIM_START_ISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (day - SIM_DAY_ONE));
  return d;
}

/** "2026-06-01" */
export function dayToISODate(day: number): string {
  return dayToDate(day).toISOString().slice(0, 10);
}

/** "6月1日" */
export function dayToShortDate(day: number): string {
  return dayToDate(day).toLocaleDateString("zh-CN", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
  });
}

/** "2026年6月1日" */
export function dayToLongDate(day: number): string {
  return dayToDate(day).toLocaleDateString("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Articles published on Day N are sourced from the *previous* calendar day.
 * Returns "2026-05-31" for Day 1.
 */
export function articleSourceDate(day: number): string {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
