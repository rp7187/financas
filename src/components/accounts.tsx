import type { Store } from "../app";
import { thisMonth } from "../dates";
import { balanceByMonth, currentBalance } from "../engine";
import { KIND_LABEL, money } from "../model";

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
        <button type="button" class="btn small ghost" onClick={() => store.openAccount(null)}>+ Conta</button>
      </header>
      <section class="card total">
        <span class="muted">Saldo total agora</span>
        <b class="big">{money(total)}</b>
        <small class="muted">previsto no fim do mês: {money(projected)}</small>
      </section>
      <ul class="list">
        {active.map((a) => {
          const bal = currentBalance(data, a.id);
          return (
            <li key={a.id}>
              <button type="button" class="item" onClick={() => store.openAccount(a)}>
                <i class="acc-dot" style={{ background: a.color }} />
                <span class="what"><span>{a.name}</span><small class="muted">{KIND_LABEL[a.kind]}</small></span>
                <b class={bal < 0 ? "expense" : ""}>{money(bal)}</b>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" class="btn ghost wide" onClick={() => store.openTxn({ draft: true, type: "transfer" })}>⇄ Transferir entre contas</button>
      {archived.length > 0 && (
        <>
          <h2 class="section-title">Arquivadas</h2>
          <ul class="list muted-list">
            {archived.map((a) => (
              <li key={a.id}>
                <button type="button" class="item" onClick={() => store.openAccount(a)}>
                  <i class="acc-dot" style={{ background: a.color }} />
                  <span class="what"><span>{a.name}</span></span>
                  <b>{money(currentBalance(data, a.id))}</b>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="muted small">Saldo agora = saldo inicial + tudo que já foi pago/recebido. Toque numa conta para editar.</p>
    </>
  );
}
