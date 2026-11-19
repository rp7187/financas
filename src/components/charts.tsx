import { useState } from "preact/hooks";
import { monthLong, monthShort } from "../dates";
import { money, moneyShort } from "../model";

/*
 * Gráficos em SVG puro. Receita/despesa usam --income/--expense (validadas nos temas claro e escuro,
 * inclusive daltonismo); saldo usa --line. Toque numa coluna mostra os valores na linha de detalhe.
 */

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Barra com topo arredondado (4px) ancorada na base. */
const barPath = (x: number, w: number, base: number, h: number) => {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + w - r}Q${x + w},${base - h} ${x + w},${base - h + r}V${base}Z`;
};

/** Receitas × despesas por mês (barras lado a lado, um eixo só). */
export function IncomeExpenseChart({ rows, current }: { rows: { month: string; income: number; expense: number }[]; current: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 340, H = 170, left = 36, top = 10, bottom = 20;
  const max = niceMax(Math.max(...rows.flatMap((r) => [r.income, r.expense])));
  const slot = (W - left) / rows.length;
  const bw = Math.max(3, Math.min(12, (slot - 4) / 2 - 1));
  const base = H - bottom;
  const y = (v: number) => (v / max) * (base - top);
  const s = sel !== null ? rows[sel] : null;
  return (
    <figure class="chart">
      <div class="legend"><span><i class="sw income" />Receitas</span><span><i class="sw expense" />Despesas</span></div>
      <p class="chart-detail" aria-live="polite">
        {s ? <>{monthLong(s.month)}: <b class="income">{money(s.income)}</b> · <b class="expense">{money(s.expense)}</b> · resultado {money(s.income - s.expense)}</> : "Toque num mês para ver os valores."}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rows.map((r) => `${monthShort(r.month)}: receitas ${money(r.income)}, despesas ${money(r.expense)}`).join("; ")}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={base - f * (base - top)} y2={base - f * (base - top)} class="grid" />
            <text x={left - 6} y={base - f * (base - top) + 3.5} class="tick" text-anchor="end">{moneyShort(max * f)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = left + i * slot + (slot - (2 * bw + 2)) / 2;
          return (
            <g key={r.month} class="hit" onClick={() => setSel(sel === i ? null : i)}>
              <rect x={left + i * slot} y={0} width={slot} height={H} fill="transparent" />
              <path d={barPath(x, bw, base, y(r.income))} class={`bar income ${sel === i ? "sel" : ""}`} />
              <path d={barPath(x + bw + 2, bw, base, y(r.expense))} class={`bar expense ${sel === i ? "sel" : ""}`} />
              {(i % 2 === rows.length % 2 || rows.length <= 6) && (
                <text x={left + i * slot + slot / 2} y={H - 5} class={`tick ${r.month === current ? "now" : ""}`} text-anchor="middle">{monthShort(r.month).slice(0, 3)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Saldo no fim de cada mês; meses futuros tracejados (projeção). */
export function BalanceChart({ rows, current }: { rows: { month: string; balance: number }[]; current: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 340, H = 170, left = 40, right = 8, top = 12, bottom = 20;
  const vals = rows.map((r) => r.balance);
  let lo = Math.min(0, ...vals), hi = Math.max(...vals);
  if (hi === lo) hi = lo + 100;
  const pad = (hi - lo) * 0.08;
  lo -= lo < 0 ? pad : 0; hi += pad;
  const X = (i: number) => left + (i / Math.max(1, rows.length - 1)) * (W - left - right);
  const Y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const ci = rows.findIndex((r) => r.month === current);
  const path = (from: number, to: number) => rows.slice(from, to + 1).map((r, k) => `${k ? "L" : "M"}${X(from + k).toFixed(1)},${Y(r.balance).toFixed(1)}`).join("");
  const past = ci >= 0 ? path(0, ci) : path(0, rows.length - 1);
  const future = ci >= 0 && ci < rows.length - 1 ? path(ci, rows.length - 1) : "";
  const s = sel !== null ? rows[sel] : null;
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <figure class="chart">
      <p class="chart-detail" aria-live="polite">
        {s ? <>{monthLong(s.month)}: <b>{money(s.balance)}</b>{s.month > current ? " (previsto)" : ""}</> : "Toque num mês. Linha tracejada = previsão."}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rows.map((r) => `${monthShort(r.month)}: ${money(r.balance)}`).join("; ")}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={left} x2={W - right} y1={Y(t)} y2={Y(t)} class="grid" />
            <text x={left - 6} y={Y(t) + 3.5} class="tick" text-anchor="end">{moneyShort(t)}</text>
          </g>
        ))}
        <defs>
          <linearGradient id="balance-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--line)" stop-opacity="0.22" />
            <stop offset="100%" stop-color="var(--line)" stop-opacity="0" />
          </linearGradient>
        </defs>
        {rows.length > 1 && <path d={`${path(0, rows.length - 1)}L${X(rows.length - 1)},${Y(Math.max(lo, 0))}L${X(0)},${Y(Math.max(lo, 0))}Z`} class="area" />}
        {lo < 0 && <line x1={left} x2={W - right} y1={Y(0)} y2={Y(0)} class="zero" />}
        {ci >= 0 && <line x1={X(ci)} x2={X(ci)} y1={top} y2={H - bottom} class="today" />}
        <path d={past} class="line" />
        {future && <path d={future} class="line future" />}
        {rows.map((r, i) => (
          <g key={r.month} class="hit" onClick={() => setSel(sel === i ? null : i)}>
            <rect x={X(i) - (W - left) / rows.length / 2} y={0} width={(W - left) / rows.length} height={H} fill="transparent" />
            <circle cx={X(i)} cy={Y(r.balance)} r={sel === i ? 5 : i === ci ? 4 : 2.5} class={`pt ${r.month > current ? "future" : ""} ${sel === i ? "sel" : ""}`} />
          </g>
        ))}
        {[0, ci >= 0 ? ci : -1, rows.length - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i).map((i) => (
          <text key={`x${i}`} x={X(i)} y={H - 5} class={`tick ${i === ci ? "now" : ""}`} text-anchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}>{monthShort(rows[i].month)}</text>
        ))}
      </svg>
    </figure>
  );
}
