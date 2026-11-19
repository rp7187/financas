import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, monthDiff, monthLong, monthShort, thisMonth } from "../dates";
import { balanceByMonth, byCategory, byProperty, expenseByNature, monthItems, monthTotals, type Item } from "../engine";
import { PROPERTY_KIND, money, reais, signedMoney } from "../model";
import { BalanceChart, IncomeExpenseChart, NATURE_LABEL, NatureChart } from "./charts";
import { Icon } from "./icons";

/** Duração do período analisado, em meses. */
const LENGTHS = [
  { n: 1, label: "1 mês" },
  { n: 3, label: "3 meses" },
  { n: 6, label: "6 meses" },
  { n: 12, label: "1 ano" },
] as const;
type Len = (typeof LENGTHS)[number]["n"];

const range = (start: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(start, i));
/** Período "passado" termina no mês atual; "futuro" começa no próximo. */
const pastStart = (n: number) => addMonths(thisMonth(), -(n - 1));
const futureStart = () => addMonths(thisMonth(), 1);

// Lembra o período escolhido ao trocar de aba (a tela é desmontada).
let remembered: { n: Len; start: string } | null = null;

export function Stats({ store }: { store: Store }) {
  const { data } = store;
  const [accountId, setAccountId] = useState("");
  const [flow, setFlow] = useState<"expense" | "income">("expense");
  const [table, setTable] = useState(false);
  const [natTable, setNatTable] = useState(false);
  const [period, setPeriodState] = useState<{ n: Len; start: string }>(remembered ?? { n: 1, start: store.month });
  const setPeriod = (p: { n: Len; start: string }) => { remembered = p; setPeriodState(p); };
  const acc = accountId || undefined;
  const cur = thisMonth();

  const { n, start } = period;
  const months = range(start, n);
  const end = months[months.length - 1];
  const prevMonths = range(addMonths(start, -n), n);
  const when = end < cur ? "passado" : start > cur ? "futuro · previsto" : n === 1 ? "mês atual" : "inclui o mês atual";
  const label = n === 1 ? monthLong(start) : `${monthShort(start)} – ${monthShort(end)}`;
  // Meses "com histórico": do 1º lançamento em diante (médias não são diluídas por meses sem uso do app).
  const firstData = [...data.txns.map((t) => t.date.slice(0, 7)), ...data.rules.map((r) => r.startMonth)].sort()[0] ?? cur;
  const avgMonths = Math.max(1, months.filter((m) => m >= firstData).length);
  const avgNote = avgMonths < n ? ` (${avgMonths} ${avgMonths === 1 ? "mês" : "meses"} com dados)` : "";
  const prevLabel = n === 1 ? monthShort(prevMonths[0]) : "anterior"; // "vs anterior" = mesmo nº de meses logo antes

  const collect = (ms: string[]): Item[] => ms.flatMap((m) => monthItems(data, m));
  const filterAcc = (its: Item[]) => (acc ? its.filter((i) => i.txn.accountId === acc || i.txn.toAccountId === acc) : its);
  const items = filterAcc(collect(months));
  const prevItems = filterAcc(collect(prevMonths));
  // Gráficos: com 1 mês, mostram os 6 meses até ele para dar contexto.
  const chartMonths = n === 1 ? range(addMonths(start, -5), 6) : months;

  // Resumo do período
  const tot = monthTotals(items, acc);
  const prevTot = monthTotals(prevItems, acc);
  const result = tot.income - tot.expense;

  // Por categoria
  const cats = byCategory(items, flow, acc);
  const prev = new Map(byCategory(prevItems, flow, acc).map((c) => [c.categoryId, c.amount]));
  const totalCat = cats.reduce((s, c) => s + c.amount, 0);
  const prevTotal = [...prev.values()].reduce((s, v) => s + v, 0);

  // Fixas × parceladas × variáveis
  const nat = expenseByNature(items, acc);
  const natPrev = expenseByNature(prevItems, acc);
  const natTotal = nat.fixed + nat.installment + nat.variable;
  const natRows = chartMonths.map((m) => ({ month: m, ...expenseByNature(monthItems(data, m), acc) }));

  // Mês a mês
  const perMonth = chartMonths.map((m) => {
    const its = monthItems(data, m);
    const t = monthTotals(its, acc);
    const nt = expenseByNature(its, acc);
    return { month: m, income: t.income, expense: t.expense, committed: nt.fixed + nt.installment };
  });
  const balance = balanceByMonth(data, chartMonths[0], chartMonths[chartMonths.length - 1], acc);

  // Imóveis: total no período; média só sobre os meses desde o 1º custo dentro do período
  const propTotal = new Map<string, number>();
  const propFirst = new Map<string, string>();
  for (const m of months) {
    for (const [id, v] of byProperty(filterAcc(monthItems(data, m)))) {
      propTotal.set(id, (propTotal.get(id) ?? 0) + v);
      if (!propFirst.has(id)) propFirst.set(id, m);
    }
  }
  const propRows = data.properties.filter((p) => propTotal.has(p.id) || !p.archived)
    .map((p) => {
      const first = propFirst.get(p.id);
      return { p, total: propTotal.get(p.id) ?? 0, first, count: first ? monthDiff(first, end) + 1 : 0 };
    })
    .sort((a, b) => b.total - a.total);
  const propMax = Math.max(1, ...propRows.map((r) => r.total));

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const vsPrev = (v: number, p: number) => (p ? `${signedMoney(v - p)} vs ${prevLabel}` : "");

  return (
    <>
      <header class="page-head"><h1>Análises</h1></header>

      <section class="card period">
        <div class="seg wide" role="group" aria-label="Duração do período">
          {LENGTHS.map((l) => (
            <button key={l.n} type="button" class={n === l.n ? "on" : ""} aria-pressed={n === l.n}
              onClick={() => setPeriod({ n: l.n, start: l.n === 1 ? (start > cur ? futureStart() : cur) : start > cur ? futureStart() : pastStart(l.n) })}>{l.label}</button>
          ))}
        </div>
        <div class="mini-nav">
          <button type="button" class="icon-btn" aria-label="Período anterior" onClick={() => setPeriod({ n, start: addMonths(start, -n) })}><Icon name="chevL" /></button>
          <span class="period-label"><b>{label}</b><small>{when}</small></span>
          <button type="button" class="icon-btn" aria-label="Próximo período" onClick={() => setPeriod({ n, start: addMonths(start, n) })}><Icon name="chevR" /></button>
        </div>
        <div class="quick">
          <button type="button" class={`chip ${end === cur ? "on" : ""}`} onClick={() => setPeriod({ n, start: pastStart(n) })}>Passado{n > 1 ? ` (últimos ${n === 12 ? "12" : n})` : " (este mês)"}</button>
          <button type="button" class={`chip ${start === futureStart() ? "on" : ""}`} onClick={() => setPeriod({ n, start: futureStart() })}>Futuro{n > 1 ? ` (próximos ${n === 12 ? "12" : n})` : " (próximo mês)"}</button>
        </div>
        <div class="period-sum">
          <div><span>Receitas</span><b class="num income">{money(tot.income)}</b><small>{vsPrev(tot.income, prevTot.income)}</small></div>
          <div><span>Despesas</span><b class="num expense">{money(tot.expense)}</b><small>{vsPrev(tot.expense, prevTot.expense)}</small></div>
          <div><span>Resultado</span><b class={`num ${result < 0 ? "expense" : ""}`}>{money(result)}</b><small>{tot.income ? `${pct(result, tot.income)}% das receitas` : ""}</small></div>
          <div><span>Despesa média</span><b class="num">{money(Math.round(tot.expense / avgMonths))}</b><small>por mês{avgNote}</small></div>
        </div>
      </section>

      {data.accounts.filter((a) => !a.archived).length > 1 && (
        <div class="chips scroll" role="group" aria-label="Conta">
          <button type="button" class={`chip ${!acc ? "on" : ""}`} onClick={() => setAccountId("")}>Todas as contas</button>
          {data.accounts.filter((a) => !a.archived).map((a) => (
            <button key={a.id} type="button" class={`chip ${acc === a.id ? "on" : ""}`} onClick={() => setAccountId(a.id)}><i class="sw" style={{ background: a.color }} />{a.name}</button>
          ))}
        </div>
      )}

      <section class="card">
        <div class="card-title">
          <h2>Por categoria</h2>
          <div class="seg small" role="group" aria-label="Tipo">
            <button type="button" class={flow === "expense" ? "on" : ""} onClick={() => setFlow("expense")}>Despesas</button>
            <button type="button" class={flow === "income" ? "on" : ""} onClick={() => setFlow("income")}>Receitas</button>
          </div>
        </div>
        <div class="big-total num">{money(totalCat)}</div>
        <p class="muted small" style={{ margin: 0 }}>{prevTotal ? `${signedMoney(totalCat - prevTotal)} vs ${n === 1 ? prevLabel : "período anterior"}` : `sem dados ${n === 1 ? `em ${prevLabel}` : "no período anterior"}`}</p>
        {!cats.length && <p class="muted">Nada no período.</p>}
        <ul class="cat-bars">
          {cats.map((c) => {
            const cat = data.categories.find((x) => x.id === c.categoryId);
            const p = prev.get(c.categoryId) ?? 0;
            return (
              <li key={c.categoryId}>
                <div class="cat-line">
                  <span class="name"><span class="em">{cat?.emoji ?? "•"}</span>{cat?.name ?? "Sem categoria"}</span>
                  <b class="num">{money(c.amount)}</b>
                </div>
                <div class="hbar"><div class={`fill ${flow}`} style={{ width: `${(c.amount / cats[0].amount) * 100}%` }} /></div>
                <small class="muted">{pct(c.amount, totalCat)}% do total{n > 1 ? ` · ${money(Math.round(c.amount / avgMonths))}/mês` : ""}{p ? ` · ${signedMoney(c.amount - p)} vs ${prevLabel}` : prevTotal ? " · novo" : ""}</small>
              </li>
            );
          })}
        </ul>
      </section>

      <section class="card">
        <h2>Fixas × variáveis</h2>
        <p class="muted small" style={{ marginTop: "-6px" }}>Fixas = recorrentes mensais · parceladas = parcelas de compras · variáveis = lançamentos únicos.</p>
        {natTotal === 0 ? <p class="muted">Sem despesas no período.</p> : (
          <>
            <div class="stack" role="img" aria-label={(["fixed", "installment", "variable"] as const).map((k) => `${NATURE_LABEL[k]} ${pct(nat[k], natTotal)}%`).join(", ")}>
              {(["fixed", "installment", "variable"] as const).filter((k) => nat[k] > 0).map((k) => <div key={k} class={`seg-${k}`} style={{ flexGrow: nat[k] }} />)}
            </div>
            <ul class="nature-rows">
              {(["fixed", "installment", "variable"] as const).map((k) => (
                <li key={k}>
                  <i class={`sw ${k}`} />
                  <span class="lbl">{NATURE_LABEL[k]}<small>{pct(nat[k], natTotal)}% das despesas{n > 1 ? ` · ${money(Math.round(nat[k] / avgMonths))}/mês` : ""}</small></span>
                  <span class="vals"><b class="num">{money(nat[k])}</b><small>{natPrev.fixed + natPrev.installment + natPrev.variable > 0 ? `${signedMoney(nat[k] - natPrev[k])} vs ${prevLabel}` : " "}</small></span>
                </li>
              ))}
            </ul>
            {tot.income > 0 && (
              <p class="insight">
                Fixas + parceladas (já comprometidas) somam <b class="num">{money(nat.fixed + nat.installment)}</b>,
                ou <b>{pct(nat.fixed + nat.installment, tot.income)}%</b> das receitas do período. As variáveis consomem <b>{pct(nat.variable, tot.income)}%</b>.
              </p>
            )}
          </>
        )}
        <h2 style={{ marginTop: "18px" }}>{n === 1 ? "6 meses até " + monthShort(start) : "Mês a mês"}</h2>
        <NatureChart rows={natRows} current={cur} />
        <button type="button" class="link" onClick={() => setNatTable(!natTable)}>{natTable ? "Ocultar tabela" : "Ver tabela"}</button>
        {natTable && (
          <div class="table-wrap">
            <table>
              <thead><tr><th>R$</th><th>Fixas</th><th>Parcel.</th><th>Variáveis</th><th>Total</th></tr></thead>
              <tbody>{natRows.map((r) => (
                <tr key={r.month}><td>{monthShort(r.month)}</td><td>{reais(r.fixed)}</td><td>{reais(r.installment)}</td><td>{reais(r.variable)}</td><td>{reais(r.fixed + r.installment + r.variable)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {data.properties.length > 0 && (
        <section class="card">
          <h2>Custos por imóvel</h2>
          <p class="muted small" style={{ marginTop: "-6px" }}>Total no período; a média mensal conta só os meses desde o 1º custo do imóvel.</p>
          <ul class="cat-bars">
            {propRows.map(({ p, total, first, count }) => (
              <li key={p.id}>
                <div class="cat-line">
                  <span class="name"><span class="em">{PROPERTY_KIND[p.kind].emoji}</span>{p.name}</span>
                  <b class="num">{money(total)}</b>
                </div>
                <div class="hbar"><div class="fill brand" style={{ width: `${(total / propMax) * 100}%` }} /></div>
                <small class="muted">
                  {!first ? "sem custos no período"
                    : n === 1 ? ""
                    : `média ${money(Math.round(total / count))}/mês${count < n ? ` (desde ${monthShort(first)}, ${count} ${count === 1 ? "mês" : "meses"})` : ""}`}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="card">
        <h2>Receitas × despesas</h2>
        <p class="muted small" style={{ marginTop: "-6px" }}>{n === 1 ? `6 meses até ${monthShort(start)}` : label}</p>
        <IncomeExpenseChart rows={perMonth} current={cur} />
        <button type="button" class="link" onClick={() => setTable(!table)}>{table ? "Ocultar tabela" : "Ver tabela"}</button>
        {table && (
          <div class="table-wrap">
            <table>
              <thead><tr><th>R$</th><th>Receitas</th><th>Despesas</th><th>Fixas*</th><th>Saldo</th></tr></thead>
              <tbody>{perMonth.map((r) => (
                <tr key={r.month}><td>{monthShort(r.month)}{r.month > cur ? "°" : ""}</td><td>{reais(r.income)}</td><td>{reais(r.expense)}</td><td>{reais(r.committed)}</td><td class={r.income - r.expense < 0 ? "expense" : ""}>{reais(r.income - r.expense)}</td></tr>
              ))}</tbody>
            </table>
            <p class="muted small">*Fixas + parceladas (já comprometido). ° meses futuros (previsto).</p>
          </div>
        )}
      </section>

      <section class="card">
        <h2>Saldo no fim do mês</h2>
        <p class="muted small" style={{ marginTop: "-6px" }}>{n === 1 ? `6 meses até ${monthShort(start)}` : label} · tracejado = previsão (recorrentes, parcelas e pendentes)</p>
        <BalanceChart rows={balance} current={cur} />
      </section>
    </>
  );
}
