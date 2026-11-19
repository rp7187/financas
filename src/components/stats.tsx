import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, monthLong, monthShort, thisMonth } from "../dates";
import { balanceByMonth, byCategory, byProperty, monthItems, monthTotals } from "../engine";
import { PROPERTY_KIND, money, reais, signedMoney } from "../model";
import { BalanceChart, IncomeExpenseChart } from "./charts";
import { Icon } from "./icons";

export function Stats({ store }: { store: Store }) {
  const { data, month, setMonth } = store;
  const [accountId, setAccountId] = useState("");
  const [flow, setFlow] = useState<"expense" | "income">("expense");
  const [table, setTable] = useState(false);
  const acc = accountId || undefined;
  const cur = thisMonth();

  const items = monthItems(data, month);
  const prevItems = monthItems(data, addMonths(month, -1));
  const cats = byCategory(items, flow, acc);
  const prev = new Map(byCategory(prevItems, flow, acc).map((c) => [c.categoryId, c.amount]));
  const totalCat = cats.reduce((s, c) => s + c.amount, 0);
  const prevTotal = [...prev.values()].reduce((s, v) => s + v, 0);

  const months12 = Array.from({ length: 12 }, (_, i) => addMonths(cur, i - 11));
  const last12 = months12.map((m) => {
    const t = monthTotals(monthItems(data, m), acc);
    return { month: m, income: t.income, expense: t.expense };
  });
  const balance = balanceByMonth(data, addMonths(cur, -11), addMonths(cur, 6), acc);
  const next6 = Array.from({ length: 6 }, (_, i) => addMonths(cur, i + 1)).map((m) => {
    const its = monthItems(data, m);
    const t = monthTotals(its, acc);
    const committed = its.filter(({ txn: x }) => x.type === "expense" && (x.planId || x.ruleId) && (!acc || x.accountId === acc)).reduce((s, x) => s + x.txn.amount, 0);
    return { month: m, ...t, committed };
  });

  // Imóveis: custo no mês escolhido e nos 12 meses até ele
  const propMonth = byProperty(acc ? items.filter((i) => i.txn.accountId === acc) : items);
  const propYear = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const its = monthItems(data, addMonths(month, -i));
    for (const [id, v] of byProperty(acc ? its.filter((x) => x.txn.accountId === acc) : its)) propYear.set(id, (propYear.get(id) ?? 0) + v);
  }
  const propRows = data.properties.filter((p) => propYear.has(p.id) || !p.archived)
    .map((p) => ({ p, month: propMonth.get(p.id) ?? 0, year: propYear.get(p.id) ?? 0 }))
    .sort((a, b) => b.year - a.year);
  const propMax = Math.max(1, ...propRows.map((r) => r.year));

  const MonthNav = () => (
    <div class="mini-nav">
      <button type="button" class="icon-btn" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}><Icon name="chevL" /></button>
      <span>{monthLong(month)}</span>
      <button type="button" class="icon-btn" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}><Icon name="chevR" /></button>
    </div>
  );

  return (
    <>
      <header class="page-head"><h1>Análises</h1></header>
      {data.accounts.filter((a) => !a.archived).length > 1 && (
        <div class="chips scroll" role="group" aria-label="Conta">
          <button type="button" class={`chip ${!acc ? "on" : ""}`} onClick={() => setAccountId("")}>Todas as contas</button>
          {data.accounts.filter((a) => !a.archived).map((a) => (
            <button key={a.id} type="button" class={`chip ${acc === a.id ? "on" : ""}`} onClick={() => setAccountId(a.id)}><i class="sw" style={{ background: a.color }} />{a.name}</button>
          ))}
        </div>
      )}

      <section class="card">
        <div class="seg wide" role="group" aria-label="Tipo">
          <button type="button" class={flow === "expense" ? "on" : ""} onClick={() => setFlow("expense")}>Despesas</button>
          <button type="button" class={flow === "income" ? "on" : ""} onClick={() => setFlow("income")}>Receitas</button>
        </div>
        <MonthNav />
        <div class="big-total num">{money(totalCat)}</div>
        <p class="muted small" style={{ margin: 0 }}>
          {prevTotal ? `${signedMoney(totalCat - prevTotal)} em relação a ${monthShort(addMonths(month, -1))}` : "sem dados do mês anterior"}
        </p>
        {!cats.length && <p class="muted">Nada neste mês.</p>}
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
                <small class="muted">{Math.round((c.amount / totalCat) * 100)}% do total{p ? ` · ${signedMoney(c.amount - p)} vs mês anterior` : " · novo neste mês"}</small>
              </li>
            );
          })}
        </ul>
      </section>

      {data.properties.length > 0 && (
        <section class="card">
          <h2>Custos por imóvel</h2>
          <p class="muted small" style={{ marginTop: "-6px" }}>{monthLong(month)} e os 12 meses até ele (despesas associadas ao imóvel).</p>
          <ul class="cat-bars">
            {propRows.map(({ p, month: m, year }) => (
              <li key={p.id}>
                <div class="cat-line">
                  <span class="name"><span class="em">{PROPERTY_KIND[p.kind].emoji}</span>{p.name}</span>
                  <b class="num">{money(m)}</b>
                </div>
                <div class="hbar"><div class="fill brand" style={{ width: `${(year / propMax) * 100}%` }} /></div>
                <small class="muted">12 meses: {money(year)} · média {money(Math.round(year / 12))}/mês</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="card">
        <h2>Receitas × despesas</h2>
        <p class="muted small" style={{ marginTop: "-6px" }}>Últimos 12 meses</p>
        <IncomeExpenseChart rows={last12} current={cur} />
        <button type="button" class="link" onClick={() => setTable(!table)}>{table ? "Ocultar tabela" : "Ver tabela"}</button>
        {table && (
          <div class="table-wrap">
            <table>
              <thead><tr><th>R$</th><th>Receitas</th><th>Despesas</th><th>Saldo</th></tr></thead>
              <tbody>{[...last12].reverse().map((r) => (
                <tr key={r.month}><td>{monthShort(r.month)}</td><td>{reais(r.income)}</td><td>{reais(r.expense)}</td><td class={r.income - r.expense < 0 ? "expense" : ""}>{reais(r.income - r.expense)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section class="card">
        <h2>Saldo no fim do mês</h2>
        <p class="muted small" style={{ marginTop: "-6px" }}>12 meses + previsão de 6 (recorrentes, parcelas e pendentes)</p>
        <BalanceChart rows={balance} current={cur} />
      </section>

      <section class="card">
        <h2>Próximos meses</h2>
        <p class="muted small" style={{ marginTop: "-6px" }}>Já previsto. *Fixas = recorrentes + parcelas (já comprometido).</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>R$</th><th>Receitas</th><th>Despesas</th><th>Fixas*</th><th>Saldo</th></tr></thead>
            <tbody>{next6.map((r) => (
              <tr key={r.month}><td>{monthShort(r.month)}</td><td>{reais(r.income)}</td><td>{reais(r.expense)}</td><td>{reais(r.committed)}</td><td class={r.income - r.expense < 0 ? "expense" : ""}>{reais(r.income - r.expense)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
