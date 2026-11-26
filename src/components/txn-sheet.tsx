import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, addMonthsToDate, dayMonth, monthLong, monthOf, thisMonth, todayISO } from "../dates";
import { bill, billMonthOf, type Item } from "../engine";
import { isCard, isInvestAccount, money, splitInstallments, uid, type Account, type Flow, type Plan, type Rule, type Txn } from "../model";
import { MoneyInput, Sheet } from "./sheet";
import { Icon } from "./icons";

/** Novo lançamento (com valores iniciais opcionais; ex.: pagamento de fatura já preenchido, ou cópia de outro). */
export type TxnDraft = {
  draft: true; type?: Flow | "transfer"; accountId?: string;
  toAccountId?: string; amount?: number; description?: string; date?: string; billFor?: string;
  categoryId?: string; propertyId?: string; vehicleId?: string; paid?: boolean;
  repeat?: Repeat; count?: number; every?: number; dates?: string[]; endMonth?: string;
  /** cópia de outro lançamento (título "Duplicar") */
  copy?: boolean;
};
type Kind = Flow | "transfer";
type Repeat = "once" | "monthly" | "installments";

/** Intervalo entre parcelas, em meses. */
const EVERY: [number, string][] = [[1, "Mensal"], [2, "Bimestral"], [3, "Trimestral"], [4, "Quadrimestral"], [6, "Semestral"], [12, "Anual"]];
const regularDates = (first: string, n: number, every: number) => Array.from({ length: n }, (_, i) => addMonthsToDate(first, i * every));

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
  const [categoryId, setCategoryId] = useState(t?.categoryId ?? draft?.categoryId ?? "");
  const [accountId, setAccountId] = useState(t?.accountId ?? defaultAccount);
  const [propertyId, setPropertyId] = useState(t?.propertyId ?? draft?.propertyId ?? "");
  const [vehicleId, setVehicleId] = useState(t?.vehicleId ?? draft?.vehicleId ?? "");
  const [toAccountId, setToAccountId] = useState(t?.toAccountId ?? draft?.toAccountId ?? accounts.find((a) => a.id !== defaultAccount && !isCard(a))?.id ?? "");
  const [date, setDate] = useState(t?.date ?? draft?.date ?? defaultDate);
  const [paid, setPaid] = useState(t ? t.paid : draft?.paid ?? (draft?.date ?? defaultDate) <= todayISO());
  const [repeat, setRepeat] = useState<Repeat>(draft?.repeat ?? "once");
  const [count, setCount] = useState(String(draft?.count ?? 2));
  const [endMonth, setEndMonth] = useState(draft?.endMonth ?? "");
  /** Parcelado: meses entre parcelas e, se ajustadas à mão, as datas de cada uma. */
  const [every, setEvery] = useState(draft?.every ?? 1);
  const [customDates, setCustomDates] = useState<string[] | null>(draft?.dates ?? null);
  const [showDates, setShowDates] = useState(!!draft?.dates);
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
    if (s === "all") {
      setAmount(plan.total); setDate(plan.firstDate); setCount(String(plan.count)); setEvery(plan.every ?? 1);
      // datas atuais das parcelas: se alguma foi mudada à mão (ou o parcelamento tem datas próprias), mantém
      const cur = data.txns.filter((x) => x.planId === plan.id && x.installment).sort((a, b) => a.installment! - b.installment!).map((x) => x.date);
      const reg = regularDates(plan.firstDate, plan.count, plan.every ?? 1);
      const custom = plan.dates ?? (cur.length === plan.count && cur.some((d, i) => d !== reg[i]) ? cur : null);
      setCustomDates(custom); setShowDates(!!custom);
    }
    else { setAmount(t!.amount); setDate(t!.date); }
  };
  const splitting = (isNew && repeat === "installments") || allPlan;
  /** Datas das parcelas: as ajustadas à mão, ou a cada `every` meses a partir da primeira. */
  const schedule = customDates && customDates.length === n ? [date, ...customDates.slice(1)] : regularDates(date, n, every);
  const custom = !!customDates && customDates.length === n;
  const planShape = () => ({ every: every > 1 ? every : undefined, dates: custom ? schedule : undefined });
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
    if (splitting && schedule.some((d, i) => !d || (i > 0 && d < schedule[i - 1]))) return "As datas das parcelas precisam estar preenchidas e em ordem.";
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
        const shape = planShape();
        const plan: Plan = { id: uid(), t: "plan", updatedAt: 0, type: type as Flow, total: amount, count: n, description: b.description, categoryId, accountId, firstDate: date, ...(shape.every ? { every: shape.every } : {}), ...(shape.dates ? { dates: shape.dates } : {}), ...(b.propertyId ? { propertyId: b.propertyId } : {}), ...(b.vehicleId ? { vehicleId: b.vehicleId } : {}) };
        const today = todayISO();
        const parts = splitInstallments(amount, n).map((v, i): Txn => {
          const d = schedule[i];
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
      const recs: (Plan | Txn)[] = [{ ...p, type: type as Flow, total: amount, count: n, description: b.description, categoryId, accountId, firstDate: date, ...planShape(), propertyId: b.propertyId, vehicleId: b.vehicleId }];
      values.forEach((v, i) => {
        const old = existing.get(i + 1);
        const d = schedule[i];
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

  /** Duplicar: abre um lançamento novo com os mesmos dados (só grava ao salvar). */
  const duplicate = () => {
    const tx = item!.txn;
    const copy: TxnDraft = {
      draft: true, copy: true, type, amount, description, date, accountId, paid: onCard ? undefined : paid,
      ...(type === "transfer" ? { toAccountId, ...(billFor ? { billFor } : {}) } : { categoryId }),
      ...(propertyId ? { propertyId } : {}), ...(vehicleId ? { vehicleId } : {}),
    };
    // compra parcelada inteira: copia o parcelamento (total, nº, frequência e datas); recorrente: continua mensal
    if (allPlan) Object.assign(copy, { repeat: "installments", count: n, every, ...(custom ? { dates: schedule } : {}) });
    else if (item!.rule && scope === "future") Object.assign(copy, { repeat: "monthly", date: tx.date });
    store.openTxn(copy);
  };

  const title = isNew ? (draft?.copy ? "Duplicar lançamento" : "Novo lançamento")
    : item!.plan ? (allPlan ? "Compra parcelada" : `Parcela ${item!.txn.installment}/${item!.plan.count}`)
    : item!.rule ? `Recorrente · ${monthLong(item!.txn.ruleMonth!)}`
    : `Editar ${TYPE_LABEL[type].toLowerCase()}`;

  // Parcelado: nº de parcelas, frequência e (opcional) datas de cada parcela ajustadas à mão
  const values = n >= 2 && n <= 120 ? splitInstallments(amount, n) : [];
  const scheduleUI = (
    <>
      <div class="two">
        <label>Número de parcelas<input type="number" inputMode="numeric" min="2" max="120" value={count} onInput={(e) => { setCount(e.currentTarget.value); setCustomDates(null); setError(null); }} /></label>
        <label>Frequência
          <select value={every} disabled={custom} onChange={(e) => { setEvery(Number(e.currentTarget.value)); setCustomDates(null); }}>
            {EVERY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            {!EVERY.some(([k]) => k === every) && <option value={every}>A cada {every} meses</option>}
          </select>
        </label>
      </div>
      {values.length > 0 && (
        <>
          <button type="button" class="link" onClick={() => setShowDates(!showDates)}>
            {showDates ? "Ocultar datas" : `Ver e ajustar as datas (${schedule.map((d) => dayMonth(d)).slice(0, 3).join(", ")}${n > 3 ? "…" : ""})`}
          </button>
          {showDates && (
            <ol class="sched">
              {schedule.map((d, i) => (
                <li key={i}>
                  <span class="muted num">{i + 1}ª</span>
                  {i === 0
                    ? <span class="sched-first">{d.split("-").reverse().join("/")} <small class="muted">(primeira data)</small></span>
                    : <input type="date" value={d} aria-label={`Data da parcela ${i + 1}`} onInput={(e) => { const v = e.currentTarget.value; setCustomDates(schedule.map((x, j) => (j === i ? v : x))); setError(null); }} />}
                  <b class="num">{money(values[i])}</b>
                </li>
              ))}
            </ol>
          )}
          {custom && (
            <p class="muted small hint">Datas ajustadas à mão. <button type="button" class="link" onClick={() => setCustomDates(null)}>Voltar para {EVERY.find(([k]) => k === every)?.[1].toLowerCase() ?? `a cada ${every} meses`}</button></p>
          )}
        </>
      )}
    </>
  );

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
          {splitting ? ` (1ª parcela; as demais nas faturas ${every === 1 && !custom ? "seguintes" : "das datas de cada parcela"})` : ""}.
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
          <span>{type === "income" ? "Recebido" : type === "transfer" ? "Realizada" : "Pago"}{isNew && repeat === "monthly" ? " (1ª ocorrência)" : isNew && repeat === "installments" ? " (parcelas com data até hoje)" : ""}</span>
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
          {repeat === "installments" && scheduleUI}
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
          {allPlan && scheduleUI}
          <p class="muted small hint">{allPlan
            ? "Valor total, descrição, categoria, conta e datas valem para todas as parcelas (as já pagas continuam pagas)."
            : `Parcelamento: ${money(plan.total)} em ${plan.count}× · muda só a parcela ${t!.installment}.`}</p>
        </div>
      )}
      {item && !item.bill && !item.estimate && (
        <button type="button" class="btn ghost wide" onClick={duplicate}><Icon name="copy" />Duplicar lançamento</button>
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
