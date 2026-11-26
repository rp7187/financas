import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import * as db from "./db";
import { DEFAULTS_VERSION, MERGES, PURPOSES, RENAMES, defaultRecords } from "./defaults";
import { indexData, type Data, type Item } from "./engine";
import type { Category, Property, Rec, Vehicle } from "./model";
import { thisMonth } from "./dates";
import { MonthView } from "./components/month";
import { Accounts } from "./components/accounts";
import { Stats } from "./components/stats";
import { Settings } from "./components/settings";
import { TxnSheet, type TxnDraft } from "./components/txn-sheet";
import { AccountSheet, type AccountTarget } from "./components/account-sheet";
import { CategorySheet } from "./components/category-sheet";
import { PropertySheet } from "./components/property-sheet";
import { VehicleSheet } from "./components/vehicle-sheet";
import { Icon, type IconName } from "./components/icons";
import { Investments, ValuationSheet } from "./components/investments";
import * as sync from "./sync";

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
  /** Estado da sincronização com a família. */
  sync: sync.SyncState;
  openTxn: (x: Item | TxnDraft) => void;
  openAccount: (a: AccountTarget) => void;
  openCategory: (c: Category | { type: Category["type"] }) => void;
  openProperty: (p: Property | null) => void;
  openVehicle: (v: Vehicle | null) => void;
  /** Troca de tela (ex.: engrenagem → Ajustes; voltar de Ajustes). */
  go: (tab: Tab) => void;
  /** Tela de onde se abriu Ajustes (para o "voltar"). */
  from: Tab;
  /** Atualizar os saldos dos investimentos (mês). */
  openValuations: () => void;
};

export type Tab = "month" | "accounts" | "stats" | "invest" | "settings";
// Ajustes não fica na barra (engrenagem no topo das telas).
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "month", label: "Mês", icon: "calendar" },
  { id: "accounts", label: "Contas", icon: "wallet" },
  { id: "stats", label: "Análises", icon: "chart" },
  { id: "invest", label: "Investimentos", icon: "trend" },
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

/**
 * Unificações e renomeações de padrões, para aparelhos que estavam numa versão anterior dos dados iniciais.
 * Unificar só acontece se a categoria de destino existir e não estiver excluída (senão nada é movido).
 */
async function migrateDefaults(rs: Rec[], version: number): Promise<Rec[]> {
  const now = Date.now();
  const byId = new Map(rs.map((r) => [r.id, r]));
  const changes = new Map<string, Rec>();
  const cur = (id: string) => changes.get(id) ?? byId.get(id);
  for (const m of MERGES) {
    if (version >= m.since) continue;
    const from = cur(m.from), to = cur(m.to);
    if (!from || from.deleted || !to || to.deleted) continue;
    for (const r of rs) {
      if ((r.t === "txn" || r.t === "rule" || r.t === "plan") && r.categoryId === m.from) {
        changes.set(r.id, { ...(cur(r.id) as typeof r), categoryId: m.to, updatedAt: now });
      }
    }
    changes.set(from.id, { ...from, deleted: true, updatedAt: now });
  }
  for (const n of RENAMES) {
    if (version >= n.since) continue;
    const c = cur(n.id);
    if (c && c.t === "category" && !c.deleted && c.name.trim() === n.from) changes.set(c.id, { ...c, name: n.to, updatedAt: now });
  }
  for (const p of PURPOSES) {
    if (version >= p.since) continue;
    const c = cur(p.id);
    if (c && c.t === "category" && !c.deleted && !c.purpose) changes.set(c.id, { ...c, purpose: p.purpose, updatedAt: now });
  }
  if (!changes.size) return rs;
  await db.putMany([...changes.values()]);
  for (const c of changes.values()) byId.set(c.id, c);
  return [...byId.values()];
}

/** Convite no endereço (#familia=…): oferece entrar e tira a chave da barra de endereço. */
function handleInvite() {
  const invite = sync.parseInvite(location.hash);
  if (!invite) return;
  history.replaceState(null, "", location.pathname + location.search);
  if (sync.getState().status !== "off") return alert("Este aparelho já sincroniza com uma família.");
  if (confirm("Entrar na família deste convite? Os dados da família serão trazidos para este aparelho (o que só existe aqui é acrescentado).")) {
    sync.joinFamily(`familia=${invite.familyId}.${invite.key}`).catch((e) => alert(e instanceof Error ? e.message : String(e)));
  }
}

