import { useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, addMonthsToDate, monthLong, monthOf, thisMonth, todayISO } from "../dates";
import type { Item } from "../engine";
import { money, splitInstallments, uid, type Flow, type Plan, type Rule, type Txn } from "../model";
import { MoneyInput, Sheet } from "./sheet";

/** Novo lançamento (com valores iniciais opcionais). */
export type TxnDraft = { draft: true; type?: Flow | "transfer"; accountId?: string };
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
  // Recorrente: em lançamento novo, a data padrão segue o mês aberto na tela.
  const defaultDate = store.month === thisMonth() ? todayISO() : `${store.month}-01`;

  const [type, setType] = useState<Kind>(t?.type ?? ("draft" in target ? target.type : undefined) ?? "expense");
  const [amount, setAmount] = useState(t?.amount ?? 0);
  const [description, setDescription] = useState(t?.description ?? "");
  const [categoryId, setCategoryId] = useState(t?.categoryId ?? "");
  const [accountId, setAccountId] = useState(t?.accountId ?? defaultAccount);
  const [propertyId, setPropertyId] = useState(t?.propertyId ?? "");
  const [toAccountId, setToAccountId] = useState(t?.toAccountId ?? accounts.find((a) => a.id !== defaultAccount)?.id ?? "");
  const [date, setDate] = useState(t?.date ?? defaultDate);
  const [paid, setPaid] = useState(t ? t.paid : defaultDate <= todayISO());
  const [repeat, setRepeat] = useState<Repeat>("once");
  const [count, setCount] = useState("2");
  const [endMonth, setEndMonth] = useState("");
  const [scope, setScope] = useState<"this" | "future">("this");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cats = data.categories.filter((c) => c.type === type && (!c.archived || c.id === categoryId));
  const n = Math.max(0, Math.floor(Number(count) || 0));

  function validate(): string | null {
    if (amount <= 0) return "Informe o valor.";
    if (!date) return "Informe a data.";
    if (!accountId) return "Escolha a conta.";
    if (type === "transfer") {
      if (!toAccountId || toAccountId === accountId) return "Escolha contas diferentes de origem e destino.";
    } else if (!categoryId) return "Escolha a categoria.";
    if (isNew && repeat === "installments" && (n < 2 || n > 120)) return "Parcelas: de 2 a 120.";
    if (isNew && repeat === "monthly" && endMonth && endMonth < monthOf(date)) return "O fim da recorrência é antes do início.";
    return null;
  }

  const base = () => ({
    type, amount, date, paid,
    description: description.trim() || (type === "transfer" ? "Transferência" : data.categories.find((c) => c.id === categoryId)?.name ?? ""),
    accountId,
    ...(type === "transfer" ? { toAccountId, categoryId: undefined } : { categoryId, toAccountId: undefined }),
    propertyId: type === "expense" && propertyId ? propertyId : undefined,
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
          ...(b.propertyId ? { propertyId: b.propertyId } : {}),
        };
        const recs: (Rule | Txn)[] = [rule];
        // 1º mês já pago/recebido: grava o lançamento confirmado desse mês.
        if (paid) recs.push({ id: uid(), t: "txn", updatedAt: 0, ...b, ruleId: rule.id, ruleMonth: rule.startMonth } as Txn);
        await store.put(recs);
      } else {
        const plan: Plan = { id: uid(), t: "plan", updatedAt: 0, type: type as Flow, total: amount, count: n, description: b.description, categoryId, accountId, firstDate: date, ...(b.propertyId ? { propertyId: b.propertyId } : {}) };
        const today = todayISO();
        const parts = splitInstallments(amount, n).map((v, i): Txn => {
          const d = addMonthsToDate(date, i);
          return { id: uid(), t: "txn", updatedAt: 0, ...b, amount: v, date: d, paid: paid && d <= today, planId: plan.id, installment: i + 1 } as Txn;
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
        propertyId: b.propertyId,
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
      else if (paid) recs.push({ id: uid(), t: "txn", updatedAt: 0, ...b, ruleId: m === r.startMonth ? r.id : recs[1].id, ruleMonth: m } as Txn);
      await store.put(recs);
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
    : item!.plan ? `Parcela ${item!.txn.installment}/${item!.plan.count}`
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
      <MoneyInput label={isNew && repeat === "installments" ? "Valor total" : "Valor"} value={amount} onChange={(v) => { setAmount(v); setError(null); }} autoFocus={isNew} />
      {isNew && repeat === "installments" && n >= 2 && amount > 0 && (
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
        <label>{type === "transfer" ? "De" : "Conta"}
          <select value={accountId} onChange={(e) => setAccountId(e.currentTarget.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {type === "transfer" ? (
          <label>Para
            <select value={toAccountId} onChange={(e) => setToAccountId(e.currentTarget.value)}>
              <option value="">—</option>
              {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        ) : (
          <label>{isNew && repeat !== "once" ? "Primeira data" : "Data"}<input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
        )}
      </div>
      {type === "transfer" && <label>Data<input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>}

      {type === "expense" && data.properties.some((p) => !p.archived || p.id === propertyId) && (
        <label>Imóvel (opcional)
          <select value={propertyId} onChange={(e) => setPropertyId(e.currentTarget.value)}>
            <option value="">Nenhum</option>
            {data.properties.filter((p) => !p.archived || p.id === propertyId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}

      <label class="toggle">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.currentTarget.checked)} />
        <span>{type === "income" ? "Recebido" : type === "transfer" ? "Realizada" : "Pago"}{isNew && repeat !== "once" ? " (1ª ocorrência)" : ""}</span>
      </label>

      {isNew && type !== "transfer" && (
        <div class="field">
          <span class="label">Repetição</span>
          <div class="seg wide" role="group" aria-label="Repetição">
            {([["once", "Única"], ["monthly", "Todo mês"], ["installments", "Parcelada"]] as const).map(([k, l]) => (
              <button key={k} type="button" class={repeat === k ? "on" : ""} aria-pressed={repeat === k} onClick={() => { setRepeat(k); setError(null); }}>{l}</button>
            ))}
          </div>
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
      {item?.plan && <p class="muted small">Parcelamento: {money(item.plan.total)} em {item.plan.count}× · alterar aqui muda só esta parcela.</p>}
      {error && <p class="error" role="alert">{error}</p>}
    </Sheet>
  );
}
