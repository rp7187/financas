import type { Store } from "../app";
import { thisMonth } from "../dates";
import { balanceByMonth, currentBalance } from "../engine";
import { KIND_LABEL, money, type Account } from "../model";
import { Icon } from "./icons";

/** Fundo do cartão a partir da cor da conta (escurecido para o texto branco ter contraste). */
const cardBg = (c: string) => `linear-gradient(135deg, color-mix(in srgb, ${c} 82%, black), color-mix(in srgb, ${c} 52%, black))`;

export function Accounts({ store }: { store: Store }) {
  const { data } = store;
  const active = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);
  const total = currentBalance(data);
  const m = thisMonth();
  const projected = balanceByMonth(data, m, m)[0]?.balance ?? 0;

  return (
    <>
      <header class="page-head">
        <h1>Contas</h1>
        <button type="button" class="btn small ghost" onClick={() => store.openAccount(null)}><Icon name="plus" />Conta</button>
      </header>
      <section class="hero">
        <p class="hero-label" style={{ marginTop: 0 }}>Saldo total agora</p>
        <div class="hero-amount num">{money(total)}</div>
        <div class="hero-sub">Previsto no fim do mês <b class="num">{money(projected)}</b></div>
      </section>
      <div class="acc-cards">
        {active.map((a) => <AccountCard key={a.id} store={store} a={a} />)}
      </div>
      <button type="button" class="btn ghost wide" onClick={() => store.openTxn({ draft: true, type: "transfer" })}><Icon name="swap" />Transferir entre contas</button>
      {archived.length > 0 && (
        <>
          <p class="section-label">Arquivadas</p>
          <div class="acc-cards">{archived.map((a) => <AccountCard key={a.id} store={store} a={a} />)}</div>
        </>
      )}
      <p class="muted small" style={{ textAlign: "center" }}>Saldo = saldo inicial + o que já foi pago/recebido. Toque numa conta para editar.</p>
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
