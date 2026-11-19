import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, monthLong, monthShort, thisMonth } from "../dates";
import { balanceByMonth, byCategory, monthItems, monthTotals } from "../engine";
import { money, reais, signedMoney } from "../model";
import { BalanceChart, IncomeExpenseChart } from "./charts";

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

  const last12 = Array.from({ length: 12 }, (_, i) => addMonths(cur, i - 11)).map((m) => {
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

  return (
    <>
      <header class="page-head"><h1>Estatísticas</h1></header>
      {data.accounts.length > 1 && (
        <div class="chips scroll" role="group" aria-label="Conta">
          <button type="button" class={`chip ${!acc ? "on" : ""}`} onClick={() => setAccountId("")}>Todas as contas</button>
          {data.accounts.filter((a) => !a.archived).map((a) => (
            <button key={a.id} type="button" class={`chip ${acc === a.id ? "on" : ""}`} onClick={() => setAccountId(a.id)}><i class="sw" style={{ background: a.color }} />{a.name}</button>
          ))}
        </div>
      )}

      <section class="card">
        <div class="card-title">
          <h2>{flow === "expense" ? "Despesas" : "Receitas"} por categoria</h2>
          <div class="seg small" role="group" aria-label="Tipo">
            <button type="button" class={flow === "expense" ? "on" : ""} onClick={() => setFlow("expense")}>Despesas</button>
            <button type="button" class={flow === "income" ? "on" : ""} onClick={() => setFlow("income")}>Receitas</button>
          </div>
        </div>
        <div class="mini-nav">
          <button type="button" class="icon-btn" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
          <span>{monthLong(month)}</span>
          <button type="button" class="icon-btn" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}>›</button>
        </div>
        <p class="muted small">Total {money(totalCat)}{prevTotal ? ` · ${signedMoney(totalCat - prevTotal)} vs ${monthShort(addMonths(month, -1))}` : ""}</p>
        {!cats.length && <p class="muted">Nada neste mês.</p>}
        <ul class="cat-bars">
          {cats.map((c) => {
            const cat = data.categories.find((x) => x.id === c.categoryId);
            const p = prev.get(c.categoryId) ?? 0;
            return (
              <li key={c.categoryId}>
                <div class="cat-line">
                  <span>{cat?.emoji} {cat?.name ?? "Sem categoria"}</span>
                  <b>{money(c.amount)}</b>
                </div>
                <div class="hbar"><div class={`fill ${flow}`} style={{ width: `${(c.amount / cats[0].amount) * 100}%` }} /></div>
                <small class="muted">{Math.round((c.amount / totalCat) * 100)}% do total{p ? ` · ${signedMoney(c.amount - p)} vs mês anterior` : " · novo neste mês"}</small>
              </li>
            );
          })}
        </ul>
      </section>

      <section class="card">
        <h2>Receitas × despesas · 12 meses</h2>
        <IncomeExpenseChart rows={last12} current={cur} />
        <button type="button" class="link" onClick={() => setTable(!table)}>{table ? "ocultar tabela" : "ver tabela"}</button>
        {table && (
          <div class="table-wrap">
            <p class="muted small">Valores em R$.</p>
            <table>
              <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Resultado</th></tr></thead>
              <tbody>{[...last12].reverse().map((r) => (
                <tr key={r.month}><td>{monthShort(r.month)}</td><td>{reais(r.income)}</td><td>{reais(r.expense)}</td><td class={r.income - r.expense < 0 ? "expense" : ""}>{reais(r.income - r.expense)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section class="card">
        <h2>Saldo no fim do mês</h2>
        <p class="muted small">Últimos 12 meses e previsão para os próximos 6 (recorrentes, parcelas e pendentes).</p>
        <BalanceChart rows={balance} current={cur} />
      </section>

      <section class="card">
        <h2>Próximos meses</h2>
        <p class="muted small">O que já está previsto, em R$. "Comprometido" = recorrentes + parcelas.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Comprometido</th><th>Resultado</th></tr></thead>
            <tbody>{next6.map((r) => (
              <tr key={r.month}><td>{monthShort(r.month)}</td><td>{reais(r.income)}</td><td>{reais(r.expense)}</td><td>{reais(r.committed)}</td><td class={r.income - r.expense < 0 ? "expense" : ""}>{reais(r.income - r.expense)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
