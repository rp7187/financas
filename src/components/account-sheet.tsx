import { useState } from "preact/hooks";
import type { Store } from "../app";
import { ACCOUNT_COLORS, KIND_LABEL, uid, type Account, type AccountKind } from "../model";
import { MoneyInput, Sheet } from "./sheet";

export function AccountSheet({ store, account, onClose }: { store: Store; account: Account | null; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "checking");
  const [initial, setInitial] = useState(Math.abs(account?.initialBalance ?? 0));
  const [negative, setNegative] = useState((account?.initialBalance ?? 0) < 0);
  const [color, setColor] = useState(account?.color ?? ACCOUNT_COLORS[store.data.accounts.length % ACCOUNT_COLORS.length]);
  const [error, setError] = useState<string | null>(null);
  const used = account ? store.data.txns.some((t) => t.accountId === account.id || t.toAccountId === account.id) || store.data.rules.some((r) => r.accountId === account.id) : false;

  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return setError("Informe o nome da conta.");
    const rec: Account = {
      ...(account ?? { id: uid(), t: "account", order: store.data.accounts.length, updatedAt: 0 }),
      name: name.trim(), kind, color, initialBalance: negative ? -initial : initial,
    } as Account;
    await store.put([rec]);
    onClose();
  }

  return (
    <Sheet title={account ? "Editar conta" : "Nova conta"} onClose={onClose} onSubmit={submit}
      actions={<>
        {account && (
          used ? (
            <button type="button" class="btn ghost" onClick={async () => { await store.put([{ ...account, archived: !account.archived }]); onClose(); }}>
              {account.archived ? "Reativar" : "Arquivar"}
            </button>
          ) : (
            <button type="button" class="btn ghost danger" onClick={async () => { if (confirm(`Excluir a conta "${account.name}"?`)) { await store.del([account]); onClose(); } }}>Excluir</button>
          )
        )}
        <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" class="btn primary">Salvar</button>
      </>}>
      <label>Nome<input type="text" value={name} placeholder="ex.: Nubank, Itaú, Carteira" onInput={(e) => { setName(e.currentTarget.value); setError(null); }} /></label>
      <label>Tipo
        <select value={kind} onChange={(e) => setKind(e.currentTarget.value as AccountKind)}>
          {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <MoneyInput label="Saldo inicial (quando começou a usar o app)" value={initial} onChange={setInitial} />
      <label class="toggle"><input type="checkbox" checked={negative} onChange={(e) => setNegative(e.currentTarget.checked)} /><span>Saldo inicial negativo</span></label>
      <div class="field">
        <span class="label">Cor</span>
        <div class="colors">
          {ACCOUNT_COLORS.map((c) => (
            <button key={c} type="button" class={`color ${color === c ? "on" : ""}`} style={{ background: c }} aria-label={`Cor ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      {account && used && <p class="muted small">Contas com lançamentos não são excluídas, só arquivadas (somem das listas, mas o histórico continua).</p>}
      {error && <p class="error" role="alert">{error}</p>}
    </Sheet>
  );
}
