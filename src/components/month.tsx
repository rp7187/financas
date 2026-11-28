import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, dayLabel, dayMonth, monthLong, thisMonth, todayISO } from "../dates";
import { balanceByMonth, currentBalance, effect, monthItems, monthTotals, type Item } from "../engine";
import type { TxnDraft } from "./txn-sheet";
import { JoinBanner } from "./family-sync";
import { SwipeRow, UndoToast, type SwipeAction } from "./swipe";
import { colorOf, money, signedMoney, uid, type Txn } from "../model";
import { Icon, AccountBadge } from "./icons";

type View = "all" | "toPay" | "paid" | "income";
const VIEW_LABEL: Record<View, string> = { all: "Tudo", toPay: "Falta pagar", paid: "Pago", income: "Receitas" };

export function MonthView({ store }: { store: Store }) {
  const { data, month, setMonth } = store;
  const [accountId, setAccountId] = useState<string>("");
  const [view, setView] = useState<View>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [toast, setToast] = useState<{ text: string; undo?: () => void; key: number } | null>(null);
  const acc = accountId || undefined;
  const all = monthItems(data, month);
  const items = acc ? all.filter(({ txn: t }) => t.accountId === acc || t.toAccountId === acc) : all;
  const tot = monthTotals(items, acc);
  const projected = balanceByMonth(data, month, month, acc)[0]?.balance ?? 0;
  const now = currentBalance(data, acc);
  // faturas em aberto (compras já feitas no cartão que ainda vão sair da conta)
  const cardDebt = acc ? 0 : -data.accounts.filter((a) => data.cards.has(a.id)).reduce((s, a) => s + currentBalance(data, a.id), 0) || 0;
  const isCurrent = month === thisMonth();
  const today = todayISO();
  const ratio = tot.income > 0 ? tot.expense / tot.income : tot.expense > 0 ? 1.01 : 0;
  const toPay = tot.expense - tot.expensePaid + tot.bills;
  const paidShare = tot.expense > 0 ? tot.expensePaid / tot.expense : 0;
  const pendingExpItems = items.filter(({ txn: t, bill, estimate }) => !estimate && (!!bill || (t.type === "expense" && !t.paid && (!acc || t.accountId === acc))));
  const pendingExp = pendingExpItems.length;
  const overdueExp = pendingExpItems.filter(({ txn: t }) => t.date < today).length;
  const pendingBills = pendingExpItems.filter((it) => it.bill).length;

  // Filtro pelas caixas do topo: tocar em "Falta pagar" mostra só o que falta pagar etc.
  // Busca: descrição, categoria, conta, imóvel ou veículo (sem acento e sem diferenciar maiúsculas)
  const q = norm(text.trim());
  const matches = (it: Item) => {
    if (!q) return true;
    if (it.estimate) return false;
    const t = it.txn;
    const names = [t.description, data.categories.find((c) => c.id === t.categoryId)?.name, data.accounts.find((a) => a.id === t.accountId)?.name,
      data.accounts.find((a) => a.id === t.toAccountId)?.name, data.properties.find((p) => p.id === t.propertyId)?.name, data.vehicles.find((v) => v.id === t.vehicleId)?.name];
    return names.some((n) => n && norm(n).includes(q));
  };
  const shown = items.filter((it) => matches(it)).filter(({ txn: t, bill, estimate }) =>
    view === "all" ? true
    : estimate ? false
    : view === "income" ? t.type === "income"
    : bill ? view === "toPay"
    : t.type === "expense" && (!acc || t.accountId === acc) && (view === "paid" ? t.paid : !t.paid));
  const pick = (v: View) => {
    setView(view === v ? "all" : v);
    requestAnimationFrame(() => document.getElementById("lista")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const groups = new Map<string, Item[]>();
  for (const it of shown) {
    const g = groups.get(it.txn.date) ?? [];
    g.push(it);
    groups.set(it.txn.date, g);
  }

  const togglePaid = (it: Item) => {
    const t = it.txn;
    if (it.estimate) return;
    // fatura: pagar = transferência da conta de pagamento para o cartão (hoje, se a fatura já fechou; senão no vencimento)
    if (it.bill) {
      store.put([{ ...t, id: uid(), paid: true, date: today >= it.bill.close ? today : it.bill.due } as Txn]);
      return;
    }
    if (data.cards.has(t.accountId) && t.type !== "transfer") return; // compra no cartão: já está na fatura
    // mês previsto de um recorrente: confirmar = gravar o lançamento desse mês
    if (it.virtual) store.put([{ ...t, id: uid(), paid: true } as Txn]);
    else store.put([{ ...t, paid: !t.paid }]);
  };

  // Deslizar para a direita: pago/não pago (fatura: pagar). Compra no cartão e estimativa não têm "pago".
  const payAction = (it: Item): SwipeAction | undefined => {
    const t = it.txn;
    if (it.estimate || (!it.bill && t.type !== "transfer" && data.cards.has(t.accountId))) return undefined;
    if (it.bill) return { label: "Pagar fatura", tone: "pay", run: () => togglePaid(it) };
    const verb = t.type === "income" ? "Recebido" : t.type === "transfer" ? "Realizada" : "Pago";
    return t.paid ? { label: `Não ${verb.toLowerCase()}`, tone: "unpay", run: () => togglePaid(it) } : { label: verb, tone: "pay", run: () => togglePaid(it) };
  };
  // Deslizar para a esquerda: excluir (recorrente = pula só este mês; parcela = só esta parcela), com Desfazer.
  const delAction = (it: Item): SwipeAction | undefined => {
    if (it.estimate || it.bill) return undefined;
    return {
      label: "Excluir", tone: "del", run: async () => {
        const t = it.txn;
        const rec = it.virtual ? ({ ...t, id: uid() } as Txn) : t; // mês previsto: grava a marca "mês pulado"
        await store.del([rec]);
        const text = it.rule ? "Recorrente: este mês foi pulado" : it.plan ? `Parcela ${t.installment}/${it.plan.count} excluída` : "Lançamento excluído";
        setToast({ text, key: Date.now(), undo: () => { const { deleted: _d, ...back } = rec; store.put([back as Txn]); } });
      },
    };
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
        {isCurrent && cardDebt > 0 && <div class="hero-sub">Faturas em aberto <b class="num">{money(cardDebt)}</b> · livre <b class="num">{money(now - cardDebt)}</b></div>}
        {tot.estimate > 0 && <div class="hero-sub">Inclui <b class="num">{money(tot.estimate)}</b> de gastos variáveis previstos</div>}
        <div class="hero-tiles">
          <button type="button" class={`tile wide ${view === "income" ? "active" : ""}`} aria-pressed={view === "income"} onClick={() => pick("income")}>
            <span class="tile-head"><span class="tile-icon in"><Icon name="down" /></span>Receitas<Icon name="chevR" class="tile-chev" /></span>
            <div class="tile-row">
              <b class="num">{money(tot.income)}</b>
              <small>{tot.income === 0 ? "nenhuma no mês" : tot.incomePaid === tot.income ? "✓ tudo recebido" : <>falta receber <b class="num">{money(tot.income - tot.incomePaid)}</b></>}</small>
            </div>
          </button>
          <button type="button" class={`tile ${view === "paid" ? "active" : ""}`} aria-pressed={view === "paid"} onClick={() => pick("paid")}>
            <span class="tile-head"><span class="tile-icon paid"><Icon name="check" /></span>Pago<Icon name="chevR" class="tile-chev" /></span>
            <b class="num">{money(tot.expensePaid)}</b>
            <small>de {money(tot.expense)} em despesas{data.cards.size ? " (inclui cartão)" : ""}</small>
          </button>
          <button type="button" class={`tile ${toPay > 0 ? "due" : ""} ${overdueExp ? "late" : ""} ${view === "toPay" ? "active" : ""}`} aria-pressed={view === "toPay"} onClick={() => pick("toPay")}>
            <span class="tile-head"><span class="tile-icon out"><Icon name="up" /></span>Falta pagar<Icon name="chevR" class="tile-chev" /></span>
            <b class="num">{money(toPay)}</b>
            <small>{toPay === 0 ? (tot.expense ? "✓ tudo pago" : "nenhuma despesa") : `${plural(pendingExp - pendingBills, "conta", "contas", pendingBills ? "fatura" : "", pendingBills ? "faturas" : "", pendingBills)}${overdueExp ? ` · ${overdueExp} vencida${overdueExp > 1 ? "s" : ""}` : ""}`}</small>
          </button>
        </div>
        {tot.expense > 0 && (
          <div class="spend">
            <div class="spend-bar" role="progressbar" aria-valuenow={Math.round(paidShare * 100)} aria-valuemin={0} aria-valuemax={100}
              aria-label="Parte das despesas do mês já paga"><div style={{ width: `${paidShare * 100}%` }} /></div>
            <div class="spend-text">
              <span>{Math.round(paidShare * 100)}% das despesas pagas</span>
              <span>{tot.income > 0 ? `despesas = ${Math.round(ratio * 100)}% das receitas` : ""}</span>
            </div>
          </div>
        )}
      </section>

      <JoinBanner store={store} />

      {data.accounts.filter((a) => !a.archived && !data.investments.has(a.id)).length > 1 && (
        <div class="chips scroll" role="group" aria-label="Conta">
          <button type="button" class={`chip ${!acc ? "on" : ""}`} onClick={() => setAccountId("")}>Todas as contas</button>
          {data.accounts.filter((a) => !a.archived && !data.investments.has(a.id)).map((a) => (
            <button key={a.id} type="button" class={`chip ${acc === a.id ? "on" : ""}`} onClick={() => setAccountId(a.id)}>
              <AccountBadge a={a} />{a.name}
            </button>
          ))}
        </div>
      )}

      <label class="rep-search month-search">
        <Icon name="search" />
        <input type="search" value={text} placeholder="Buscar neste mês (descrição, categoria, conta…)" onInput={(e) => setText(e.currentTarget.value)} />
      </label>

      {tot.overdue > 0 && view !== "toPay" && !q && (
        <button type="button" class="alert" onClick={() => pick("toPay")}><Icon name="alert" />{tot.overdue} lançamento{tot.overdue > 1 ? "s" : ""} pendente{tot.overdue > 1 ? "s" : ""} com data vencida<Icon name="chevR" class="tile-chev" /></button>
      )}

      <div id="lista" />
      {q && view === "all" && (
        <div class="filter-bar" role="status">
          <span><b>“{text.trim()}”</b> · {shown.length} lançamento{shown.length === 1 ? "" : "s"} · <span class="num">{signedMoney(shown.reduce((s, it) => s + (it.txn.type === "income" ? it.txn.amount : it.txn.type === "expense" || it.bill ? -it.txn.amount : 0), 0))}</span></span>
          <button type="button" class="link" onClick={() => setText("")}>Limpar</button>
        </div>
      )}
      {q && !shown.length && <p class="empty muted">Nada encontrado em {monthLong(month).toLowerCase()}.</p>}
      {view !== "all" && (
        <div class="filter-bar" role="status">
          <span><b>{VIEW_LABEL[view]}</b> · {shown.length} lançamento{shown.length === 1 ? "" : "s"} · <span class="num">{money(shown.reduce((s, it) => s + it.txn.amount, 0))}</span></span>
          <button type="button" class="link" onClick={() => setView("all")}>Ver tudo</button>
        </div>
      )}
      {view !== "all" && !shown.length && (
        <p class="empty muted">{view === "toPay" ? "Nada a pagar neste mês. 🎉" : view === "paid" ? "Nenhuma despesa paga ainda neste mês." : "Nenhuma receita neste mês."}</p>
      )}

      {!items.length && view === "all" && !q && (
        <div class="empty muted">
          <p>Nenhum lançamento em {monthLong(month).toLowerCase()}.</p>
          <button type="button" class="btn brand" onClick={() => store.openTxn({ draft: true })}><Icon name="plus" />Novo lançamento</button>
        </div>
      )}
      {[...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, list]) => {
        // soma do dia: compras no cartão contam (é o gasto do dia), mesmo sem mexer no saldo em conta
        const net = list.reduce((s, it) => s + (acc || it.txn.type === "transfer" ? effect(it.txn, acc, data) : it.txn.type === "income" ? it.txn.amount : -it.txn.amount), 0);
        return (
          <section key={date}>
            <div class="day-head">
              <span>{dayLabel(date)}{date === today && <span class="today-tag"> · hoje</span>}</span>
              {list.length > 1 && net !== 0 && <span class="num">{signedMoney(net)}</span>}
            </div>
            <ul class="group">
              {list.map((it) => (
                <SwipeRow key={it.txn.id} id={it.txn.id} openId={openId} setOpenId={setOpenId} left={payAction(it)} right={delAction(it)}>
                  <Row store={store} it={it} accountId={acc} onToggle={() => togglePaid(it)} />
                </SwipeRow>
              ))}
            </ul>
          </section>
        );
      })}
      {shown.length > 0 && <p class="hint-line">Deslize para a direita para marcar como pago · para a esquerda para excluir.</p>}
      <UndoToast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function Row({ store, it, accountId, onToggle }: { store: Store; it: Item; accountId?: string; onToggle: () => void }) {
  const { data } = store;
  const t = it.txn;
  const cat = data.categories.find((c) => c.id === t.categoryId);
  const account = data.accounts.find((a) => a.id === t.accountId);
  const to = data.accounts.find((a) => a.id === t.toAccountId);
  const prop = t.propertyId ? data.properties.find((p) => p.id === t.propertyId) : undefined;
  const veh = t.vehicleId ? data.vehicles.find((v) => v.id === t.vehicleId) : undefined;
  const today = todayISO();
  const late = !t.paid && t.date < today;
  const b = it.bill;
  const onCard = !b && t.type !== "transfer" && data.cards.has(t.accountId);
  const sign = t.type === "income" ? "+" : t.type === "expense" ? "−" : accountId ? (t.toAccountId === accountId ? "+" : "−") : "";
  const verb = t.type === "income" ? "recebido" : t.type === "transfer" ? "realizada" : "pago";
  const extra = it.plan ? `${t.installment}/${it.plan.count}` : it.rule ? "mensal" : null;
  const sub = b ? `${account?.name ?? "conta não definida"} → cartão · ${b.paid ? `já pago ${money(b.paid)} de ${money(b.total)}` : today < b.close ? `fecha ${dayMonth(b.close)}` : "fechada"}`
    : t.type === "transfer" ? `${account?.name ?? "?"} → ${to?.name ?? "?"}${t.billFor ? " · fatura" : ""}`
    : `${cat?.name ?? "Sem categoria"} · ${account?.name ?? "?"}`;
  if (it.estimate) {
    const v = data.variable;
    return (
      <div class="row estimate">
        <span class="avatar est" aria-hidden="true">≈</span>
        <div class="row-main static">
          <span class="what">
            <span class="desc">{t.description}</span>
            <span class="sub">média de {money(v.avg)}/mês ({v.months === 1 ? "último mês" : `últimos ${v.months} meses`}){v.avg > t.amount ? ` · já lançado ${money(v.avg - t.amount)}` : ""}</span>
          </span>
          <span class="right">
            <span class="amount num expense">−{money(t.amount)}</span>
            <span class="pill">estimativa</span>
          </span>
        </div>
      </div>
    );
  }
  const open = () => {
    if (!b) return store.openTxn(it);
    const draft: TxnDraft = { draft: true, type: "transfer", accountId: t.accountId, toAccountId: t.toAccountId, amount: t.amount, description: t.description, date: today >= b.close ? today : b.due, billFor: b.month };
    store.openTxn(draft);
  };

  return (
    <div class={`row ${t.paid ? "" : "pending"}`}>
      {onCard ? (
        <span class={`avatar oncard ${cat ? colorOf(cat) : t.type}`} title={`No cartão ${account?.name ?? ""}: entra na fatura`}>
          <span aria-hidden="true">{cat?.emoji ?? "•"}</span>
          <span class="badge"><Icon name="card" /></span>
        </span>
      ) : (
        <button type="button" class={`avatar ${t.type === "transfer" ? "transfer" : cat ? colorOf(cat) : t.type} ${t.paid ? "" : "pending"}`} aria-pressed={t.paid}
          aria-label={b ? `${t.description}: pagar ${money(t.amount)}` : t.paid ? `${t.description}: marcar como não ${verb}` : `${t.description}: marcar como ${verb}`} onClick={onToggle}>
          {b || t.billFor ? <Icon name="card" /> : t.type === "transfer" ? <Icon name="swap" /> : <span aria-hidden="true">{cat?.emoji ?? "•"}</span>}
          {t.paid && <span class="badge"><Icon name="check" /></span>}
        </button>
      )}
      <button type="button" class="row-main" onClick={open}>
        <span class="what">
          <span class="desc">{t.description}</span>
          <span class="sub">{sub}{extra ? ` · ${extra}` : ""}</span>
        </span>
        <span class="right">
          <span class={`amount num ${b ? "expense" : t.type}`}>{b ? "−" : sign}{money(t.amount)}</span>
          {late ? <span class="pill late">{b ? "vencida" : "vencido"}</span>
            : b ? <span class="pill card">a pagar</span>
            : prop ? <span class="pill prop">{prop.name}</span>
            : veh ? <span class="pill prop">{veh.name}</span>
            : it.virtual ? <span class="pill">previsto</span>
            : !t.paid ? <span class="pill">pendente</span> : null}
        </span>
      </button>
    </div>
  );
}

/** "2 contas · 1 fatura" (omite a parte zerada). */
function plural(n: number, one: string, many: string, oneB: string, manyB: string, m: number): string {
  const parts = [n ? `${n} ${n > 1 ? many : one}` : "", m ? `${m} ${m > 1 ? manyB : oneB}` : ""].filter(Boolean);
  return parts.join(" · ");
}
