import { useState } from "preact/hooks";
import type { Store } from "../app";
import { ACCOUNT_COLORS, KIND_LABEL, uid, type Account, type AccountKind } from "../model";
import { MoneyInput, Sheet } from "./sheet";

/** Conta existente, nova (null) ou nova de um tipo já escolhido (ex.: botão "+ Cartão"). */
export type AccountTarget = Account | { kind: AccountKind } | null;

const dayOk = (s: string) => { const n = Number(s); return Number.isInteger(n) && n >= 1 && n <= 31; };

export function AccountSheet({ store, account: target, onClose }: { store: Store; account: AccountTarget; onClose: () => void }) {
  const account = target && "id" in target ? target : null;
  const payable = store.data.accounts.filter((a) => a.kind !== "credit" && (!a.archived || a.id === account?.payFromId));
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(target?.kind ?? "checking");
  const [initial, setInitial] = useState(Math.abs(account?.initialBalance ?? 0));
  const [negative, setNegative] = useState((account?.initialBalance ?? 0) < 0);
  const [color, setColor] = useState(account?.color ?? ACCOUNT_COLORS[store.data.accounts.length % ACCOUNT_COLORS.length]);
  const [payFromId, setPayFromId] = useState(account?.payFromId ?? payable[0]?.id ?? "");
  const [closingDay, setClosingDay] = useState(account?.closingDay ? String(account.closingDay) : "");
  const [dueDay, setDueDay] = useState(account?.dueDay ? String(account.dueDay) : "");
  const [limit, setLimit] = useState(account?.limit ?? 0);
  const [error, setError] = useState<string | null>(null);
  const used = account ? store.data.txns.some((t) => t.accountId === account.id || t.toAccountId === account.id) || store.data.rules.some((r) => r.accountId === account.id) : false;
  const card = kind === "credit";
  const noun = card ? "cartão" : "conta";

  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return setError(`Informe o nome do ${noun}.`);
    if (card) {
      if (!payFromId) return setError("Escolha a conta de onde sai o pagamento da fatura (cadastre uma conta antes).");
      if (!dayOk(closingDay)) return setError("Dia do fechamento: de 1 a 31.");
      if (!dayOk(dueDay)) return setError("Dia do vencimento: de 1 a 31.");
      if (Number(closingDay) === Number(dueDay)) return setError("Fechamento e vencimento precisam ser em dias diferentes.");
    }
    // campos de cartão só existem em cartão (somem se o tipo mudar)
    const { payFromId: _p, closingDay: _c, dueDay: _d, limit: _l, ...rest } = account ?? ({} as Partial<Account>);
    const rec = {
      ...(account ? rest : { id: uid(), t: "account", order: store.data.accounts.length, updatedAt: 0 }),
      name: name.trim(), kind, color,
      initialBalance: card ? (account?.initialBalance ?? 0) : negative ? -initial : initial,
      ...(card ? { payFromId, closingDay: Number(closingDay), dueDay: Number(dueDay), ...(limit > 0 ? { limit } : {}) } : {}),
    } as Account;
    await store.put([rec]);
    onClose();
  }

  return (
    <Sheet title={account ? `Editar ${noun}` : card ? "Novo cartão" : "Nova conta"} onClose={onClose} onSubmit={submit}
      actions={<>
        {account && (
          used ? (
            <button type="button" class="btn ghost" onClick={async () => { await store.put([{ ...account, archived: !account.archived }]); onClose(); }}>
              {account.archived ? "Reativar" : "Arquivar"}
            </button>
          ) : (
            <button type="button" class="btn ghost danger" onClick={async () => { if (confirm(`Excluir ${card ? "o cartão" : "a conta"} "${account.name}"?`)) { await store.del([account]); onClose(); } }}>Excluir</button>
          )
        )}
        <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" class="btn primary">Salvar</button>
      </>}>
      <label>Nome<input type="text" value={name} placeholder={card ? "ex.: Nubank Rafael, Itaú Visa" : "ex.: Nubank, Itaú, Carteira"} onInput={(e) => { setName(e.currentTarget.value); setError(null); }} /></label>
      <label>Tipo
        <select value={kind} onChange={(e) => { setKind(e.currentTarget.value as AccountKind); setError(null); }}>
          {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      {card ? (
        <>
          <label>Pagar a fatura com a conta
            <select value={payFromId} onChange={(e) => { setPayFromId(e.currentTarget.value); setError(null); }}>
              {!payable.length && <option value="">— cadastre uma conta antes —</option>}
              {payable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <div class="two">
            <label>Dia do fechamento<input type="number" inputMode="numeric" min="1" max="31" value={closingDay} placeholder="ex.: 3" onInput={(e) => { setClosingDay(e.currentTarget.value); setError(null); }} /></label>
            <label>Dia do vencimento<input type="number" inputMode="numeric" min="1" max="31" value={dueDay} placeholder="ex.: 10" onInput={(e) => { setDueDay(e.currentTarget.value); setError(null); }} /></label>
          </div>
          <p class="muted small hint">Compras a partir do dia do fechamento entram na fatura seguinte.</p>
          <MoneyInput label="Limite (opcional)" value={limit} onChange={setLimit} />
        </>
      ) : (
        <>
          <MoneyInput label="Saldo inicial (quando começou a usar o app)" value={initial} onChange={setInitial} />
          <label class="toggle"><input type="checkbox" checked={negative} onChange={(e) => setNegative(e.currentTarget.checked)} /><span>Saldo inicial negativo</span></label>
        </>
      )}
      <div class="field">
        <span class="label">Cor</span>
        <div class="colors">
          {ACCOUNT_COLORS.map((c) => (
            <button key={c} type="button" class={`color ${color === c ? "on" : ""}`} style={{ background: c }} aria-label={`Cor ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      {account && used && <p class="muted small">{card ? "Cartões" : "Contas"} com lançamentos não são excluídos, só arquivados (somem das listas, mas o histórico continua).</p>}
      {error && <p class="error" role="alert">{error}</p>}
    </Sheet>
  );
}
