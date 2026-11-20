import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Store } from "../app";
import { addMonths, monthDiff, monthLong, monthShort, thisMonth } from "../dates";
import { balanceByMonth, byCategory, byProperty, byPurpose, expenseByNature, monthItems, monthTotals, type Item } from "../engine";
import { PROPERTY_KIND, colorOf, isInvestment, money, moneyCompact, reais, signedMoney } from "../model";
import { FlowBalanceChart, NATURE_LABEL, NatureChart } from "./charts";
import { Icon, type IconName } from "./icons";
import { Simulator } from "./simulator";

/** Duração do período analisado, em meses. */
const LENGTHS = [
  { n: 1, label: "1 mês" },
  { n: 3, label: "3 meses" },
  { n: 6, label: "6 meses" },
  { n: 12, label: "1 ano" },
] as const;
type Len = (typeof LENGTHS)[number]["n"];

const range = (start: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(start, i));
/**
 * Atalhos de período (N = duração):
 *  - Passado: N meses já fechados, terminando no mês anterior
 *  - Atual:   N meses terminando no mês atual (com 1 mês = este mês)
 *  - Futuro:  N meses a partir do próximo mês (só previsto)
 */
type Mode = "past" | "current" | "future";
const startFor = (mode: Mode, n: number) => {
  const cur = thisMonth();
  return mode === "past" ? addMonths(cur, -n) : mode === "current" ? addMonths(cur, -(n - 1)) : addMonths(cur, 1);
};
const modeOf = (start: string, n: number): Mode | null =>
  (["past", "current", "future"] as const).find((m) => startFor(m, n) === start) ?? null;
const MODE_LABEL: Record<Mode, (n: number) => string> = {
  past: (n) => (n === 1 ? "Mês passado" : "Passado"),
  current: (n) => (n === 1 ? "Este mês" : "Até este mês"),
  future: (n) => (n === 1 ? "Próximo mês" : "Futuro"),
};

// Lembra o período escolhido ao trocar de aba (a tela é desmontada).
let remembered: { n: Len; start: string } | null = null;

