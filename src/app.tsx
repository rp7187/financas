import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import * as db from "./db";
import { DEFAULTS_VERSION, defaultRecords } from "./defaults";
import { indexData, type Data, type Item } from "./engine";
import type { Account, Category, Property, Rec } from "./model";
import { thisMonth } from "./dates";
import { MonthView } from "./components/month";
import { Accounts } from "./components/accounts";
import { Stats } from "./components/stats";
import { Settings } from "./components/settings";
import { TxnSheet, type TxnDraft } from "./components/txn-sheet";
import { AccountSheet } from "./components/account-sheet";
import { CategorySheet } from "./components/category-sheet";
import { PropertySheet } from "./components/property-sheet";
import { Icon, type IconName } from "./components/icons";

export type Store = {
  records: Rec[];
  data: Data;
  month: string;
  setMonth: (m: string) => void;
  /** Grava (cria/atualiza) registros; carimba `updatedAt`. */
  put: (rs: Rec[]) => Promise<void>;
  /** Exclui = grava marca de exclusão (necessário para a sincronização saber que sumiu). */
  del: (rs: Rec[]) => Promise<void>;
  /** Importação de backup: mantém, por id, a versão mais recente. */
  importRecords: (rs: Rec[]) => Promise<number>;
  clear: () => Promise<void>;
  openTxn: (x: Item | TxnDraft) => void;
  openAccount: (a: Account | null) => void;
  openCategory: (c: Category | { type: Category["type"] }) => void;
  openProperty: (p: Property | null) => void;
};

type Tab = "month" | "accounts" | "stats" | "settings";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "month", label: "Mês", icon: "calendar" },
  { id: "accounts", label: "Contas", icon: "wallet" },
  { id: "stats", label: "Análises", icon: "chart" },
  { id: "settings", label: "Ajustes", icon: "sliders" },
];

/**
 * Acrescenta os padrões que faltam (por id). Excluídos de propósito não voltam.
 * Se o usuário já tem uma categoria com o mesmo nome e tipo de um padrão, ela é SUBSTITUÍDA pelo padrão:
 * lançamentos, recorrentes e parcelamentos passam a apontar para o id fixo e a antiga é excluída
 * (ids fixos evitam duplicatas quando a sincronização entre aparelhos chegar).
 */
async function applyDefaults(rs: Rec[]): Promise<Rec[]> {
  const now = Date.now();
  const have = new Set(rs.map((r) => r.id)); // inclui excluídos
  const changes: Rec[] = [];
  for (const d of defaultRecords(now)) {
    if (have.has(d.id)) continue;
    changes.push(d);
    if (d.t !== "category") continue;
    const dup = rs.find((r): r is Category => r.t === "category" && !r.deleted && r.type === d.type && r.name.trim().toLowerCase() === d.name.toLowerCase());
    if (!dup) continue;
    for (const r of rs) {
      if ((r.t === "txn" || r.t === "rule" || r.t === "plan") && r.categoryId === dup.id) changes.push({ ...r, categoryId: d.id, updatedAt: now });
    }
    changes.push({ ...dup, deleted: true, updatedAt: now });
  }
  if (!changes.length) return rs;
  await db.putMany(changes);
  const map = new Map(rs.map((r) => [r.id, r]));
  for (const c of changes) map.set(c.id, c);
  return [...map.values()];
}

export function App() {
  const [records, setRecords] = useState<Rec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("month");
  const [month, setMonth] = useState(thisMonth());
  const [txnSheet, setTxnSheet] = useState<Item | TxnDraft | null>(null);
  const [accountSheet, setAccountSheet] = useState<Account | null | undefined>(undefined);
  const [categorySheet, setCategorySheet] = useState<Category | { type: Category["type"] } | null>(null);
  const [propertySheet, setPropertySheet] = useState<Property | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      let rs = await db.getAll();
      // Dados iniciais (categorias sugeridas + conta principal, ids fixos — ver defaults.ts).
      // 1º uso: tudo. Versões novas: só os padrões que ainda não existem neste aparelho.
      const seeded = await db.getMeta<boolean | number>("seeded");
      const version = seeded === true ? 1 : typeof seeded === "number" ? seeded : 0;
      if (version < DEFAULTS_VERSION) {
        rs = await applyDefaults(rs);
        await db.setMeta("seeded", DEFAULTS_VERSION);
      }
      setRecords(rs);
    })().catch((e) => setError(String(e)));
    db.requestPersist();
  }, []);

  const save = useCallback(async (rs: Rec[]) => {
    try {
      await db.putMany(rs);
      setRecords((cur) => {
        const map = new Map((cur ?? []).map((r) => [r.id, r]));
        for (const r of rs) map.set(r.id, r);
        return [...map.values()];
      });
    } catch (e) {
      setError(`Não foi possível salvar: ${e}`);
    }
  }, []);

  const data = useMemo(() => indexData(records ?? []), [records]);

  if (error) return <main class="page"><p class="error">{error}</p></main>;
  if (!records) return <main class="page" />;

  const store: Store = {
    records,
    data,
    month,
    setMonth,
    put: (rs) => { const now = Date.now(); return save(rs.map((r) => ({ ...r, updatedAt: now }))); },
    del: (rs) => { const now = Date.now(); return save(rs.map((r) => ({ ...r, deleted: true as const, updatedAt: now }))); },
    importRecords: async (rs) => {
      const cur = new Map(records.map((r) => [r.id, r]));
      const newer = rs.filter((r) => !cur.has(r.id) || cur.get(r.id)!.updatedAt < r.updatedAt);
      await save(newer);
      return newer.length;
    },
    clear: async () => {
      await db.clearAll();
      await db.setMeta("seeded", 0);
      location.reload();
    },
    openTxn: setTxnSheet,
    openAccount: setAccountSheet,
    openCategory: setCategorySheet,
    openProperty: setPropertySheet,
  };

  return (
    <>
      <main class="page">
        {tab === "month" && <MonthView store={store} />}
        {tab === "accounts" && <Accounts store={store} />}
        {tab === "stats" && <Stats store={store} />}
        {tab === "settings" && <Settings store={store} />}
      </main>
      <nav class="tabbar" aria-label="Navegação">
        {TABS.slice(0, 2).map((t) => <TabButton key={t.id} t={t} on={tab === t.id} go={() => { setTab(t.id); window.scrollTo(0, 0); }} />)}
        <button type="button" class="plus" aria-label="Novo lançamento" onClick={() => setTxnSheet({ draft: true })}><Icon name="plus" /></button>
        {TABS.slice(2).map((t) => <TabButton key={t.id} t={t} on={tab === t.id} go={() => { setTab(t.id); window.scrollTo(0, 0); }} />)}
      </nav>
      {txnSheet && <TxnSheet store={store} target={txnSheet} onClose={() => setTxnSheet(null)} />}
      {accountSheet !== undefined && <AccountSheet store={store} account={accountSheet} onClose={() => setAccountSheet(undefined)} />}
      {categorySheet && <CategorySheet store={store} target={categorySheet} onClose={() => setCategorySheet(null)} />}
      {propertySheet !== undefined && <PropertySheet store={store} property={propertySheet} onClose={() => setPropertySheet(undefined)} />}
    </>
  );
}

function TabButton({ t, on, go }: { t: { id: Tab; label: string; icon: IconName }; on: boolean; go: () => void }) {
  return (
    <button type="button" class={`tab ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} onClick={go}>
      <Icon name={t.icon} />{t.label}
    </button>
  );
}
