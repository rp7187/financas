import { useEffect, useState } from "preact/hooks";
import type { Store } from "../app";
import { requestPersist } from "../db";
import { isRec, type Flow } from "../model";

export function Settings({ store }: { store: Store }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [flow, setFlow] = useState<Flow>("expense");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  useEffect(() => { requestPersist().then(setPersisted); }, []);

  const cats = store.data.categories.filter((c) => c.type === flow);

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
      const data = JSON.parse(await file.text());
      const list: unknown[] = Array.isArray(data) ? data : data?.records;
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

      <section class="card">
        <div class="card-title">
          <h2>Categorias</h2>
          <div class="seg small" role="group" aria-label="Tipo">
            <button type="button" class={flow === "expense" ? "on" : ""} onClick={() => setFlow("expense")}>Despesas</button>
            <button type="button" class={flow === "income" ? "on" : ""} onClick={() => setFlow("income")}>Receitas</button>
          </div>
        </div>
        <div class="chips">
          {cats.map((c) => (
            <button key={c.id} type="button" class={`chip ${c.archived ? "archived" : ""}`} onClick={() => store.openCategory(c)}>{c.emoji} {c.name}{c.archived ? " (arquivada)" : ""}</button>
          ))}
          <button type="button" class="chip add" onClick={() => store.openCategory({ type: flow })}>+ nova</button>
        </div>
      </section>

      <section class="card">
        <h2>Família e sincronização</h2>
        <p class="muted small">Em breve: entrar com e-mail, convidar a família e sincronizar Mac e iPhones (com criptografia no aparelho). Por enquanto os dados ficam só neste aparelho.</p>
      </section>

      <section class="card">
        <h2>Backup</h2>
        <p class="muted small">Exporte de vez em quando e guarde no Arquivos/iCloud.</p>
        <div class="actions">
          <button type="button" class="btn primary" onClick={exportBackup}>Exportar backup</button>
          <label class="btn ghost file">Importar backup
            <input type="file" accept="application/json,.json" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) importBackup(f); e.currentTarget.value = ""; }} />
          </label>
        </div>
        {msg && <p class="note" role="status">{msg}</p>}
      </section>

      <section class="card">
        <h2>Armazenamento</h2>
        <ul class="facts">
          <li><span class="muted">Lançamentos</span><b>{store.data.txns.length}</b></li>
          <li><span class="muted">Recorrentes / parcelamentos</span><b>{store.data.rules.length} / {store.data.plans.length}</b></li>
          <li><span class="muted">Instalado como app</span><b>{standalone ? "sim" : "não"}</b></li>
          <li><span class="muted">Armazenamento protegido</span><b>{persisted == null ? "—" : persisted ? "sim" : "não"}</b></li>
        </ul>
        {!standalone && <p class="muted small">iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Mac: Safari → Arquivo → Adicionar ao Dock.</p>}
      </section>

      <section class="card">
        <h2>Apagar tudo</h2>
        <p class="muted small">Remove todos os dados deste aparelho e recomeça com as categorias padrão. Exporte um backup antes.</p>
        <button type="button" class="btn ghost danger" onClick={async () => {
          if (confirm("Apagar todos os dados deste aparelho?") && confirm("Tem certeza? Não dá para desfazer.")) await store.clear();
        }}>Apagar todos os dados</button>
      </section>
    </>
  );
}
