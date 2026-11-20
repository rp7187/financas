import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, addMonthsToDate, monthDiff, monthLong, monthShort, thisMonth, todayISO } from "../dates";
import { balanceByMonth, committedByPurpose, monthItems, monthTotals } from "../engine";
import { isCard, isInvestment, money, moneyShort, uid, type Plan, type Rule, type Txn } from "../model";
import { Icon } from "./icons";
import { MoneyInput } from "./sheet";

/*
 * Simulação de dívida/investimento: compara o saldo projetado (que já inclui recorrentes, parcelas, faturas e a
 * estimativa de gastos variáveis) com e sem a nova parcela. Nada é gravado até "Lançar de verdade".
 */

type Sim = { description: string; entry: number; parcel: number; count: string; endless: boolean; start: string; categoryId: string; accountId: string };
// Lembra a simulação ao trocar de aba (a tela é desmontada).
let remembered: Sim | null = null;

const MAX_MONTHS = 60;

export function Simulator({ store }: { store: Store }) {
  const { data } = store;
  const cur = thisMonth();
  const cats = data.categories.filter((c) => c.type === "expense" && !c.archived);
  const accounts = data.accounts.filter((a) => !a.archived);
  const [open, setOpen] = useState(remembered !== null);
  const [sim, setSimState] = useState<Sim>(remembered ?? {
    description: "", entry: 0, parcel: 0, count: "12", endless: false, start: addMonths(cur, 1),
    categoryId: "", accountId: accounts.find((a) => !isCard(a))?.id ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (p: Partial<Sim>) => { const next = { ...sim, ...p }; remembered = next; setSimState(next); setMsg(null); };

  const cat = data.categories.find((c) => c.id === sim.categoryId);
  const invest = isInvestment(cat);
  const n = sim.endless ? 0 : Math.max(0, Math.min(120, Math.floor(Number(sim.count) || 0)));
  const start = sim.start < cur ? cur : sim.start;
  const lastParcel = sim.endless ? null : addMonths(start, Math.max(n, 1) - 1);
  // horizonte: até a última parcela (mín. 12 meses, máx. 60); sem fim = 24 meses
  const horizonEnd = sim.endless ? addMonths(cur, 23) : [lastParcel!, addMonths(cur, 11)].sort().reverse()[0];
  const end = monthDiff(cur, horizonEnd) >= MAX_MONTHS ? addMonths(cur, MAX_MONTHS - 1) : horizonEnd;
  const ready = sim.parcel > 0 && (sim.endless || n >= 1);

  // custo da simulação em cada mês do horizonte
  const months = Array.from({ length: monthDiff(cur, end) + 1 }, (_, i) => addMonths(cur, i));
  const simCost = (m: string) =>
    (m === start ? sim.entry : 0) + (m >= start && (sim.endless || m <= lastParcel!) ? sim.parcel : 0);
  const base = balanceByMonth(data, cur, end);
  let acc = 0;
  const rows = months.map((m, i) => { acc += ready ? simCost(m) : 0; return { month: m, base: base[i].balance, sim: base[i].balance - acc }; });
  const minRow = rows.reduce((a, r) => (r.sim < a.sim ? r : a), rows[0]);
  const firstNeg = rows.find((r) => r.sim < 0);

  // médias mensais nos meses das parcelas (até 12): renda, despesas (com estimativa) e comprometido (fixas + parcelas)
  const evalMonths = months.filter((m) => m >= start).slice(0, 12);
  const perM = evalMonths.map((m) => {
    const its = monthItems(data, m);
    const t = monthTotals(its);
    return { income: t.income, expense: t.expense + t.estimate, committed: committedByPurpose(data, its) };
  });
  const avg = (f: (x: (typeof perM)[number]) => number) => (perM.length ? Math.round(perM.reduce((s, x) => s + f(x), 0) / perM.length) : 0);
  const income = avg((x) => x.income);
  const spend = avg((x) => x.expense);
  const comCost = avg((x) => x.committed.cost);
  const comInv = avg((x) => x.committed.investment);
  const slackBefore = income - spend;
  const slackAfter = slackBefore - sim.parcel;
  const pct = (v: number) => (income > 0 ? Math.round((v / income) * 100) : 0);
  const total = sim.entry + (sim.endless ? 0 : sim.parcel * n);

  const verdict = !ready ? null
    : firstNeg ? { tone: "bad", title: "Não cabe", text: `O saldo fica negativo em ${monthLong(firstNeg.month).toLowerCase()} (${money(firstNeg.sim)}).` }
    : slackAfter < 0 ? { tone: "warn", title: "Cabe, mas consome a reserva", text: `Com a parcela, faltam ${money(-slackAfter)} por mês: o saldo cai até ${money(minRow.sim)} em ${monthShort(minRow.month)}.` }
    : income > 0 && slackAfter < income * 0.1 ? { tone: "warn", title: "Cabe, mas fica apertado", text: `Sobram só ${money(slackAfter)} por mês (${pct(slackAfter)}% da renda) depois da parcela.` }
    : { tone: "good", title: "Cabe com folga", text: `Depois da parcela ainda sobram ${money(slackAfter)} por mês (${pct(slackAfter)}% da renda).` };

  async function launch() {
    if (!ready) return;
    if (!sim.categoryId) return setMsg("Escolha a categoria para lançar.");
    if (!sim.accountId) return setMsg("Escolha a conta ou cartão para lançar.");
    const desc = sim.description.trim() || cat?.name || "Simulação";
    const onCard = isCard(data.accounts.find((a) => a.id === sim.accountId));
    const day = todayISO().slice(8, 10);
    const first = `${start}-${day}`;
    const what = sim.endless ? `${money(sim.parcel)} todo mês a partir de ${monthLong(start).toLowerCase()}` : `${n}× de ${money(sim.parcel)} a partir de ${monthLong(start).toLowerCase()}`;
    if (!confirm(`Lançar "${desc}": ${sim.entry ? `entrada de ${money(sim.entry)} + ` : ""}${what}?`)) return;
    const b = { t: "txn" as const, updatedAt: 0, type: "expense" as const, description: desc, categoryId: sim.categoryId, accountId: sim.accountId };
    const recs: (Txn | Plan | Rule)[] = [];
    if (sim.entry > 0) recs.push({ ...b, id: uid(), amount: sim.entry, date: todayISO(), paid: onCard, description: `${desc} (entrada)` });
    if (sim.endless) {
      recs.push({ id: uid(), t: "rule", updatedAt: 0, type: "expense", amount: sim.parcel, description: desc, categoryId: sim.categoryId, accountId: sim.accountId, day: Number(day), startMonth: start });
    } else if (n === 1) {
      recs.push({ ...b, id: uid(), amount: sim.parcel, date: addMonthsToDate(first, 0), paid: onCard });
    } else {
      const plan: Plan = { id: uid(), t: "plan", updatedAt: 0, type: "expense", total: sim.parcel * n, count: n, description: desc, categoryId: sim.categoryId, accountId: sim.accountId, firstDate: addMonthsToDate(first, 0) };
      recs.push(plan, ...Array.from({ length: n }, (_, i): Txn => ({ ...b, id: uid(), amount: sim.parcel, date: addMonthsToDate(first, i), paid: onCard, planId: plan.id, installment: i + 1 })));
    }
    await store.put(recs);
    remembered = null;
    setSimState({ ...sim, description: "", entry: 0, parcel: 0 });
    setMsg(`Lançado! "${desc}" já está na aba Mês e na projeção.`);
  }

  return (
    <section class="card sim">
      <div class="card-head2">
        <span class="head-ic brand"><Icon name="sparkle" /></span>
        <div class="head-txt"><h2>Simular dívida ou investimento</h2><small>Cabe no orçamento? Nada é gravado até você lançar.</small></div>
        <div class="head-right"><button type="button" class="link" onClick={() => setOpen(!open)}>{open ? "fechar" : "simular"}</button></div>
      </div>
      {!open ? null : (
        <>
          <label>Descrição<input type="text" value={sim.description} placeholder="ex.: Apartamento na planta, carro" onInput={(e) => set({ description: e.currentTarget.value })} /></label>
          <div class="two">
            <MoneyInput label="Valor da parcela" value={sim.parcel} onChange={(v) => set({ parcel: v })} />
            <MoneyInput label="Entrada (opcional)" value={sim.entry} onChange={(v) => set({ entry: v })} />
          </div>
          <div class="two">
            <label>Parcelas
              <input type="number" inputMode="numeric" min="1" max="120" value={sim.endless ? "" : sim.count} disabled={sim.endless} placeholder="sem fim" onInput={(e) => set({ count: e.currentTarget.value })} />
            </label>
            <label>1ª parcela em<input type="month" value={sim.start} min={cur} onInput={(e) => set({ start: e.currentTarget.value || cur })} /></label>
          </div>
          <label class="toggle"><input type="checkbox" checked={sim.endless} onChange={(e) => set({ endless: e.currentTarget.checked })} /><span>Todo mês, sem fim (ex.: aporte mensal, aluguel)</span></label>
          <div class="two">
            <label>Categoria
              <select value={sim.categoryId} onChange={(e) => set({ categoryId: e.currentTarget.value })}>
                <option value="">— escolher —</option>
                <optgroup label="Custo">{cats.filter((c) => !isInvestment(c)).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>
                <optgroup label="Investimento">{cats.filter(isInvestment).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</optgroup>
              </select>
            </label>
            <label>Pagar com
              <select value={sim.accountId} onChange={(e) => set({ accountId: e.currentTarget.value })}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{isCard(a) ? " (cartão)" : ""}</option>)}
              </select>
            </label>
          </div>

          {!ready ? <p class="muted small">Informe o valor da parcela para ver o impacto.</p> : (
            <>
              <div class={`verdict ${verdict!.tone}`} role="status">
                <b>{verdict!.title}</b>
                <span>{verdict!.text}</span>
              </div>
              <div class="sim-grid">
                <div><span>Parcela</span><b class="num">{money(sim.parcel)}</b><small>{invest ? "investimento" : "custo"}{sim.endless ? " · todo mês" : ` · ${n}×`}</small></div>
                <div><span>Total</span><b class="num">{sim.endless ? "—" : money(total)}</b><small>{sim.entry ? `com entrada de ${moneyShort(sim.entry)}` : sim.endless ? "sem fim" : `até ${monthShort(lastParcel!)}`}</small></div>
                <div><span>Sobra por mês</span><b class="num">{money(slackAfter)}</b><small>antes {money(slackBefore)}</small></div>
                <div><span>Menor saldo</span><b class={`num ${minRow.sim < 0 ? "neg" : ""}`}>{money(minRow.sim)}</b><small>em {monthShort(minRow.month)}</small></div>
              </div>
              {income > 0 && (
                <div class="commit">
                  <p class="sub-head"><span>Renda comprometida com fixas e parcelas</span></p>
                  <CommitBar label="Hoje" cost={comCost} inv={comInv} income={income} />
                  <CommitBar label="Com a simulação" cost={comCost + (invest ? 0 : sim.parcel)} inv={comInv + (invest ? sim.parcel : 0)} income={income} />
                  <div class="legend"><span><i class="sw cost" />Custo</span><span><i class="sw inv" />Investimento</span></div>
                </div>
              )}
              <SimChart rows={rows} />
              <p class="muted small">
                Projeção a partir do saldo atual, com recorrentes, parcelas, faturas e gastos variáveis estimados
                ({data.variable.months ? `média de ${money(data.variable.avg)}/mês` : "sem histórico ainda"}). Médias de renda e despesas nos {perM.length} primeiros meses da simulação.
              </p>
              <button type="button" class="btn brand wide" onClick={launch}><Icon name="plus" />Lançar de verdade</button>
            </>
          )}
          {msg && <p class="note" role="status">{msg}</p>}
        </>
      )}
    </section>
  );
}

function CommitBar({ label, cost, inv, income }: { label: string; cost: number; inv: number; income: number }) {
  const p = (v: number) => Math.round((v / income) * 100);
  const total = p(cost + inv);
  return (
    <div class="commit-row">
      <span class="commit-label">{label}</span>
      <div class="commit-bar" role="img" aria-label={`${label}: ${total}% da renda (custo ${p(cost)}%, investimento ${p(inv)}%)`}>
        <div class="cost" style={{ width: `${Math.min(100, (cost / income) * 100)}%` }} />
        <div class="inv" style={{ width: `${Math.max(0, Math.min(100 - (cost / income) * 100, (inv / income) * 100))}%` }} />
      </div>
      <b class={`num ${total > 100 ? "neg" : ""}`}>{total}%</b>
    </div>
  );
}

/** Saldo projetado: sem a simulação (linha clara) × com a simulação (linha forte). */
function SimChart({ rows }: { rows: { month: string; base: number; sim: number }[] }) {
  const W = 340, H = 150, left = 40, right = 6, top = 10, bottom = 20;
  const vals = rows.flatMap((r) => [r.base, r.sim]);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi === lo) hi = lo + 100;
  const pad = (hi - lo) * 0.08; lo -= lo < 0 ? pad : 0; hi += pad;
  const x = (i: number) => left + (rows.length === 1 ? (W - left - right) / 2 : (i * (W - left - right)) / (rows.length - 1));
  const y = (v: number) => top + ((hi - v) * (H - top - bottom)) / (hi - lo);
  const path = (k: "base" | "sim") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join("");
  const step = Math.max(1, Math.ceil(rows.length / 6));
  return (
    <figure class="chart">
      <div class="legend"><span><i class="sw base" />Sem a simulação</span><span><i class="sw simline" />Com a simulação</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Saldo projetado: ${rows.filter((_, i) => i % step === 0).map((r) => `${monthShort(r.month)} ${money(r.sim)} (sem: ${money(r.base)})`).join("; ")}`}>
        {[hi, (hi + lo) / 2, lo].map((v) => (
          <g key={v}>
            <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} class="grid" />
            <text x={left - 6} y={y(v) + 3.5} class="tick" text-anchor="end">{moneyShort(v)}</text>
          </g>
        ))}
        {lo < 0 && <line x1={left} x2={W - right} y1={y(0)} y2={y(0)} class="zero" />}
        <path d={path("base")} class="sim-base" />
        <path d={path("sim")} class="sim-line" />
        {rows.map((r, i) => (i % step === 0 || i === rows.length - 1) && (
          <text key={r.month} x={x(i)} y={H - 5} class="tick" text-anchor="middle">{monthShort(r.month)}</text>
        ))}
      </svg>
    </figure>
  );
}
