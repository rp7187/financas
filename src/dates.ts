const pad = (n: number) => String(n).padStart(2, "0");

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const monthOf = (iso: string) => iso.slice(0, 7);
export const thisMonth = () => monthOf(todayISO());

/** "2026-11" + n → "2027-01" */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export const monthDiff = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
export const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/** Dia do mês ajustado (31 em fevereiro → 28/29). */
export const dateInMonth = (month: string, day: number) => `${month}-${pad(Math.min(day, daysInMonth(month)))}`;
/** Mesmo dia, n meses depois (ajustando o fim do mês). */
export const addMonthsToDate = (iso: string, n: number) => dateInMonth(addMonths(monthOf(iso), n), Number(iso.slice(8, 10)));

const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d || 1, 12));
};
/** "Novembro de 2026" */
export const monthLong = (month: string) => {
  const s = utc(`${month}-01`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** "nov/26" */
export const monthShort = (month: string) => {
  const s = utc(`${month}-01`).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");
  return `${s}/${month.slice(2, 4)}`;
};
/** "qua, 19/11" */
export const dayLabel = (iso: string) => utc(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).replace(".", "");
/** "19/11/26" */
export const fmtDate = (iso: string) => utc(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" });
