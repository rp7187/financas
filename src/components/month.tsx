import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, dayLabel, monthLong, thisMonth, todayISO } from "../dates";
import { balanceByMonth, currentBalance, effect, monthItems, monthTotals, type Item } from "../engine";
import { money, signedMoney, uid, type Txn } from "../model";
import { Icon } from "./icons";

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
  const ratio = tot.income > 0 ? tot.expense / tot.income : tot.expense > 0 ? 1.01 : 0;

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
      <section class="hero">
        <div class="hero-nav">
          <button type="button" class="glass-btn" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}><Icon name="chevL" /></button>
          <div>
            <h1>{monthLong(month)}</h1>
            {!isCurrent && <button type="button" class="today-link" onClick={() => setMonth(thisMonth())}>ir para o mês atual</button>}
          </div>
          <button type="button" class="glass-btn" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}><Icon name="chevR" /></button>
        </div>
        <p class="hero-label">Saldo previsto no fim do mês</p>
        <div class="hero-amount num">{money(projected)}</div>
        {isCurrent && <div class="hero-sub">Saldo agora <b class="num">{money(now)}</b></div>}
        <div class="hero-tiles">
          <div class="tile">
            <span class="tile-head"><span class="tile-icon in"><Icon name="down" /></span>Receitas</span>
            <b class="num">{money(tot.income)}</b>
            <small>{tot.incomePaid === tot.income ? "tudo recebido" : `recebido ${money(tot.incomePaid)}`}</small>
          </div>
          <div class="tile">
            <span class="tile-head"><span class="tile-icon out"><Icon name="up" /></span>Despesas</span>
            <b class="num">{money(tot.expense)}</b>
            <small>{tot.expensePaid === tot.expense ? "tudo pago" : `pago ${money(tot.expensePaid)}`}</small>
          </div>
        </div>
        {(tot.income > 0 || tot.expense > 0) && (
          <div class="spend">
            <div class={`spend-bar ${ratio > 1 ? "over" : ""}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}
              aria-label="Despesas em relação às receitas"><div style={{ width: `${Math.min(1, ratio) * 100}%` }} /></div>
            <div class="spend-text">
              <span>{tot.income > 0 ? `Despesas = ${Math.round(ratio * 100)}% das receitas` : "Sem receitas no mês"}</span>
              <span>{tot.income >= tot.expense ? "Sobra" : "Falta"} <b class="num">{money(Math.abs(tot.income - tot.expense))}</b></span>
            </div>
          </div>
        )}
      </section>

      {data.accounts.filter((a) => !a.archived).length > 1 && (
        <div class="chips scroll" role="group" aria-label="Conta">
          <button type="button" class={`chip ${!acc ? "on" : ""}`} onClick={() => setAccountId("")}>Todas as contas</button>
          {data.accounts.filter((a) => !a.archived).map((a) => (
            <button key={a.id} type="button" class={`chip ${acc === a.id ? "on" : ""}`} onClick={() => setAccountId(a.id)}>
              <i class="sw" style={{ background: a.color }} />{a.name}
            </button>
          ))}
        </div>
      )}

      {tot.overdue > 0 && (
        <div class="alert" role="status"><Icon name="alert" />{tot.overdue} lançamento{tot.overdue > 1 ? "s" : ""} pendente{tot.overdue > 1 ? "s" : ""} com data vencida</div>
      )}

      {!items.length && (
        <div class="empty muted">
          <p>Nenhum lançamento em {monthLong(month).toLowerCase()}.</p>
          <button type="button" class="btn brand" onClick={() => store.openTxn({ draft: true })}><Icon name="plus" />Novo lançamento</button>
        </div>
      )}
      {[...groups.entries()].map(([date, list]) => {
        const net = list.reduce((s, it) => s + effect(it.txn, acc), 0);
        return (
          <section key={date}>
            <div class="day-head">
              <span>{dayLabel(date)}{date === today && <span class="today-tag"> · hoje</span>}</span>
              {list.length > 1 && net !== 0 && <span class="num">{signedMoney(net)}</span>}
            </div>
            <ul class="group">
              {list.map((it) => <Row key={it.txn.id} store={store} it={it} accountId={acc} onToggle={() => togglePaid(it)} />)}
            </ul>
          </section>
        );
      })}
      {items.length > 0 && <p class="hint-line">Toque no ícone para marcar como pago/recebido.</p>}
    </>
  );
}

function Row({ store, it, accountId, onToggle }: { store: Store; it: Item; accountId?: string; onToggle: () => void }) {
  const { data } = store;
  const t = it.txn;
  const cat = data.categories.find((c) => c.id === t.categoryId);
  const account = data.accounts.find((a) => a.id === t.accountId);
  const to = data.accounts.find((a) => a.id === t.toAccountId);
  const prop = t.propertyId ? data.properties.find((p) => p.id === t.propertyId) : undefined;
  const late = !t.paid && t.date < todayISO();
  const sign = t.type === "income" ? "+" : t.type === "expense" ? "−" : accountId ? (t.toAccountId === accountId ? "+" : "−") : "";
  const verb = t.type === "income" ? "recebido" : t.type === "transfer" ? "realizada" : "pago";
  const extra = it.plan ? `${t.installment}/${it.plan.count}` : it.rule ? "mensal" : null;
  const sub = t.type === "transfer" ? `${account?.name ?? "?"} → ${to?.name ?? "?"}` : `${cat?.name ?? "Sem categoria"} · ${account?.name ?? "?"}`;

  return (
    <li class={`row ${t.paid ? "" : "pending"}`}>
      <button type="button" class={`avatar ${t.type} ${t.paid ? "" : "pending"}`} aria-pressed={t.paid}
        aria-label={t.paid ? `${t.description}: marcar como não ${verb}` : `${t.description}: marcar como ${verb}`} onClick={onToggle}>
        {t.type === "transfer" ? <Icon name="swap" /> : <span aria-hidden="true">{cat?.emoji ?? "•"}</span>}
        {t.paid && <span class="badge"><Icon name="check" /></span>}
      </button>
      <button type="button" class="row-main" onClick={() => store.openTxn(it)}>
        <span class="what">
          <span class="desc">{t.description}</span>
          <span class="sub">{sub}{extra ? ` · ${extra}` : ""}</span>
        </span>
        <span class="right">
          <span class={`amount num ${t.type}`}>{sign}{money(t.amount)}</span>
          {late ? <span class="pill late">vencido</span>
            : prop ? <span class="pill prop">{prop.name}</span>
            : it.virtual ? <span class="pill">previsto</span>
            : !t.paid ? <span class="pill">pendente</span> : null}
        </span>
      </button>
    </li>
  );
}