export function Stats({ store }: { store: Store }) {
  const { data } = store;
  const [accountId, setAccountId] = useState("");
  const [flow, setFlow] = useState<"expense" | "income">("expense");
  const [table, setTable] = useState(false);
  const [natTable, setNatTable] = useState(false);
  const [purTable, setPurTable] = useState(false);
  const [period, setPeriodState] = useState<{ n: Len; start: string }>(remembered ?? { n: 1, start: store.month });
  const setPeriod = (p: { n: Len; start: string }) => { remembered = p; setPeriodState(p); };
  const acc = accountId || undefined;
  const cur = thisMonth();

  const { n, start } = period;
  const months = range(start, n);
  const end = months[months.length - 1];
  const prevMonths = range(addMonths(start, -n), n);
  const when = end < cur ? "já fechado" : start > cur ? "previsto" : n === 1 ? "em andamento" : "inclui o mês atual (em andamento)";
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
  // despesas do período incluem a estimativa de gastos variáveis ainda não lançados (mês atual e futuros)
  const expenseAll = tot.expense + tot.estimate;
  const result = tot.income - expenseAll;

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
    return { month: m, income: t.income, expense: t.expense + t.estimate, committed: nt.fixed + nt.installment };
  });
  const balance = balanceByMonth(data, chartMonths[0], chartMonths[chartMonths.length - 1], acc);
  const flowRows = perMonth.map((r, i) => ({ ...r, balance: balance[i].balance }));
  // Saldo no início (fim do mês anterior ao período) e no fim do período
  const [balStart, ...balRest] = balanceByMonth(data, addMonths(start, -1), end, acc);
  const balEnd = balRest[balRest.length - 1] ?? balStart;

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

  // Custo × investimento
  const pur = byPurpose(data, items, acc);
  const purPrev = byPurpose(data, prevItems, acc);
  const purTotal = pur.cost + pur.investment;
  const purRows = chartMonths.map((m) => ({ month: m, ...byPurpose(data, filterAcc(monthItems(data, m)), acc) }));

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const vsPrev = (v: number, p: number) => (p ? `${signedMoney(v - p)} vs ${prevLabel}` : "");
  const ratio = tot.income > 0 ? expenseAll / tot.income : expenseAll > 0 ? 1.01 : 0;
  const hasPrev = prevTot.income + prevTot.expense > 0;

  return (
    <>
      <header class="page-head"><h1>Análises</h1></header>

      {/* ---------- Período (cartão de destaque) ---------- */}
      <section class="hero hero-stats">
        <div class="glass-seg" role="group" aria-label="Duração do período">
          {LENGTHS.map((l) => (
            <button key={l.n} type="button" class={n === l.n ? "on" : ""} aria-pressed={n === l.n}
              onClick={() => setPeriod({ n: l.n, start: startFor(modeOf(start, n) ?? "current", l.n) })}>{l.label}</button>
          ))}
        </div>
        <div class="hero-nav">
          <button type="button" class="glass-btn" aria-label="Período anterior" onClick={() => setPeriod({ n, start: addMonths(start, -n) })}><Icon name="chevL" /></button>
          <div>
            <h1>{label}</h1>
            <span class="hero-when">{when}</span>
          </div>
          <button type="button" class="glass-btn" aria-label="Próximo período" onClick={() => setPeriod({ n, start: addMonths(start, n) })}><Icon name="chevR" /></button>
        </div>
        <div class="glass-chips" role="group" aria-label="Atalhos de período">
          {(["past", "current", "future"] as const).map((m) => (
            <button key={m} type="button" class={modeOf(start, n) === m ? "on" : ""} aria-pressed={modeOf(start, n) === m}
              onClick={() => setPeriod({ n, start: startFor(m, n) })}>{MODE_LABEL[m](n)}</button>
          ))}
        </div>

        <p class="hero-label">Resultado do período</p>
        <div class="hero-amount num">{money(result)}</div>
        <div class="hero-sub">
          {tot.income ? <><b>{pct(result, tot.income)}%</b> das receitas {result >= 0 ? "sobram" : "faltam"}</> : "sem receitas no período"}
          {hasPrev && <> · {signedMoney(result - (prevTot.income - prevTot.expense))} vs {prevLabel}</>}
        </div>
        {pur.investment > 0 && <div class="hero-sub">Investido no período <b class="num">{money(pur.investment)}</b> (já descontado do resultado)</div>}
        <div class="hero-tiles">
          <div class="tile">
            <span class="tile-head"><span class="tile-icon in"><Icon name="down" /></span>Receitas</span>
            <b class="num">{money(tot.income)}</b>
            <small>{vsPrev(tot.income, prevTot.income) || " "}</small>
          </div>
          <div class="tile">
            <span class="tile-head"><span class="tile-icon out"><Icon name="up" /></span>Despesas</span>
            <b class="num">{money(expenseAll)}</b>
            <small>{tot.estimate ? `inclui ${moneyCompact(tot.estimate)} estimado` : vsPrev(tot.expense, prevTot.expense) || " "}</small>
          </div>
        </div>
        {(tot.income > 0 || tot.expense > 0) && (
          <div class="spend">
            <div class={`spend-bar ratio ${ratio > 1 ? "over" : ""}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}
              aria-label="Despesas em relação às receitas"><div style={{ width: `${Math.min(1, ratio) * 100}%` }} /></div>
            <div class="spend-text">
              <span>{tot.income > 0 ? `despesas = ${Math.round(ratio * 100)}% das receitas` : "sem receitas"}</span>
              {n === 1
                ? <span>falta pagar <b class="num">{money(tot.expense - tot.expensePaid + tot.bills)}</b></span>
                : <span>média <b class="num">{money(Math.round(expenseAll / avgMonths))}</b>/mês{avgNote}</span>}
            </div>
          </div>
        )}
      </section>

      {data.accounts.filter((a) => !a.archived).length > 1 && (
        <div class="chips scroll" role="group" aria-label="Conta">
          <button type="button" class={`chip ${!acc ? "on" : ""}`} onClick={() => setAccountId("")}>Todas as contas</button>
          {data.accounts.filter((a) => !a.archived).map((a) => (
            <button key={a.id} type="button" class={`chip ${acc === a.id ? "on" : ""}`} onClick={() => setAccountId(a.id)}><i class="sw" style={{ background: a.color }} />{a.name}</button>
          ))}
        </div>
      )}

      {/* ---------- Por categoria ---------- */}
      <section class="card">
        <CardHead icon="tag" tone={flow} title="Por categoria" sub={flow === "expense" ? "Onde o dinheiro foi" : "De onde o dinheiro veio"} />
        <div class="seg wide" role="group" aria-label="Tipo" style={{ marginBottom: "14px" }}>
          <button type="button" class={flow === "expense" ? "on" : ""} onClick={() => setFlow("expense")}>Despesas</button>
          <button type="button" class={flow === "income" ? "on" : ""} onClick={() => setFlow("income")}>Receitas</button>
        </div>
        <div class="total-line">
          <b class="big-total num">{money(totalCat)}</b>
          {prevTotal > 0 && <Delta v={totalCat - prevTotal} flow={flow} suffix={` vs ${n === 1 ? prevLabel : "anterior"}`} />}
        </div>
        {!cats.length && <p class="muted small">Nada no período.</p>}
        <ul class="rank">
          {cats.map((c) => {
            const cat = data.categories.find((x) => x.id === c.categoryId);
            const p = prev.get(c.categoryId) ?? 0;
            const col = colorOf({ id: c.categoryId, color: cat?.color });
            return (
              <li key={c.categoryId}>
                <span class={`avatar ${col}`} aria-hidden="true">{cat?.emoji ?? "•"}</span>
                <div class="rank-main">
                  <div class="rank-top"><span class="name">{cat?.name ?? "Sem categoria"}{isInvestment(cat) && <span class="inv-tag">invest.</span>}</span><b class="num">{money(c.amount)}</b></div>
                  <div class="hbar"><div class={`fill ${col}`} style={{ width: `${(c.amount / cats[0].amount) * 100}%` }} /></div>
                  <div class="rank-meta">
                    <span>{pct(c.amount, totalCat)}%{n > 1 ? ` · ${money(Math.round(c.amount / avgMonths))}/mês` : ""}</span>
                    {p ? <Delta v={c.amount - p} flow={flow} /> : prevTotal ? <span class="delta new">novo</span> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------- Custo × investimento ---------- */}
      <section class="card">
        <CardHead icon="trend" tone="income" title="Custo × investimento" sub="Custo de vida × o que constrói patrimônio" />
        {purTotal === 0 ? <p class="muted small">Sem despesas no período.</p> : (
          <>
            <div class="stack" role="img" aria-label={`Custo ${pct(pur.cost, purTotal)}%, investimento ${pct(pur.investment, purTotal)}%`}>
              {pur.cost > 0 && <div class="seg-cost" style={{ flexGrow: pur.cost }} />}
              {pur.investment > 0 && <div class="seg-inv" style={{ flexGrow: pur.investment }} />}
            </div>
            <div class="purpose-tiles">
              {([["cost", "Custo", "cost"], ["investment", "Investimento", "inv"]] as const).map(([k, l, sw]) => (
                <div key={k} class="nat-tile">
                  <span class="nat-head"><i class={`sw ${sw}`} />{l}</span>
                  <b class="num">{moneyCompact(pur[k])}</b>
                  <small>{tot.income ? `${pct(pur[k], tot.income)}% das receitas` : `${pct(pur[k], purTotal)}% das despesas`}{n > 1 ? ` · ${moneyCompact(Math.round(pur[k] / avgMonths))}/mês` : ""}</small>
                  {purPrev.cost + purPrev.investment > 0 && <Delta v={pur[k] - purPrev[k]} flow={k === "investment" ? "income" : "expense"} compact />}
                </div>
              ))}
            </div>
            {tot.income > 0 && (
              <div class="insight">
                <Icon name="sparkle" />
                <p>{pur.investment > 0
                  ? <>Somando o que sobrou com o que foi investido, <b class="num">{money(result + pur.investment)}</b> (<b>{pct(result + pur.investment, tot.income)}%</b> das receitas) ficaram para o futuro.</>
                  : <>Nenhuma despesa de investimento no período. Marque categorias como investimento em Ajustes → Categorias.</>}</p>
              </div>
            )}
          </>
        )}
        <div class="sub-head"><span>{n === 1 ? `6 meses até ${monthShort(start)}` : "Mês a mês"}</span>
          <button type="button" class="link" onClick={() => setPurTable(!purTable)}>{purTable ? "ocultar tabela" : "ver tabela"}</button></div>
        {purTable && (
          <div class="table-wrap">
            <table class="ptable">
              <thead><tr><th>R$</th><th>Custo</th><th>Invest.</th><th>% invest.</th></tr></thead>
              <tbody>{purRows.map((r) => (
                <tr key={r.month}><td>{monthShort(r.month)}</td><td>{reais(r.cost)}</td><td>{reais(r.investment)}</td><td>{pct(r.investment, r.cost + r.investment)}%</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- Fixas × variáveis ---------- */}
      <section class="card">
        <CardHead icon="layers" tone="brand" title="Fixas × variáveis" sub="Fixas = recorrentes · parceladas = parcelas · variáveis = únicas" />
        {natTotal === 0 ? <p class="muted small">Sem despesas no período.</p> : (
          <>
            <div class="stack" role="img" aria-label={(["fixed", "installment", "variable"] as const).map((k) => `${NATURE_LABEL[k]} ${pct(nat[k], natTotal)}%`).join(", ")}>
              {(["fixed", "installment", "variable"] as const).filter((k) => nat[k] > 0).map((k) => <div key={k} class={`seg-${k}`} style={{ flexGrow: nat[k] }} />)}
            </div>
            <div class="nat-tiles">
              {(["fixed", "installment", "variable"] as const).map((k) => (
                <div key={k} class="nat-tile">
                  <span class="nat-head"><i class={`sw ${k}`} />{NATURE_LABEL[k]}</span>
                  <b class="num">{moneyCompact(nat[k])}</b>
                  <small>{pct(nat[k], natTotal)}%{n > 1 ? ` · ${moneyCompact(Math.round(nat[k] / avgMonths))}/mês` : ""}</small>
                  {natPrev.fixed + natPrev.installment + natPrev.variable > 0 && <Delta v={nat[k] - natPrev[k]} flow="expense" compact />}
                </div>
              ))}
            </div>
            {tot.income > 0 && (
              <div class="insight">
                <Icon name="sparkle" />
                <p><b>{pct(nat.fixed + nat.installment, tot.income)}%</b> das receitas já estão comprometidas com fixas e parcelas
                  (<span class="num">{money(nat.fixed + nat.installment)}</span>). As variáveis consomem <b>{pct(nat.variable, tot.income)}%</b>.</p>
              </div>
            )}
          </>
        )}
        <div class="sub-head"><span>{n === 1 ? `6 meses até ${monthShort(start)}` : "Mês a mês"}</span>
          <button type="button" class="link" onClick={() => setNatTable(!natTable)}>{natTable ? "ocultar tabela" : "ver tabela"}</button></div>
        <NatureChart rows={natRows} current={cur} />
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

      {/* ---------- Imóveis ---------- */}
      {data.properties.length > 0 && (
        <section class="card">
          <CardHead icon="home" tone="brand" title="Custos por imóvel" sub="Total no período · média desde o 1º custo" />
          <ul class="rank">
            {propRows.map(({ p, total, first, count }) => (
              <li key={p.id}>
                <span class={`avatar ${colorOf(p)}`} aria-hidden="true">{PROPERTY_KIND[p.kind].emoji}</span>
                <div class="rank-main">
                  <div class="rank-top"><span class="name">{p.name}</span><b class="num">{money(total)}</b></div>
                  <div class="hbar"><div class={`fill ${colorOf(p)}`} style={{ width: `${(total / propMax) * 100}%` }} /></div>
                  <div class="rank-meta">
                    <span>{!first ? "sem custos no período" : n === 1 ? PROPERTY_KIND[p.kind].label : `média ${money(Math.round(total / count))}/mês${count < n ? ` · desde ${monthShort(first)}` : ""}`}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- Fluxo e saldo ---------- */}
      <section class="card">
        <CardHead icon="trend" tone="brand" title="Fluxo e saldo" sub={n === 1 ? `6 meses até ${monthShort(start)}` : label}
          right={<button type="button" class="link" onClick={() => setTable(!table)}>{table ? "ocultar tabela" : "ver tabela"}</button>} />
        <div class="bal-sum">
          <div><span>Saldo em {monthShort(addMonths(start, -1))}</span><b class="num">{money(balStart.balance)}</b></div>
          <Icon name="chevR" class="bal-arrow" />
          <div><span>Saldo em {monthShort(end)}{end > cur ? " (previsto)" : ""}</span><b class="num">{money(balEnd.balance)}</b></div>
          <span class={`delta ${balEnd.balance - balStart.balance >= 0 ? "good" : "bad"}`}>{balEnd.balance - balStart.balance >= 0 ? "▲" : "▼"} {money(Math.abs(balEnd.balance - balStart.balance))}</span>
        </div>
        <FlowBalanceChart key={chartMonths[0] + n} rows={flowRows} current={cur} />
        {table && (
          <div class="table-wrap">
            <table>
              <thead><tr><th>R$</th><th>Receitas</th><th>Despesas</th><th>Result.</th><th>Saldo fim</th></tr></thead>
              <tbody>{flowRows.map((r) => (
                <tr key={r.month}><td>{monthShort(r.month)}{r.month > cur ? "°" : ""}</td><td>{reais(r.income)}</td><td>{reais(r.expense)}</td>
                  <td class={r.income - r.expense < 0 ? "expense" : ""}>{reais(r.income - r.expense)}</td><td>{reais(r.balance)}</td></tr>
              ))}</tbody>
            </table>
            <p class="muted small">° meses futuros (previsto: recorrentes, parcelas, pendentes e gastos variáveis estimados{data.variable.months ? ` — média de ${money(data.variable.avg)}/mês` : ""}).</p>
          </div>
        )}
      </section>

      {/* ---------- Simulação ---------- */}
      <Simulator store={store} />
    </>
  );
}

/** Cabeçalho de card: ícone em quadradinho colorido + título (+ subtítulo e ação à direita). */
function CardHead({ icon, tone, title, sub, right }: { icon: IconName; tone: "expense" | "income" | "brand"; title: string; sub?: string; right?: ComponentChildren }) {
  return (
    <div class="card-head2">
      <span class={`head-ic ${tone}`}><Icon name={icon} /></span>
      <div class="head-txt"><h2>{title}</h2>{sub && <small>{sub}</small>}</div>
      {right && <div class="head-right">{right}</div>}
    </div>
  );
}

/** Variação com seta e cor (texto, nunca só cor): gastar mais = alerta; receber mais = bom. */
function Delta({ v, flow, suffix = "", compact }: { v: number; flow: "expense" | "income"; suffix?: string; compact?: boolean }) {
  if (Math.abs(v) < 1) return <span class="delta flat">= {suffix.trim()}</span>;
  const good = flow === "income" ? v > 0 : v < 0;
  return <span class={`delta ${good ? "good" : "bad"}`}>{v > 0 ? "▲" : "▼"} {(compact ? moneyCompact : money)(Math.abs(v))}{suffix}</span>;
}
