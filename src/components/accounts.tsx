import type { Store } from "../app";
import { addMonths, dayMonth, thisMonth, todayISO } from "../dates";
import { balanceByMonth, bill, billMonthOf, cardFutureCharges, currentBalance } from "../engine";
import { KIND_LABEL, isCard, money, type Account } from "../model";
import { Icon } from "./icons";

/** Fundo do cartão a partir da cor da conta (escurecido para o texto branco ter contraste). */
const cardBg = (c: string) => `linear-gradient(135deg, color-mix(in srgb, ${c} 82%, black), color-mix(in srgb, ${c} 52%, black))`;

export function Accounts({ store }: { store: Store }) {
  const { data } = store;
  const accounts = data.accounts.filter((a) => !isCard(a));
  const cards = data.accounts.filter(isCard);
  const archived = data.accounts.filter((a) => a.archived);
  const total = currentBalance(data);
  const m = thisMonth();
  const projected = balanceByMonth(data, m, m)[0]?.balance ?? 0;
  const inAccounts = accounts.reduce((s, a) => s + currentBalance(data, a.id), 0);
  const cardDebt = -cards.reduce((s, a) => s + currentBalance(data, a.id), 0);

  return (
    <>
      <header class="page-head">
        <h1>Contas e cartões</h1>
      </header>
      <section class="hero">
        <p class="hero-label" style={{ marginTop: 0 }}>Saldo total agora</p>
        <div class="hero-amount num">{money(total)}</div>
        <div class="hero-sub">Previsto no fim do mês <b class="num">{money(projected)}</b></div>
        {cards.length > 0 && <div class="hero-sub">Em contas <b class="num">{money(inAccounts)}</b> · devido nos cartões <b class="num">{money(cardDebt)}</b></div>}
      </section>

      <div class="section-head">
        <p class="section-label">Contas</p>
        <button type="button" class="btn small ghost" onClick={() => store.openAccount(null)}><Icon name="plus" />Conta</button>
      </div>
      <div class="acc-cards">
        {accounts.filter((a) => !a.archived).map((a) => <AccountCard key={a.id} store={store} a={a} />)}
      </div>
      <button type="button" class="btn ghost wide" onClick={() => store.openTxn({ draft: true, type: "transfer" })}><Icon name="swap" />Transferir entre contas</button>

      <div class="section-head">
        <p class="section-label">Cartões de crédito</p>
        <button type="button" class="btn small ghost" onClick={() => store.openAccount({ kind: "credit" })}><Icon name="plus" />Cartão</button>
      </div>
      {cards.some((a) => !a.archived) ? (
        <div class="acc-cards">{cards.filter((a) => !a.archived).map((a) => <CreditCard key={a.id} store={store} a={a} />)}</div>
      ) : (
        <p class="muted small empty-note">Cadastre um cartão para lançar compras nele: cada compra entra na categoria no dia em que foi feita, e a fatura aparece para pagar no vencimento.</p>
      )}

      {archived.length > 0 && (
        <>
          <p class="section-label">Arquivados</p>
          <div class="acc-cards">{archived.map((a) => (isCard(a) ? <CreditCard key={a.id} store={store} a={a} /> : <AccountCard key={a.id} store={store} a={a} />))}</div>
        </>
      )}
      <p class="muted small" style={{ textAlign: "center" }}>Saldo = saldo inicial + o que já foi pago/recebido. Toque numa conta ou cartão para editar.</p>
    </>
  );
}

function AccountCard({ store, a }: { store: Store; a: Account }) {
  const bal = currentBalance(store.data, a.id);
  return (
    <button type="button" class={`acc-card ${a.archived ? "archived" : ""}`} style={{ background: cardBg(a.color) }} onClick={() => store.openAccount(a)}>
      <span class="top"><span>{a.name}</span><span class="kind">{KIND_LABEL[a.kind]}</span></span>
      <span class="bal num">{money(bal)}</span>
    </button>
  );
}

/** Cartão: fatura atual (aberta), fatura fechada a pagar e limite disponível. */
function CreditCard({ store, a }: { store: Store; a: Account }) {
  const { data } = store;
  const today = todayISO();
  const payFrom = data.accounts.find((x) => x.id === a.payFromId);
  const openMonth = a.closingDay && a.dueDay ? billMonthOf(a, today) : null;
  const open = openMonth ? bill(data, a, openMonth) : null;
  const closed = openMonth ? bill(data, a, addMonths(openMonth, -1)) : null;
  const debt = -currentBalance(data, a.id) + cardFutureCharges(data, a.id); // limite: inclui parcelas futuras
  return (
    <button type="button" class={`acc-card credit ${a.archived ? "archived" : ""}`} style={{ background: cardBg(a.color) }} onClick={() => store.openAccount(a)}>
      <span class="top"><span><Icon name="card" />{a.name}</span><span class="kind">{payFrom ? `paga com ${payFrom.name}` : KIND_LABEL.credit}</span></span>
      {openMonth ? (
        <>
          <span class="cap">Fatura atual{open ? ` · fecha ${dayMonth(open.close)} · vence ${dayMonth(open.due)}` : ""}</span>
          <span class="bal num">{money(open?.total ?? 0)}</span>
          <span class="foot">
            {closed && closed.remaining > 0
              ? <span class={closed.due < today ? "warn" : ""}>Fechada: <b class="num">{money(closed.remaining)}</b> · {closed.due < today ? "venceu" : "vence"} {dayMonth(closed.due)}</span>
              : closed ? <span>Fatura anterior paga ✓</span> : <span />}
            {a.limit ? <span>Disponível <b class="num">{money(a.limit - debt)}</b></span> : null}
          </span>
        </>
      ) : (
        <span class="cap">Informe os dias de fechamento e vencimento</span>
      )}
    </button>
  );
}
