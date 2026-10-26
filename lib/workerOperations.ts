export function londonMonth(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-01`;
}

export function graceCancellationsLeft(count: number) {
  return Math.max(0, 2 - count);
}

export function csvCell(value: unknown) {
  let text = String(value ?? "");
  // Spreadsheet applications can execute a formula even in a quoted CSV cell.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function hmrcDates(from: string | null, to: string | null) {
  const valid = (value: string | null) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  };
  if (!valid(from) || !valid(to) || from! >= to!)
    throw Error("Choose a valid start date and an end date after it.");
  if ((Date.parse(to!) - Date.parse(from!)) / 86_400_000 > 366)
    throw Error("Export no more than one tax year at a time.");
  return { from: from!, to: to! };
}
