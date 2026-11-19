import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, dayLabel, monthLong, thisMonth, todayISO } from "../dates";
import { balanceByMonth, currentBalance, monthItems, monthTotals, type Item } from "../engine";
import { money, uid, type Txn } from "../model";

export function MonthView({ store }: { store: Store }) {
  const { data, month, setMonth } = store;
  const [accountId, setAccountId] = useState<string>("");
  const acc = accountId || undefined;
  const all = monthItems(data, month);
  const items = acc ? all.filter(({ txn: t }) => t.accountId === acc || t.toAccountId === acc) : all;
  const tot = monthTotals(items, acc);
  const projected = balanceByMonth(data, month, month, acc)[0]?.balance ?? 0;
  const now = currentBalance(data, acc);
  const isCurrent = month === thisMonth();
  const today = todayISO();

  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const g = groups.get(it.txn.date) ?? [];
    g.push(it);
    groups.set(it.txn.date, g);
  }

  const togglePaid = (it: Item) => {
    const t = it.txn;
    // mês previsto de um recorrente: confirmar = gravar o lançamento desse mês
    if (it.virtual) store.put([{ ...t, id: uid(), paid: true } as Txn]);
    else store.put([{ ...t, paid: !t.paid }]);
  };

  return (
    <>
      <header class="month-nav">
        <button type="button" class="icon-btn" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <div>
          <h1>{monthLong(month)}</h1>
          {!isCurrent && <button type="button" class="link" onClick={() => setMonth(thisMonth())}>voltar para o mês atual</button>}
        </div>
        <button type="button" class="icon-btn" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}>›</button>
      </header>

      {data.accounts.length > 1 && (
        <div class="chips scroll" role="group" aria-label="Conta">
          <button type="button" class={`chip ${!acc ? "on" : ""}`} onClick={() => setAccountId("")}>Todas as contas</button>
          {data.accounts.filter((a) => !a.archived).map((a) => (
            <button key={a.id} type="button" class={`chip ${acc === a.id ? "on" : ""}`} onClick={() => setAccountId(a.id)}>
              <i class="sw" style={{ background: a.color }} />{a.name}
            </button>
          ))}
        </div>
      )}

      <section class="card summary">
        <div class="sum-row">
          <div><span class="muted">Receitas</span><b class="income">{money(tot.income)}</b><small class="muted">{tot.incomePaid === tot.income ? "tudo recebido" : `recebido ${money(tot.incomePaid)}`}</small></div>
          <div><span class="muted">Despesas</span><b class="expense">{money(tot.expense)}</b><small class="muted">{tot.expensePaid === tot.expense ? "tudo pago" : `pago ${money(tot.expensePaid)}`}</small></div>
        </div>
        <div class="sum-result">
          <span>Resultado do mês</span>
          <b class={tot.income - tot.expense >= 0 ? "income" : "expense"}>{money(tot.income - tot.expense)}</b>
        </div>
        <div class="sum-foot">
          {isCurrent && <span>Saldo agora <b>{money(now)}</b></span>}
          <span>Previsto no fim do mês <b>{money(projected)}</b></span>
        </div>
        {tot.overdue > 0 && <p class="warn" role="status">▲ {tot.overdue} lançamento{tot.overdue > 1 ? "s" : ""} pendente{tot.overdue > 1 ? "s" : ""} com data vencida</p>}
      </section>

      {!items.length && <p class="muted empty">Nenhum lançamento neste mês. Toque em + para lançar.</p>}
      {[...groups.entries()].map(([date, list]) => (
        <section key={date} class="day">
          <h2>{dayLabel(date)}{date === today ? " · hoje" : ""}</h2>
          <ul class="list">
            {list.map((it) => <Row key={it.txn.id} store={store} it={it} accountId={acc} onToggle={() => togglePaid(it)} />)}
          </ul>
        </section>
      ))}
    </>
  );
}

function Row({ store, it, accountId, onToggle }: { store: Store; it: Item; accountId?: string; onToggle: () => void }) {
  const { data } = store;
  const t = it.txn;
  const cat = data.categories.find((c) => c.id === t.categoryId);
  const account = data.accounts.find((a) => a.id === t.accountId);
  const to = data.accounts.find((a) => a.id === t.toAccountId);
  const late = !t.paid && t.date < todayISO();
  const tag = it.plan ? `${t.installment}/${it.plan.count}` : it.rule ? "mensal" : null;
  const sign = t.type === "income" ? "+" : t.type === "expense" ? "−" : accountId ? (t.toAccountId === accountId ? "+" : "−") : "";
  const verb = t.type === "income" ? "recebido" : t.type === "transfer" ? "realizada" : "pago";

  return (
    <li class={`row ${t.paid ? "" : "pending"}`}>
      <button type="button" class={`check ${t.paid ? "on" : ""}`} aria-pressed={t.paid}
        aria-label={t.paid ? `Marcar como não ${verb}` : `Marcar como ${verb}`} onClick={onToggle}>
        {t.paid ? "✓" : ""}
      </button>
      <button type="button" class="row-main" onClick={() => store.openTxn(it)}>
        <span class="emoji" aria-hidden="true">{t.type === "transfer" ? "⇄" : cat?.emoji ?? "•"}</span>
        <span class="what">
          <span class="desc">{t.description}</span>
          <small class="muted">
            {t.type === "transfer" ? `${account?.name ?? "?"} → ${to?.name ?? "?"}` : `${cat?.name ?? "Sem categoria"} · ${account?.name ?? "?"}`}
            {tag && <span class="tag">{tag}</span>}
            {late && <span class="late">vencido</span>}
            {it.virtual && <span class="tag">previsto</span>}
          </small>
        </span>
        <span class={`amount ${t.type}`}>{sign}{money(t.amount)}</span>
      </button>
    </li>
  );
}
