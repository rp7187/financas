import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import * as db from "./db";
import { defaultRecords } from "./defaults";
import { indexData, type Data, type Item } from "./engine";
import type { Account, Category, Rec } from "./model";
import { thisMonth } from "./dates";
import { MonthView } from "./components/month";
import { Accounts } from "./components/accounts";
import { Stats } from "./components/stats";
import { Settings } from "./components/settings";
import { TxnSheet, type TxnDraft } from "./components/txn-sheet";
import { AccountSheet } from "./components/account-sheet";
import { CategorySheet } from "./components/category-sheet";

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
};

type Tab = "month" | "accounts" | "stats" | "settings";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "month", label: "Mês", icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" },
  { id: "accounts", label: "Contas", icon: "M3 9l9-5 9 5M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" },
  { id: "stats", label: "Estatísticas", icon: "M4 20V10m6 10V4m6 16v-7m4 7H2" },
  { id: "settings", label: "Ajustes", icon: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" },
];

export function App() {
  const [records, setRecords] = useState<Rec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("month");
  const [month, setMonth] = useState(thisMonth());
  const [txnSheet, setTxnSheet] = useState<Item | TxnDraft | null>(null);
  const [accountSheet, setAccountSheet] = useState<Account | null | undefined>(undefined);
  const [categorySheet, setCategorySheet] = useState<Category | { type: Category["type"] } | null>(null);

  useEffect(() => {
    (async () => {
      let rs = await db.getAll();
      // 1º uso: categorias sugeridas + conta principal (ids fixos, ver defaults.ts)
      if (!(await db.getMeta<boolean>("seeded"))) {
        const have = new Set(rs.map((r) => r.id));
        const seed = defaultRecords(Date.now()).filter((r) => !have.has(r.id));
        await db.putMany(seed);
        await db.setMeta("seeded", true);
        rs = [...rs, ...seed];
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
      await db.setMeta("seeded", false);
      location.reload();
    },
    openTxn: setTxnSheet,
    openAccount: setAccountSheet,
    openCategory: setCategorySheet,
  };

  return (
    <>
      <main class="page">
        {tab === "month" && <MonthView store={store} />}
        {tab === "accounts" && <Accounts store={store} />}
        {tab === "stats" && <Stats store={store} />}
        {tab === "settings" && <Settings store={store} />}
      </main>
      {(tab === "month" || tab === "accounts") && (
        <button type="button" class="fab" aria-label="Novo lançamento" onClick={() => setTxnSheet({ draft: true })}>+</button>
      )}
      <nav class="tabbar" aria-label="Navegação">
        {TABS.map((t) => (
          <button key={t.id} type="button" class={tab === t.id ? "on" : ""} aria-current={tab === t.id ? "page" : undefined}
            onClick={() => { setTab(t.id); window.scrollTo(0, 0); }}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d={t.icon} /></svg>
            {t.label}
          </button>
        ))}
      </nav>
      {txnSheet && <TxnSheet store={store} target={txnSheet} onClose={() => setTxnSheet(null)} />}
      {accountSheet !== undefined && <AccountSheet store={store} account={accountSheet} onClose={() => setAccountSheet(undefined)} />}
      {categorySheet && <CategorySheet store={store} target={categorySheet} onClose={() => setCategorySheet(null)} />}
    </>
  );
}
