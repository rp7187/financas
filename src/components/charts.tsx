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

export type NatureRow = { month: string; fixed: number; installment: number; variable: number };
const NATURE_ORDER = ["fixed", "installment", "variable"] as const;
export const NATURE_LABEL = { fixed: "Fixas", installment: "Parceladas", variable: "Variáveis" } as const;

/** Despesas por natureza, colunas empilhadas por mês (fixas embaixo; 2px de respiro entre segmentos). */
export function NatureChart({ rows, current }: { rows: NatureRow[]; current: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 340, H = 140, left = 36, top = 10, bottom = 20, gap = 2;
  const totals = rows.map((r) => r.fixed + r.installment + r.variable);
  const max = niceMax(Math.max(...totals));
  const slot = (W - left) / rows.length;
  const bw = Math.min(30, slot - 10);
  const base = H - bottom;
  const scale = (base - top) / max;
  const s = sel !== null ? rows[sel] : null;
  return (
    <figure class="chart">
      <div class="legend">{NATURE_ORDER.map((k) => <span key={k}><i class={`sw ${k}`} />{NATURE_LABEL[k]}</span>)}</div>
      <p class="chart-detail" aria-live="polite">
        {s ? <>{monthLong(s.month)}: fixas {money(s.fixed)} · parceladas {money(s.installment)} · variáveis {money(s.variable)}</> : "Toque num mês para ver os valores."}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rows.map((r) => `${monthShort(r.month)}: fixas ${money(r.fixed)}, parceladas ${money(r.installment)}, variáveis ${money(r.variable)}`).join("; ")}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={base - f * (base - top)} y2={base - f * (base - top)} class="grid" />
            <text x={left - 6} y={base - f * (base - top) + 3.5} class="tick" text-anchor="end">{moneyShort(max * f)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = left + i * slot + (slot - bw) / 2;
          let y = base;
          const segs = NATURE_ORDER.map((k) => ({ k, h: r[k] * scale })).filter((g) => g.h > 0.5);
          return (
            <g key={r.month} class="hit" onClick={() => setSel(sel === i ? null : i)}>
              <rect x={left + i * slot} y={0} width={slot} height={H} fill="transparent" />
              {segs.map((g, j) => {
                const last = j === segs.length - 1;
                const h = Math.max(1, g.h - (j > 0 ? gap : 0));
                const yTop = y - (j > 0 ? gap : 0) - h;
                const el = last
                  ? <path key={g.k} d={barPath(x, bw, yTop + h, h)} class={`bar ${g.k} ${sel === i ? "sel" : ""}`} />
                  : <rect key={g.k} x={x} y={yTop} width={bw} height={h} class={`bar ${g.k} ${sel === i ? "sel" : ""}`} />;
                y = yTop;
                return el;
              })}
              <text x={left + i * slot + slot / 2} y={H - 5} class={`tick ${r.month === current ? "now" : ""}`} text-anchor="middle">{monthShort(r.month).slice(0, 3)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export type FlowRow = { month: string; income: number; expense: number; balance: number };

/** Escala com ~3 marcas "redondas" cobrindo [lo, hi]. */
function niceRange(lo: number, hi: number): number[] {
  if (hi === lo) { hi = lo + 100_00; }
  const span = hi - lo;
  const raw = span / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-6; v += step) out.push(v);
  return out;
}

/**
 * Fluxo do mês (receitas × despesas, barras) e saldo no fim do mês (linha), em dois painéis
 * alinhados pelo mesmo eixo de meses — sem eixo duplo. Toque num mês destaca a coluna nos dois.
 */
export function FlowBalanceChart({ rows, current }: { rows: FlowRow[]; current: string }) {
  // nenhum mês selecionado = visão do período todo; tocar num mês mostra ele, tocar de novo volta ao todo
  const [selRaw, setSel] = useState<number | null>(null);
  const sel = selRaw !== null && selRaw < rows.length ? selRaw : null;
  const toggle = (i: number) => setSel(sel === i ? null : i);
  const last = rows[rows.length - 1];
  const s = sel !== null ? rows[sel] : { month: "", income: rows.reduce((a, r) => a + r.income, 0), expense: rows.reduce((a, r) => a + r.expense, 0), balance: last.balance };
  const W = 340, left = 40, right = 8;
  const top1 = 28, h1 = 86, gapY = 42, h2 = 76, bottomPad = 20;
  const top2 = top1 + h1 + gapY;
  const H = top2 + h2 + bottomPad;
  const slot = (W - left - right) / rows.length;
  const cx = (i: number) => left + i * slot + slot / 2;
  const bw = Math.max(3, Math.min(14, (slot - 6) / 2 - 1));

  // painel 1: barras a partir de zero
  const max1 = niceMax(Math.max(...rows.flatMap((r) => [r.income, r.expense])));
  const base1 = top1 + h1;
  const y1 = (v: number) => (v / max1) * h1;
  // painel 2: saldo (escala própria, ajustada aos valores)
  const bal = rows.map((r) => r.balance);
  const ticks2 = niceRange(Math.min(...bal), Math.max(...bal)); // escala ajustada aos saldos (painel próprio, sem eixo duplo)
  const lo2 = ticks2[0], hi2 = ticks2[ticks2.length - 1];
  const Y2 = (v: number) => top2 + (1 - (v - lo2) / (hi2 - lo2 || 1)) * h2;
  const ci = rows.findIndex((r) => r.month === current);
  const path = (from: number, to: number) => rows.slice(from, to + 1).map((r, k) => `${k ? "L" : "M"}${cx(from + k).toFixed(1)},${Y2(r.balance).toFixed(1)}`).join("");
  const lastPast = ci >= 0 ? ci : rows[0].month > current ? -1 : rows.length - 1;
  const past = lastPast >= 0 ? path(0, lastPast) : "";
  const future = lastPast < rows.length - 1 ? path(Math.max(0, lastPast), rows.length - 1) : "";
  const net = s.income - s.expense;

  return (
    <figure class="chart flow">
      <div class="flow-detail" aria-live="polite">
        <span class="fd-month">
          {sel === null
            ? <>Período todo · {monthShort(rows[0].month)} – {monthShort(last.month)}</>
            : <>{monthLong(s.month)}{s.month > current ? " · previsto" : s.month === current ? " · em andamento" : ""}</>}
          {sel !== null
            ? <button type="button" class="fd-close" onClick={() => setSel(null)}>ver período todo ✕</button>
            : <small class="fd-hint">toque num mês para ver só ele</small>}
        </span>
        <div class="fd-grid">
          <span><i class="sw income" />Receitas<b class="num">{money(s.income)}</b></span>
          <span><i class="sw expense" />Despesas<b class="num">{money(s.expense)}</b></span>
          <span>Resultado<b class={`num ${net < 0 ? "expense" : "income"}`}>{net >= 0 ? "+" : "−"}{money(Math.abs(net))}</b></span>
          <span><i class="sw line" />{sel === null ? `Saldo em ${monthShort(last.month)}` : "Saldo no fim"}<b class="num">{money(s.balance)}</b></span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={rows.map((r) => `${monthShort(r.month)}: receitas ${money(r.income)}, despesas ${money(r.expense)}, saldo no fim ${money(r.balance)}`).join("; ")}>
        {/* coluna selecionada */}
        {sel !== null && <rect x={left + sel * slot + 1} y={top1 - 8} width={slot - 2} height={H - bottomPad - top1 + 8} rx={8} class="sel-band" />}

        {/* painel 1 */}
        <text x={4} y={top1 - 16} class="panel-title">Receitas × despesas</text>
        {[0, 0.5, 1].map((f) => (
          <g key={`a${f}`}>
            <line x1={left} x2={W - right} y1={base1 - f * h1} y2={base1 - f * h1} class="grid" />
            <text x={left - 6} y={base1 - f * h1 + 3.5} class="tick" text-anchor="end">{moneyShort(max1 * f)}</text>
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={`b${r.month}`}>
            <path d={barPath(cx(i) - bw - 1, bw, base1, y1(r.income))} class={`bar income ${r.month > current ? "future" : ""}`} />
            <path d={barPath(cx(i) + 1, bw, base1, y1(r.expense))} class={`bar expense ${r.month > current ? "future" : ""}`} />
          </g>
        ))}

        {/* painel 2 */}
        <text x={4} y={top2 - 20} class="panel-title">Saldo no fim do mês</text>
        {ticks2.map((t, i) => (
          <g key={`c${i}`}>
            <line x1={left} x2={W - right} y1={Y2(t)} y2={Y2(t)} class={t === 0 ? "zero" : "grid"} />
            <text x={left - 6} y={Y2(t) + 3.5} class="tick" text-anchor="end">{moneyShort(t)}</text>
          </g>
        ))}
        {past && <path d={past} class="line" />}
        {future && <path d={future} class="line future" />}
        {rows.map((r, i) => (
          <circle key={`p${r.month}`} cx={cx(i)} cy={Y2(r.balance)} r={i === sel ? 5.5 : 3.5} class={`pt ${r.month > current ? "future" : ""} ${i === sel ? "sel" : ""}`} />
        ))}

        {/* eixo de meses + áreas de toque */}
        {rows.map((r, i) => (
          <g key={`x${r.month}`} class="hit" onClick={() => toggle(i)}>
            <rect x={left + i * slot} y={0} width={slot} height={H} fill="transparent" />
            {(rows.length <= 6 || i % 2 === (rows.length - 1) % 2) && (
              <text x={cx(i)} y={H - 5} class={`tick ${r.month === current ? "now" : ""} ${i === sel ? "selx" : ""}`} text-anchor="middle">{monthShort(r.month).slice(0, 3)}</text>
            )}
          </g>
        ))}
      </svg>
      <div class="legend flow-legend">
        <span><i class="sw income" />Receitas</span><span><i class="sw expense" />Despesas</span>
        <span><i class="sw line" />Saldo</span><span class="muted">claro/tracejado = previsto</span>
      </div>
    </figure>
  );
}