export function App() {
  const [records, setRecords] = useState<Rec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("month");
  const [from, setFrom] = useState<Tab>("month");
  const [valuations, setValuations] = useState(false);
  const [month, setMonth] = useState(thisMonth());
  const [txnSheet, setTxnSheet] = useState<Item | TxnDraft | null>(null);
  const [txnKey, setTxnKey] = useState(0); // formulário novo a cada abertura (ex.: duplicar a partir de outro)
  const openTxn = (x: Item | TxnDraft) => { setTxnKey((k) => k + 1); setTxnSheet(x); };
  const [accountSheet, setAccountSheet] = useState<AccountTarget | undefined>(undefined);
  const [categorySheet, setCategorySheet] = useState<Category | { type: Category["type"] } | null>(null);
  const [propertySheet, setPropertySheet] = useState<Property | null | undefined>(undefined);
  const [vehicleSheet, setVehicleSheet] = useState<Vehicle | null | undefined>(undefined);
  const [syncState, setSyncState] = useState<sync.SyncState>(sync.getState());

  useEffect(() => {
    (async () => {
      let rs = await db.getAll();
      // Dados iniciais (categorias sugeridas + conta principal, ids fixos — ver defaults.ts).
      // 1º uso: tudo. Versões novas: só os padrões que ainda não existem neste aparelho.
      const seeded = await db.getMeta<boolean | number>("seeded");
      const version = seeded === true ? 1 : typeof seeded === "number" ? seeded : 0;
      if (version < DEFAULTS_VERSION) {
        if (version > 0) rs = await migrateDefaults(rs, version);
        rs = await applyDefaults(rs);
        await db.setMeta("seeded", DEFAULTS_VERSION);
      }
      setRecords(rs);
      // Sincronização: o que chega de outro aparelho entra direto na tela.
      await sync.initSync({
        onRemote: (changed) => setRecords((cur) => {
          const map = new Map((cur ?? []).map((r) => [r.id, r]));
          for (const r of changed) map.set(r.id, r);
          return [...map.values()];
        }),
        onState: setSyncState,
      });
      // Link de convite aberto no navegador (#familia=…), ao abrir ou com o app já aberto.
      handleInvite();
      window.addEventListener("hashchange", handleInvite);
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
    put: async (rs) => { const now = Date.now(); await save(rs.map((r) => ({ ...r, updatedAt: now }))); sync.markDirty(rs.map((r) => r.id)); },
    del: async (rs) => { const now = Date.now(); await save(rs.map((r) => ({ ...r, deleted: true as const, updatedAt: now }))); sync.markDirty(rs.map((r) => r.id)); },
    importRecords: async (rs) => {
      const cur = new Map(records.map((r) => [r.id, r]));
      const newer = rs.filter((r) => !cur.has(r.id) || cur.get(r.id)!.updatedAt < r.updatedAt);
      await save(newer);
      sync.markDirty(newer.map((r) => r.id));
      return newer.length;
    },
    clear: async () => {
      await sync.leaveFamily(false); // este aparelho para de sincronizar (a família na nuvem continua)
      await db.clearAll();
      await db.setMeta("seeded", 0);
      location.reload();
    },
    sync: syncState,
    openTxn,
    openAccount: setAccountSheet,
    openCategory: setCategorySheet,
    openProperty: setPropertySheet,
    openVehicle: setVehicleSheet,
    go: (t) => { if (t === "settings") setFrom(tab); setTab(t); window.scrollTo(0, 0); },
    from,
    openValuations: () => setValuations(true),
  };

  return (
    <>
      <main class="page">
        {tab === "month" && <MonthView store={store} />}
        {tab === "accounts" && <Accounts store={store} />}
        {tab === "stats" && <Stats store={store} />}
        {tab === "invest" && <Investments store={store} />}
        {tab === "settings" && <Settings store={store} />}
      </main>
      <nav class="tabbar" aria-label="Navegação">
        {TABS.slice(0, 2).map((t) => <TabButton key={t.id} t={t} on={tab === t.id} go={() => { setTab(t.id); window.scrollTo(0, 0); }} />)}
        <button type="button" class="plus" aria-label="Novo lançamento" onClick={() => openTxn({ draft: true })}><Icon name="plus" /></button>
        {TABS.slice(2).map((t) => <TabButton key={t.id} t={t} on={tab === t.id} go={() => { setTab(t.id); window.scrollTo(0, 0); }} />)}
      </nav>
      {txnSheet && <TxnSheet key={txnKey} store={store} target={txnSheet} onClose={() => setTxnSheet(null)} />}
      {accountSheet !== undefined && <AccountSheet store={store} account={accountSheet} onClose={() => setAccountSheet(undefined)} />}
      {categorySheet && <CategorySheet store={store} target={categorySheet} onClose={() => setCategorySheet(null)} />}
      {valuations && <ValuationSheet store={store} onClose={() => setValuations(false)} />}
      {propertySheet !== undefined && <PropertySheet store={store} property={propertySheet} onClose={() => setPropertySheet(undefined)} />}
      {vehicleSheet !== undefined && <VehicleSheet store={store} vehicle={vehicleSheet} onClose={() => setVehicleSheet(undefined)} />}
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
