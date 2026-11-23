import { useState } from "preact/hooks";
import type { Store } from "../app";
import { todayISO } from "../dates";
import { currentBalance } from "../engine";
import { ACCOUNT_COLORS, ASSET_CLASS, BLACK, KIND_LABEL, isInvestAccount, money, uid, type Account, type AccountKind, type AssetClass, type Valuation } from "../model";
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
  const [color, setColor] = useState(account?.color ?? ACCOUNT_COLORS[store.data.accounts.length % (ACCOUNT_COLORS.length - 1)]);
  const [payFromId, setPayFromId] = useState(account?.payFromId ?? payable[0]?.id ?? "");
  const [closingDay, setClosingDay] = useState(account?.closingDay ? String(account.closingDay) : "");
  const [dueDay, setDueDay] = useState(account?.dueDay ? String(account.dueDay) : "");
  const [limit, setLimit] = useState(account?.limit ?? 0);
  const banks = store.data.accounts.filter((a) => (a.kind === "checking" || a.kind === "cash") && (!a.archived || a.id === account?.bankId));
  const [bankId, setBankId] = useState(account?.bankId ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(account?.assetClass ?? (target?.kind === "savings" ? "savings" : account ? "other" : "fixed"));
  const [startValue, setStartValue] = useState(0); // investimento novo: saldo de hoje
  const [error, setError] = useState<string | null>(null);
  const used = account ? store.data.txns.some((t) => t.accountId === account.id || t.toAccountId === account.id) || store.data.rules.some((r) => r.accountId === account.id) : false;
  const card = kind === "credit";
  const invest = isInvestAccount({ kind } as Account);
  const noun = card ? "cartão" : invest ? "investimento" : "conta";

  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return setError(`Informe o nome do ${noun}.`);
    if (card) {
      if (!payFromId) return setError("Escolha a conta de onde sai o pagamento da fatura (cadastre uma conta antes).");
      if (!dayOk(closingDay)) return setError("Dia do fechamento: de 1 a 31.");
      if (!dayOk(dueDay)) return setError("Dia do vencimento: de 1 a 31.");
      if (Number(closingDay) === Number(dueDay)) return setError("Fechamento e vencimento precisam ser em dias diferentes.");
    }
    // campos de cartão/investimento só existem nesses tipos (somem se o tipo mudar)
    const { payFromId: _p, closingDay: _c, dueDay: _d, limit: _l, bankId: _b, assetClass: _a, ...rest } = account ?? ({} as Partial<Account>);
    const rec = {
      ...(account ? rest : { id: uid(), t: "account", order: Math.max(-1, ...store.data.accounts.map((a) => a.order ?? 0)) + 1, updatedAt: 0 }),
      name: name.trim(), kind, color,
      initialBalance: card || invest ? (account?.initialBalance ?? 0) : negative ? -initial : initial, // investimento: saldo vem do valor informado
      ...(card ? { payFromId, closingDay: Number(closingDay), dueDay: Number(dueDay), ...(limit > 0 ? { limit } : {}) } : {}),
      ...(invest ? { assetClass, ...(bankId ? { bankId } : {}) } : {}),
    } as Account;
    const recs: (Account | Valuation)[] = [rec];
    // investimento novo: o saldo de hoje vira o 1º saldo informado (ponto de partida do rendimento)
    if (invest && !account && startValue > 0) {
      const today = todayISO();
      recs.push({ id: `val:${rec.id}:${today.slice(0, 7)}`, t: "valuation", accountId: rec.id, month: today.slice(0, 7), date: today, balance: startValue, updatedAt: 0 });
    }
    await store.put(recs);
    onClose();
  }

  return (
    <Sheet title={account ? `Editar ${noun}` : card ? "Novo cartão" : invest ? "Novo investimento" : "Nova conta"} onClose={onClose} onSubmit={submit}
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
      {invest ? (
        <>
          <label>Tipo de aplicação
            <select value={assetClass} onChange={(e) => setAssetClass(e.currentTarget.value as AssetClass)}>
              {(Object.keys(ASSET_CLASS) as AssetClass[]).map((k) => <option key={k} value={k}>{ASSET_CLASS[k]}</option>)}
            </select>
          </label>
          <label>Banco (conta vinculada)
            <select value={bankId} onChange={(e) => setBankId(e.currentTarget.value)}>
              <option value="">— nenhum —</option>
              {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <p class="muted small hint">A conta vinculada é usada nos aportes e resgates, e o saldo aparece junto dela em Contas.</p>
          {!account ? (
            <MoneyInput label="Saldo hoje (o que o banco mostra)" value={startValue} onChange={setStartValue} />
          ) : (
            <div class="invest-actions">
              <p class="muted small">Saldo agora: <b class="num">{money(currentBalance(store.data, account.id))}</b></p>
              <div class="two">
                <button type="button" class="btn ghost" onClick={() => { onClose(); store.openTxn({ draft: true, type: "transfer", accountId: account.bankId || banks[0]?.id, toAccountId: account.id, description: `Aplicação ${account.name}` }); }}>Aplicar</button>
                <button type="button" class="btn ghost" onClick={() => { onClose(); store.openTxn({ draft: true, type: "transfer", accountId: account.id, toAccountId: account.bankId || banks[0]?.id, description: `Resgate ${account.name}` }); }}>Resgatar</button>
              </div>
              <button type="button" class="btn ghost wide" onClick={() => { onClose(); store.openValuations(); }}>Atualizar saldo do mês</button>
            </div>
          )}
        </>
      ) : card ? (
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
            <button key={c} type="button" class={`color ${color === c ? "on" : ""} ${c === BLACK ? "black" : ""}`} style={{ background: c }} aria-label={c === BLACK ? "Cor preta" : `Cor ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      {account && used && <p class="muted small">{card ? "Cartões" : "Contas"} com lançamentos não são excluídos, só arquivados (somem das listas, mas o histórico continua).</p>}
      {error && <p class="error" role="alert">{error}</p>}
    </Sheet>
  );
}
