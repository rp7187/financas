import type { Store } from "../app";
import { addMonths, dayMonth, thisMonth, todayISO } from "../dates";
import { balanceByMonth, bill, billMonthOf, cardFutureCharges, currentBalance } from "../engine";
import { BLACK, KIND_LABEL, isCard, isInvestAccount, money, type Account } from "../model";
import { Icon } from "./icons";
import { PageHead } from "./page-head";
import { ReorderSheet } from "./reorder-sheet";
import { SwipeRow, UndoToast } from "./swipe";
import { accountSwipe, type Toast } from "./account-actions";
import { useState } from "preact/hooks";

/** Fundo do cartão a partir da cor da conta (escurecido para o texto branco ter contraste). */
const cardBg = (c: string) => c === BLACK
  ? "linear-gradient(135deg, #3b3d44, #0a0a0c)" // preto: grafite → preto (brilho discreto, como cartão black)
  : `linear-gradient(135deg, color-mix(in srgb, ${c} 82%, black), color-mix(in srgb, ${c} 52%, black))`;

export function Accounts({ store }: { store: Store }) {
  const { data } = store;
  const [reorder, setReorder] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  /** Cartão da lista com deslizar (excluir/arquivar; reativar nos arquivados). */
  const swipe = (a: Account) => {
    const act = accountSwipe(store, a, setToast);
    return (
      <SwipeRow key={a.id} id={a.id} tag="div" class="card-swipe" openId={openId} setOpenId={setOpenId} left={act.left} right={act.right}>
        {isCard(a) ? <CreditCard store={store} a={a} /> : <AccountCard store={store} a={a} />}
      </SwipeRow>
    );
  };
  const accounts = data.accounts.filter((a) => !isCard(a) && !isInvestAccount(a));
  const invs = data.accounts.filter(isInvestAccount);
  const invested = invs.reduce((s, a) => s + currentBalance(data, a.id), 0);
  const cards = data.accounts.filter(isCard);
  const archived = data.accounts.filter((a) => a.archived && !isInvestAccount(a));
  const total = currentBalance(data);
  const m = thisMonth();
  const projected = balanceByMonth(data, m, m)[0]?.balance ?? 0;
  const cardDebt = -cards.reduce((s, a) => s + currentBalance(data, a.id), 0) || 0; // "|| 0": evita "-R$ 0,00"

  return (
    <>
      <PageHead store={store} title="Contas e cartões">
        {data.accounts.filter((a) => !a.archived).length > 1 && <button type="button" class="btn small ghost" onClick={() => setReorder(true)}>Ordenar</button>}
      </PageHead>
      {reorder && <ReorderSheet store={store} onClose={() => setReorder(false)} />}
      <section class="hero">
        <p class="hero-label" style={{ marginTop: 0 }}>Saldo em contas</p>
        <div class="hero-amount num">{money(total)}</div>
        <div class="hero-sub">Previsto no fim do mês <b class="num">{money(projected)}</b></div>
        {cardDebt > 0 && <div class="hero-sub">Faturas em aberto <b class="num">{money(cardDebt)}</b> · livre <b class="num">{money(total - cardDebt)}</b></div>}
        {invs.length > 0 && <div class="hero-sub">Patrimônio <b class="num">{money(total - cardDebt + invested)}</b> (com {money(invested)} investidos)</div>}
      </section>

      <div class="section-head">
        <p class="section-label">Contas</p>
        <button type="button" class="btn small ghost" onClick={() => store.openAccount(null)}><Icon name="plus" />Conta</button>
      </div>
      <div class="acc-cards">
        {accounts.filter((a) => !a.archived).map(swipe)}
      </div>
      <button type="button" class="btn ghost wide" onClick={() => store.openTxn({ draft: true, type: "transfer" })}><Icon name="swap" />Transferir entre contas</button>

      <div class="section-head">
        <p class="section-label">Cartões de crédito</p>
        <button type="button" class="btn small ghost" onClick={() => store.openAccount({ kind: "credit" })}><Icon name="plus" />Cartão</button>
      </div>
      {cards.some((a) => !a.archived) ? (
        <div class="acc-cards">{cards.filter((a) => !a.archived).map(swipe)}</div>
      ) : (
        <p class="muted small empty-note">Cadastre um cartão para lançar compras nele: cada compra entra na categoria no dia em que foi feita, e a fatura aparece para pagar no vencimento.</p>
      )}

      {archived.length > 0 && (
        <>
          <p class="section-label">Arquivados</p>
          <div class="acc-cards">{archived.map(swipe)}</div>
        </>
      )}
      <p class="muted small" style={{ textAlign: "center" }}>Saldo = saldo inicial + o que já foi pago/recebido. Compras no cartão saem do saldo quando a fatura é paga. Toque numa conta ou cartão para editar · deslize para a esquerda para excluir.</p>
      <UndoToast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}

function AccountCard({ store, a }: { store: Store; a: Account }) {
  const bal = currentBalance(store.data, a.id);
  const linked = store.data.accounts.filter((x) => x.bankId === a.id && isInvestAccount(x) && !x.archived);
  const inv = linked.reduce((s, x) => s + currentBalance(store.data, x.id), 0);
  return (
    <button type="button" class={`acc-card ${a.color === BLACK ? "black" : ""} ${a.archived ? "archived" : ""}`} style={{ background: cardBg(a.color) }} onClick={() => store.openAccount(a)}>
      <span class="top"><span>{a.name}</span><span class="kind">{KIND_LABEL[a.kind]}</span></span>
      <span class="bal num">{money(bal)}</span>
      {linked.length > 0 && <span class="foot"><span>+ investimentos <b class="num">{money(inv)}</b></span><span>total <b class="num">{money(bal + inv)}</b></span></span>}
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
    <button type="button" class={`acc-card credit ${a.color === BLACK ? "black" : ""} ${a.archived ? "archived" : ""}`} style={{ background: cardBg(a.color) }} onClick={() => store.openAccount(a)}>
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
