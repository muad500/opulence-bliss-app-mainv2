export function londonDate(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function earningsPeriodTotals(rows: { date: string; amount: number }[], now = new Date()) {
  const today = londonDate(now);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const weekStart = start.toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  return rows.reduce((total, row) => {
    const date = londonDate(row.date);
    if (date >= weekStart && date <= today) total.week += row.amount;
    if (date >= monthStart && date <= today) total.month += row.amount;
    return total;
  }, { week: 0, month: 0 });
}

export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
