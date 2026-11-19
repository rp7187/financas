import { useEffect, useState } from "preact/hooks";
import type { Store } from "../app";
import { addMonths, thisMonth } from "../dates";
import { requestPersist } from "../db";
import { byProperty, monthItems } from "../engine";
import { PROPERTY_KIND, colorOf, isRec, money, type Flow } from "../model";
import { Icon } from "./icons";

export function Settings({ store }: { store: Store }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [flow, setFlow] = useState<Flow>("expense");
  const [showArchived, setShowArchived] = useState(false);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  useEffect(() => { requestPersist().then(setPersisted); }, []);

  const { data } = store;
  const cats = data.categories.filter((c) => c.type === flow);
  const props = data.properties.filter((p) => showArchived || !p.archived);
  // custo de cada imóvel nos últimos 12 meses (inclui previstos)
  const cur = thisMonth();
  const year = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    for (const [id, v] of byProperty(monthItems(data, addMonths(cur, -i)))) year.set(id, (year.get(id) ?? 0) + v);
  }

  async function exportBackup() {
    const name = `financas-backup-${new Date().toISOString().slice(0, 10)}.json`;
    // inclui as marcas de exclusão: o backup é a base completa
    const blob = new Blob([JSON.stringify({ app: "financas", version: 1, exportedAt: new Date().toISOString(), records: store.records })], { type: "application/json" });
    const file = new File([blob], name, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "Backup finanças" }); setMsg("Backup compartilhado."); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg("Backup baixado.");
  }

  async function importBackup(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      const list: unknown[] = Array.isArray(parsed) ? parsed : parsed?.records;
      if (!Array.isArray(list)) throw new Error("arquivo sem registros");
      const valid = list.filter(isRec);
      if (!valid.length) throw new Error("nenhum registro válido");
      if (!confirm(`Importar ${valid.length} registro(s)? Para cada registro vale a versão mais recente (do arquivo ou deste aparelho).`)) return;
      const n = await store.importRecords(valid);
      setMsg(`${n} registro(s) novo(s) ou atualizado(s).`);
    } catch (e) {
      setMsg(`Não foi possível importar: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <header class="page-head"><h1>Ajustes</h1></header>

      <p class="section-label">Imóveis</p>
      <ul class="ios-list">
        {props.map((p) => (
          <li key={p.id}>
            <button type="button" class="ios-row" onClick={() => store.openProperty(p)}>
              <span class={`ic avatar ${colorOf(p)}`} style={{ cursor: "inherit", margin: 0 }}>{PROPERTY_KIND[p.kind].emoji}</span>
              <span class="grow"><span>{p.name}{p.archived ? " (arquivado)" : ""}</span><small>{PROPERTY_KIND[p.kind].label}{p.note ? ` · ${p.note}` : ""}</small></span>
              <span class="val num">{money(year.get(p.id) ?? 0)}</span>
              <Icon name="chevR" class="chev" />
            </button>
          </li>
        ))}
        <li>
          <button type="button" class="ios-row add" onClick={() => store.openProperty(null)}>
            <span class="ic"><Icon name="plus" /></span><span class="grow">Adicionar imóvel</span>
          </button>
        </li>
      </ul>
      <p class="muted small" style={{ margin: "-6px 6px 0" }}>
        Valor ao lado = custos dos últimos 12 meses. Ao lançar uma despesa, escolha o imóvel (opcional).
        {data.properties.some((p) => p.archived) && <> <button type="button" class="link" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Ocultar arquivados" : "Mostrar arquivados"}</button></>}
      </p>

      <p class="section-label">Categorias</p>
      <section class="card">
        <div class="seg wide" role="group" aria-label="Tipo" style={{ marginBottom: "14px" }}>
          <button type="button" class={flow === "expense" ? "on" : ""} onClick={() => setFlow("expense")}>Despesas</button>
          <button type="button" class={flow === "income" ? "on" : ""} onClick={() => setFlow("income")}>Receitas</button>
        </div>
        <div class="chips">
          {cats.map((c) => (
            <button key={c.id} type="button" class={`chip ${c.archived ? "archived" : ""}`} onClick={() => store.openCategory(c)}><i class={`cdot ${colorOf(c)}`} />{c.emoji} {c.name}</button>
          ))}
          <button type="button" class="chip add" onClick={() => store.openCategory({ type: flow })}>+ nova</button>
        </div>
      </section>

      <p class="section-label">Família e sincronização</p>
      <ul class="ios-list">
        <li>
          <div class="ios-row" style={{ cursor: "default" }}>
            <span class="ic"><Icon name="cloud" /></span>
            <span class="grow"><span>Em breve</span><small>Login por e-mail, convite da família e sincronização Mac + iPhones, com criptografia no aparelho.</small></span>
          </div>
        </li>
      </ul>

      <p class="section-label">Backup</p>
      <ul class="ios-list">
        <li><button type="button" class="ios-row" onClick={exportBackup}><span class="ic"><Icon name="download" /></span><span class="grow">Exportar backup</span><Icon name="chevR" class="chev" /></button></li>
        <li>
          <label class="ios-row btn-file">
            <span class="ic"><Icon name="upload" /></span><span class="grow">Importar backup</span><Icon name="chevR" class="chev" />
            <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) importBackup(f); e.currentTarget.value = ""; }} />
          </label>
        </li>
      </ul>
      {msg && <p class="note" role="status">{msg}</p>}

      <p class="section-label">Este aparelho</p>
      <section class="card">
        <ul class="facts">
          <li><span class="muted">Lançamentos</span><b>{data.txns.length}</b></li>
          <li><span class="muted">Recorrentes / parcelamentos</span><b>{data.rules.length} / {data.plans.length}</b></li>
          <li><span class="muted">Instalado como app</span><b>{standalone ? "sim" : "não"}</b></li>
          <li><span class="muted">Armazenamento protegido</span><b>{persisted == null ? "—" : persisted ? "sim" : "não"}</b></li>
        </ul>
        {!standalone && <p class="muted small">iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Mac: Safari → Arquivo → Adicionar ao Dock.</p>}
      </section>

      <ul class="ios-list">
        <li>
          <button type="button" class="ios-row danger" onClick={async () => {
            if (confirm("Apagar todos os dados deste aparelho?") && confirm("Tem certeza? Não dá para desfazer.")) await store.clear();
          }}><span class="ic"><Icon name="trash" /></span><span class="grow">Apagar todos os dados</span></button>
        </li>
      </ul>
    </>
  );
}
