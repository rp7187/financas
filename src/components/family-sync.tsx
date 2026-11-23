import { useState } from "preact/hooks";
import type { Store } from "../app";
import * as sync from "../sync";
import { Icon } from "./icons";

const ago = (t?: number) => {
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? "agora há pouco" : s < 3600 ? `há ${Math.round(s / 60)} min` : `às ${new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

/** Ajustes → Família e sincronização. */
export function FamilySync({ store }: { store: Store }) {
  const st = store.sync;
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [invite, setInvite] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg(ok); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (st.status === "off") {
    return (
      <>
        <ul class="ios-list">
          <li>
            <button type="button" class="ios-row" disabled={busy} onClick={() => {
              if (confirm("Criar a família com os dados deste aparelho? Eles serão criptografados aqui e guardados na nuvem; depois você convida os outros aparelhos.")) {
                run(sync.createFamily, "Família criada! Agora copie o link de convite e abra nos outros aparelhos.");
              }
            }}>
              <span class="ic"><Icon name="cloud" /></span>
              <span class="grow"><span>Criar família</span><small>Comece por aqui no aparelho que já tem os dados.</small></span>
              <Icon name="chevR" class="chev" />
            </button>
          </li>
          <li>
            <button type="button" class="ios-row" disabled={busy} onClick={() => setJoining(!joining)}>
              <span class="ic"><Icon name="download" /></span>
              <span class="grow"><span>Entrar com convite</span><small>Cole o link de convite gerado no outro aparelho.</small></span>
              <Icon name="chevR" class="chev" />
            </button>
          </li>
        </ul>
        {joining && (
          <section class="card sim">
            <label>Link de convite<input type="text" value={invite} placeholder="https://…#familia=…" autoComplete="off" onInput={(e) => { setInvite(e.currentTarget.value); setMsg(null); }} /></label>
            <button type="button" class="btn brand wide" disabled={busy || !sync.parseInvite(invite)} onClick={() =>
              run(async () => { await sync.joinFamily(invite); setInvite(""); setJoining(false); }, "Pronto! Este aparelho agora sincroniza com a família.")}>
              {busy ? "Entrando…" : "Entrar na família"}
            </button>
            <p class="muted small">Os dados da família são trazidos para este aparelho; o que só existe aqui é acrescentado à família.</p>
          </section>
        )}
        <p class="muted small family-note">Sincroniza Mac e iPhones da família. Tudo é criptografado no aparelho antes de ir para a nuvem: nem o servidor consegue ler.</p>
        {msg && <p class="note" role="status">{msg}</p>}
      </>
    );
  }

  const link = sync.inviteLink() ?? "";
  const status = st.status === "syncing" ? "Sincronizando…"
    : st.status === "offline" ? "Sem internet — sincroniza quando voltar"
    : st.status === "error" ? `Erro: ${st.error}`
    : st.lastSync ? `Sincronizado ${ago(st.lastSync)}` : "Conectado";

  return (
    <>
      <ul class="ios-list">
        <li>
          <button type="button" class="ios-row" disabled={busy || st.status === "syncing"} onClick={() => sync.syncNow()}>
            <span class={`ic sync-${st.status}`}><Icon name="cloud" /></span>
            <span class="grow"><span>{status}</span><small>Toque para sincronizar agora.</small></span>
          </button>
        </li>
        <li>
          <button type="button" class="ios-row" onClick={async () => {
            if (navigator.share) { try { await navigator.share({ title: "Convite — Finanças da família", url: link }); return; } catch { /* cancelado */ } }
            try { await navigator.clipboard.writeText(link); setMsg("Link de convite copiado."); } catch { setShowLink(true); }
          }}>
            <span class="ic"><Icon name="upload" /></span>
            <span class="grow"><span>Convidar outro aparelho</span><small>Envie o link para o seu Mac, iPhone ou para a família.</small></span>
            <Icon name="chevR" class="chev" />
          </button>
        </li>
        <li>
          <button type="button" class="ios-row" onClick={() => setShowLink(!showLink)}>
            <span class="ic"><Icon name="info" /></span>
            <span class="grow"><span>{showLink ? "Ocultar link" : "Mostrar link de convite"}</span><small>Guarde em local seguro (ex.: Senhas do iCloud).</small></span>
          </button>
        </li>
      </ul>
      {showLink && <p class="invite-link" onClick={(e) => getSelection()?.selectAllChildren(e.currentTarget)}>{link}</p>}
      <p class="muted small family-note">
        <b>Guarde o link de convite.</b> Ele contém a chave da família: quem tiver o link vê os dados, e sem ele (e sem nenhum aparelho)
        os dados na nuvem não podem ser lidos. No iPhone com o app na tela de início, cole o link em Ajustes → Entrar com convite.
      </p>
      {msg && <p class="note" role="status">{msg}</p>}
      <ul class="ios-list">
        <li>
          <button type="button" class="ios-row" disabled={busy} onClick={() => {
            if (confirm("Parar de sincronizar neste aparelho? Os dados continuam aqui e na família.")) run(() => sync.leaveFamily(false), "Este aparelho não sincroniza mais.");
          }}><span class="ic"><Icon name="cloud" /></span><span class="grow">Sair da família neste aparelho</span></button>
        </li>
        <li>
          <button type="button" class="ios-row danger" disabled={busy} onClick={() => {
            if (confirm("Apagar os dados da família da NUVEM? Os aparelhos mantêm os dados locais, mas param de sincronizar.") && confirm("Tem certeza? Não dá para desfazer.")) {
              run(() => sync.leaveFamily(true), "Família apagada da nuvem.");
            }
          }}><span class="ic"><Icon name="trash" /></span><span class="grow">Apagar a família da nuvem</span></button>
        </li>
      </ul>
    </>
  );
}
