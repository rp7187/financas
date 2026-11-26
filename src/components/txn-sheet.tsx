import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, addMonthsToDate, dayMonth, monthLong, monthOf, thisMonth, todayISO } from "../dates";
import { bill, billMonthOf, type Item } from "../engine";
import { isCard, isInvestAccount, money, splitInstallments, uid, type Account, type Flow, type Plan, type Rule, type Txn } from "../model";
import { MoneyInput, Sheet } from "./sheet";

/** Novo lançamento (com valores iniciais opcionais; ex.: pagamento de fatura já preenchido). */
export type TxnDraft = {
  draft: true; type?: Flow | "transfer"; accountId?: string;
  toAccountId?: string; amount?: number; description?: string; date?: string; billFor?: string;
};
type Kind = Flow | "transfer";
type Repeat = "once" | "monthly" | "installments";

const TYPE_LABEL: Record<Kind, string> = { expense: "Despesa", income: "Receita", transfer: "Transferência" };

export function TxnSheet({ store, target, onClose }: { store: Store; target: Item | TxnDraft; onClose: () => void }) {
  const { data } = store;
  const item = "draft" in target ? null : target;
  const t = item?.txn;
  const accounts = data.accounts.filter((a) => !a.archived || a.id === t?.accountId || a.id === t?.toAccountId);
  const defaultAccount = ("draft" in target && target.accountId) || accounts[0]?.id || "";
  const isNew = !item;
  const draft = "draft" in target ? target : null;
  // Recorrente: em lançamento novo, a data padrão segue o mês aberto na tela.
  const defaultDate = store.month === thisMonth() ? todayISO() : `${store.month}-01`;

  const [type, setType] = useState<Kind>(t?.type ?? ("draft" in target ? target.type : undefined) ?? "expense");
  const [amount, setAmount] = useState(t?.amount ?? draft?.amount ?? 0);
  const [description, setDescription] = useState(t?.description ?? draft?.description ?? "");
  const [categoryId, setCategoryId] = useState(t?.categoryId ?? "");
  const [accountId, setAccountId] = useState(t?.accountId ?? defaultAccount);
  const [propertyId, setPropertyId] = useState(t?.propertyId ?? "");
  const [vehicleId, setVehicleId] = useState(t?.vehicleId ?? "");
  const [toAccountId, setToAccountId] = useState(t?.toAccountId ?? draft?.toAccountId ?? accounts.find((a) => a.id !== defaultAccount && !isCard(a))?.id ?? "");
  const [date, setDate] = useState(t?.date ?? draft?.date ?? defaultDate);
  const [paid, setPaid] = useState(t ? t.paid : defaultDate <= todayISO());
  const [repeat, setRepeat] = useState<Repeat>("once");
  const [count, setCount] = useState("2");
  const [endMonth, setEndMonth] = useState("");
  const [scope, setScope] = useState<"this" | "future">("this");
  /** Parcela: editar só ela ou a compra inteira (todas as parcelas). */
  const [planScope, setPlanScope] = useState<"this" | "all">("this");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [billFor, setBillFor] = useState(t?.billFor ?? draft?.billFor ?? "");

  const acct = data.accounts.find((a) => a.id === accountId);
  const toCard = data.accounts.find((a) => a.id === toAccountId && isCard(a));
  /** Compra/estorno no cartão: já entra na fatura (não tem "pago"). */
  const onCard = type !== "transfer" && isCard(acct);
  const cardBill = onCard && acct!.closingDay && acct!.dueDay && date ? bill(data, acct!, billMonthOf(acct!, date)) : null;
  const cardBillMonth = onCard && acct!.closingDay && acct!.dueDay && date ? billMonthOf(acct!, date) : null;
  // pagamento de fatura: faturas próximas da data (as em aberto primeiro) para escolher qual está sendo paga
  const billChoices = toCard && toCard.closingDay && toCard.dueDay && date
    ? [-2, -1, 0, 1].map((k) => addMonths(billMonthOf(toCard, date), k)).map((m) => ({ m, b: bill(data, toCard, m) })).filter((x) => x.b || x.m === billFor)
    : [];
  const pickBill = (card: Account | undefined, d: string) => {
    if (!card || !card.closingDay || !card.dueDay) return "";
    const months = [-2, -1, 0].map((k) => addMonths(billMonthOf(card, d), k));
    return months.find((m) => (bill(data, card, m)?.remaining ?? 0) > 0) ?? addMonths(billMonthOf(card, d), -1);
  };

  const cats = data.categories.filter((c) => c.type === type && (!c.archived || c.id === categoryId));
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const plan = item?.plan;
  const allPlan = !!plan && planScope === "all";
  /** Troca entre editar só a parcela e a compra inteira: valor/data/nº de parcelas passam a ser os da compra. */
  const choosePlanScope = (s: "this" | "all") => {
    if (!plan || s === planScope) return;
    setPlanScope(s); setError(null);
    if (s === "all") { setAmount(plan.total); setDate(plan.firstDate); setCount(String(plan.count)); }
    else { setAmount(t!.amount); setDate(t!.date); }
  };
  const splitting = (isNew && repeat === "installments") || allPlan;
  /** Lançamento único já gravado: pode virar mensal (o próprio lançamento vira o 1º mês confirmado). */
  const canMakeMonthly = !!item && !item.virtual && !item.rule && !item.plan && !item.bill && !item.txn.ruleId && !item.txn.planId && type !== "transfer";

  function validate(): string | null {
    if (amount <= 0) return "Informe o valor.";
    if (!date) return "Informe a data.";
    if (!accountId) return "Escolha a conta.";
    if (type === "transfer") {
      if (!toAccountId || toAccountId === accountId) return "Escolha contas diferentes de origem e destino.";
    } else if (!categoryId) return "Escolha a categoria.";
    if (splitting && (n < 2 || n > 120)) return "Parcelas: de 2 a 120.";
    if ((isNew || canMakeMonthly) && repeat === "monthly" && endMonth && endMonth < monthOf(date)) return "O fim da recorrência é antes do início.";
    return null;
  }

  const base = () => ({
    type, amount, date, paid: paid || onCard,
    billFor: type === "transfer" && toCard && billFor ? billFor : undefined,
    description: description.trim() || (type === "transfer" ? "Transferência" : data.categories.find((c) => c.id === categoryId)?.name ?? ""),
    accountId,
    ...(type === "transfer" ? { toAccountId, categoryId: undefined } : { categoryId, toAccountId: undefined }),
    propertyId: type === "expense" && propertyId ? propertyId : undefined,
    vehicleId: type === "expense" && vehicleId ? vehicleId : undefined,
  });

  async function submit(e: Event) {
    e.preventDefault();
    const err = validate();
    if (err) return setError(err);
    const b = base();

    if (isNew) {
      if (type === "transfer" || repeat === "once") {
        await store.put([{ id: uid(), t: "txn", updatedAt: 0, ...b } as Txn]);
      } else if (repeat === "monthly") {
        const rule: Rule = {
          id: uid(), t: "rule", updatedAt: 0, type: type as Flow, amount, description: b.description, categoryId, accountId,
          day: Number(date.slice(8, 10)), startMonth: monthOf(date), ...(endMonth ? { endMonth } : {}),
          ...(b.propertyId ? { propertyId: b.propertyId } : {}), ...(b.vehicleId ? { vehicleId: b.vehicleId } : {}),
        };
        const recs: (Rule | Txn)[] = [rule];
        // 1º mês já pago/recebido: grava o lançamento confirmado desse mês.
        if (paid && !onCard) recs.push({ id: uid(), t: "txn", updatedAt: 0, ...b, ruleId: rule.id, ruleMonth: rule.startMonth } as Txn);
        await store.put(recs);
      } else {
        const plan: Plan = { id: uid(), t: "plan", updatedAt: 0, type: type as Flow, total: amount, count: n, description: b.description, categoryId, accountId, firstDate: date, ...(b.propertyId ? { propertyId: b.propertyId } : {}), ...(b.vehicleId ? { vehicleId: b.vehicleId } : {}) };
        const today = todayISO();
        const parts = splitInstallments(amount, n).map((v, i): Txn => {
          const d = addMonthsToDate(date, i);
          return { id: uid(), t: "txn", updatedAt: 0, ...b, amount: v, date: d, paid: onCard || (paid && d <= today), planId: plan.id, installment: i + 1 } as Txn;
        });
        await store.put([plan, ...parts]);
      }
      return onClose();
    }

    // Edição
    if (item!.rule && scope === "future") {
      const r = item!.rule;
      const m = item!.txn.ruleMonth!;
      const next: Omit<Rule, "id" | "startMonth" | "endMonth" | "updatedAt" | "t"> = {
        type: type as Flow, amount, description: b.description, categoryId, accountId, day: Number(date.slice(8, 10)),
        propertyId: b.propertyId, vehicleId: b.vehicleId,
      };
      const recs: (Rule | Txn)[] = [];
      if (m === r.startMonth) {
        recs.push({ ...r, ...next });
      } else {
        recs.push({ ...r, endMonth: addMonths(m, -1) });
        recs.push({ id: uid(), t: "rule", updatedAt: 0, ...next, startMonth: m, ...(r.endMonth ? { endMonth: r.endMonth } : {}) });
      }
      // este mês: confirma com os valores (se marcado como pago) ou só atualiza o que já existia
      if (!item!.virtual) recs.push({ ...item!.txn, ...b, ruleId: m === r.startMonth ? r.id : recs[1].id, ruleMonth: m });
      else if (paid && !onCard) recs.push({ id: uid(), t: "txn", updatedAt: 0, ...b, ruleId: m === r.startMonth ? r.id : recs[1].id, ruleMonth: m } as Txn);
      await store.put(recs);
      return onClose();
    }

    // Compra parcelada inteira: atualiza o parcelamento e refaz valores/datas de todas as parcelas
    if (allPlan) {
      const p = plan!;
      const today = todayISO();
      const wasCard = isCard(data.accounts.find((a) => a.id === p.accountId));
      const existing = new Map(data.txns.filter((x) => x.planId === p.id && x.installment).map((x) => [x.installment!, x]));
      const values = splitInstallments(amount, n);
      const recs: (Plan | Txn)[] = [{ ...p, type: type as Flow, total: amount, count: n, description: b.description, categoryId, accountId, firstDate: date, propertyId: b.propertyId, vehicleId: b.vehicleId }];
      values.forEach((v, i) => {
        const old = existing.get(i + 1);
        const d = addMonthsToDate(date, i);
        const paidNow = onCard || (old && !wasCard ? old.paid : d <= today);
        // parcela excluída antes ("só esta parcela") continua excluída; só cria as que passaram do nº antigo
        if (old) recs.push({ ...old, ...b, amount: v, date: d, paid: paidNow, installment: i + 1 } as Txn);
        else if (i + 1 > p.count) recs.push({ id: uid(), t: "txn", updatedAt: 0, ...b, amount: v, date: d, paid: paidNow, planId: p.id, installment: i + 1 } as Txn);
      });
      await store.put(recs);
      const extra = [...existing.values()].filter((x) => x.installment! > n);
      if (extra.length) await store.del(extra);
      return onClose();
    }

    // Despesa/receita única que passa a ser mensal: cria a recorrente e o lançamento vira o 1º mês (mesmo id)
    if (canMakeMonthly && repeat === "monthly") {
      const rule: Rule = {
        id: uid(), t: "rule", updatedAt: 0, type: type as Flow, amount, description: b.description, categoryId, accountId,
        day: Number(date.slice(8, 10)), startMonth: monthOf(date), ...(endMonth ? { endMonth } : {}),
        ...(b.propertyId ? { propertyId: b.propertyId } : {}), ...(b.vehicleId ? { vehicleId: b.vehicleId } : {}),
      };
      await store.put([rule, { ...item!.txn, ...b, ruleId: rule.id, ruleMonth: rule.startMonth } as Txn]);
      return onClose();
    }

    const id = item!.virtual ? uid() : item!.txn.id; // mês previsto de recorrente vira lançamento gravado
    await store.put([{ ...item!.txn, ...b, id, updatedAt: 0 } as Txn]);
    onClose();
  }

  async function remove(kind: "this" | "plan" | "skip" | "end") {
    const tx = item!.txn;
    if (kind === "this") await store.del([tx]);
    if (kind === "plan" && item!.plan) {
      await store.del([item!.plan, ...data.txns.filter((x) => x.planId === item!.plan!.id)]);
    }
    if (kind === "skip") {
      // pular o mês: registro excluído para esse mês (a regra não gera mais esse mês)
      const rec = item!.virtual ? { ...tx, id: uid() } : tx;
      await store.del([rec]);
    }
    if (kind === "end" && item!.rule) {
      const r = item!.rule;
      const m = tx.ruleMonth!;
      const future = data.txns.filter((x) => x.ruleId === r.id && x.ruleMonth! >= m);
      if (m <= r.startMonth) await store.del([r, ...future]);
      else { await store.put([{ ...r, endMonth: addMonths(m, -1) }]); if (future.length) await store.del(future); }
    }
    onClose();
  }

  const title = isNew ? "Novo lançamento"
    : item!.plan ? (allPlan ? "Compra parcelada" : `Parcela ${item!.txn.installment}/${item!.plan.count}`)
    : item!.rule ? `Recorrente · ${monthLong(item!.txn.ruleMonth!)}`
    : `Editar ${TYPE_LABEL[type].toLowerCase()}`;

  if (deleting && item) {
    return (
      <Sheet title="Excluir" onClose={onClose} onSubmit={(e) => e.preventDefault()}
        actions={<button type="button" class="btn ghost" onClick={() => setDeleting(false)}>Voltar</button>}>
        <p class="muted small">{item.txn.description} · {money(item.txn.amount)}</p>
        <div class="choices">
          {item.rule ? (
            <>
              <button type="button" class="btn ghost danger" onClick={() => remove("skip")}>Só este mês</button>
              <button type="button" class="btn ghost danger" onClick={() => remove("end")}>Este e os próximos (encerrar recorrência)</button>
            </>
          ) : item.plan ? (
            <>
              <button type="button" class="btn ghost danger" onClick={() => remove("this")}>Só esta parcela</button>
              <button type="button" class="btn ghost danger" onClick={() => { if (confirm(`Excluir as ${item.plan!.count} parcelas?`)) remove("plan"); }}>Todas as parcelas</button>
            </>
          ) : (
            <button type="button" class="btn ghost danger" onClick={() => remove("this")}>Excluir lançamento</button>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={title} onClose={onClose} onSubmit={submit}
      actions={<>
        {item && <button type="button" class="btn ghost danger" onClick={() => setDeleting(true)}>Excluir</button>}
        <button type="button" class="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" class={`btn primary ${type}`}>Salvar</button>
      </>}>
      {isNew && (
        <div class="seg wide" role="group" aria-label="Tipo">
          {(["expense", "income", "transfer"] as const).map((k) => (
            <button key={k} type="button" class={type === k ? `on ${k}` : ""} aria-pressed={type === k}
              onClick={() => { setType(k); setCategoryId(""); if (k === "transfer") setRepeat("once"); setError(null); }}>{TYPE_LABEL[k]}</button>
          ))}
        </div>
      )}
      <MoneyInput label={splitting ? "Valor total" : "Valor"} value={amount} onChange={(v) => { setAmount(v); setError(null); }} autoFocus={isNew} />
      {splitting && n >= 2 && amount > 0 && (
        <p class="muted small hint">{n}× de {money(splitInstallments(amount, n)[0])}{amount % n ? ` (última ${money(splitInstallments(amount, n)[n - 1])})` : ""}</p>
      )}
      <label>Descrição<input type="text" value={description} placeholder={type === "transfer" ? "Transferência" : "opcional (usa a categoria)"} onInput={(e) => setDescription(e.currentTarget.value)} /></label>

      {type !== "transfer" && (
        <div class="field">
          <span class="label">Categoria</span>
          <div class="chips cats">
            {cats.map((c) => (
              <button key={c.id} type="button" class={`chip ${categoryId === c.id ? "on" : ""}`} aria-pressed={categoryId === c.id}
                onClick={() => { setCategoryId(c.id); setError(null); }}>{c.emoji} {c.name}</button>
            ))}
            <button type="button" class="chip add" onClick={() => store.openCategory({ type: type as Flow })}>+ nova</button>
          </div>
        </div>
      )}

      <div class="two">
        <label>{type === "transfer" ? "De" : data.cards.size ? "Conta ou cartão" : "Conta"}
          <select value={accountId} onChange={(e) => setAccountId(e.currentTarget.value)}>
            <AccountOptions list={accounts} />
          </select>
        </label>
        {type === "transfer" ? (
          <label>Para
            <select value={toAccountId} onChange={(e) => {
              const id = e.currentTarget.value;
              setToAccountId(id);
              const card = data.accounts.find((a) => a.id === id && isCard(a));
              setBillFor(card ? pickBill(card, date) : "");
              if (card && !description.trim()) setDescription(`Fatura ${card.name}`);
            }}>
              <option value="">—</option>
              <AccountOptions list={accounts.filter((a) => a.id !== accountId)} />
            </select>
          </label>
        ) : (
          <label>{(isNew && repeat !== "once") || allPlan ? "Primeira data" : "Data"}<input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
        )}
      </div>
      {type === "transfer" && <label>Data<input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>}
      {type === "transfer" && toCard && (
        <label>Pagamento da fatura
          <select value={billFor} onChange={(e) => setBillFor(e.currentTarget.value)}>
            {billChoices.map(({ m, b }) => (
              <option key={m} value={m}>Vence {b ? dayMonth(b.due) : monthLong(m).toLowerCase()}{b ? ` · ${money(b.total)}${b.remaining && b.remaining < b.total ? ` (falta ${money(b.remaining)})` : !b.remaining ? " (paga)" : ""}` : ""}</option>
            ))}
            <option value="">Não é pagamento de fatura</option>
          </select>
        </label>
      )}
      {onCard && cardBillMonth && (
        <p class="muted small hint">
          {type === "income" ? "Estorno/crédito: abate" : "Entra"} na fatura que vence {cardBill ? `${dayMonth(cardBill.due)}` : monthLong(cardBillMonth).toLowerCase()}
          {splitting ? " (1ª parcela; as demais nas faturas seguintes)" : ""}.
        </p>
      )}

      {type === "expense" && data.properties.some((p) => !p.archived || p.id === propertyId) && (
        <label>Imóvel (opcional)
          <select value={propertyId} onChange={(e) => setPropertyId(e.currentTarget.value)}>
            <option value="">Nenhum</option>
            {data.properties.filter((p) => !p.archived || p.id === propertyId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {type === "expense" && data.vehicles.some((v) => !v.archived || v.id === vehicleId) && (
        <label>Veículo (opcional)
          <select value={vehicleId} onChange={(e) => setVehicleId(e.currentTarget.value)}>
            <option value="">Nenhum</option>
            {data.vehicles.filter((v) => !v.archived || v.id === vehicleId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      )}

      {!onCard && !allPlan && (
        <label class="toggle">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.currentTarget.checked)} />
          <span>{type === "income" ? "Recebido" : type === "transfer" ? "Realizada" : "Pago"}{isNew && repeat !== "once" ? " (1ª ocorrência)" : ""}</span>
        </label>
      )}

      {(isNew || canMakeMonthly) && type !== "transfer" && (
        <div class="field">
          <span class="label">Repetição</span>
          <div class="seg wide" role="group" aria-label="Repetição">
            {(isNew ? ([["once", "Única"], ["monthly", "Todo mês"], ["installments", "Parcelada"]] as const) : ([["once", "Única"], ["monthly", "Todo mês"]] as const)).map(([k, l]) => (
              <button key={k} type="button" class={repeat === k ? "on" : ""} aria-pressed={repeat === k} onClick={() => { setRepeat(k); setError(null); }}>{l}</button>
            ))}
          </div>
          {!isNew && repeat === "monthly" && <p class="muted small hint">Este lançamento vira o 1º mês ({monthLong(monthOf(date)).toLowerCase()}); os próximos aparecem como previstos.</p>}
          {repeat === "monthly" && (
            <label>Até (opcional — em branco = sem fim)<input type="month" value={endMonth} min={monthOf(date)} onInput={(e) => setEndMonth(e.currentTarget.value)} /></label>
          )}
          {repeat === "installments" && (
            <label>Número de parcelas<input type="number" inputMode="numeric" min="2" max="120" value={count} onInput={(e) => { setCount(e.currentTarget.value); setError(null); }} /></label>
          )}
        </div>
      )}

      {item?.rule && (
        <div class="field">
          <span class="label">Aplicar alteração em</span>
          <div class="seg wide" role="group" aria-label="Escopo">
            <button type="button" class={scope === "this" ? "on" : ""} aria-pressed={scope === "this"} onClick={() => setScope("this")}>Só este mês</button>
            <button type="button" class={scope === "future" ? "on" : ""} aria-pressed={scope === "future"} onClick={() => setScope("future")}>Este e os próximos</button>
          </div>
        </div>
      )}
      {plan && (
        <div class="field">
          <span class="label">Aplicar alteração em</span>
          <div class="seg wide" role="group" aria-label="Escopo">
            <button type="button" class={planScope === "this" ? "on" : ""} aria-pressed={planScope === "this"} onClick={() => choosePlanScope("this")}>Só esta parcela</button>
            <button type="button" class={planScope === "all" ? "on" : ""} aria-pressed={planScope === "all"} onClick={() => choosePlanScope("all")}>Compra inteira</button>
          </div>
          {allPlan && <label>Número de parcelas<input type="number" inputMode="numeric" min="2" max="120" value={count} onInput={(e) => { setCount(e.currentTarget.value); setError(null); }} /></label>}
          <p class="muted small hint">{allPlan
            ? "Valor total, descrição, categoria, conta e datas valem para todas as parcelas (as já pagas continuam pagas)."
            : `Parcelamento: ${money(plan.total)} em ${plan.count}× · muda só a parcela ${t!.installment}.`}</p>
        </div>
      )}
      {error && <p class="error" role="alert">{error}</p>}
    </Sheet>
  );
}

/** Opções de conta, com os cartões num grupo separado. */
function AccountOptions({ list }: { list: Account[] }) {
  const accs = list.filter((a) => !isCard(a) && !isInvestAccount(a));
  const cards = list.filter(isCard);
  const invs = list.filter(isInvestAccount);
  if (!cards.length && !invs.length) return <>{accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</>;
  return (
    <>
      <optgroup label="Contas">{accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
      {cards.length > 0 && <optgroup label="Cartões de crédito">{cards.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
      {invs.length > 0 && <optgroup label="Investimentos">{invs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
    </>
  );
}
