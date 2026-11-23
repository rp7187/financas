/*
 * Sincronização entre aparelhos da família (fase 2).
 *
 * - Cada registro é criptografado NO APARELHO (AES-GCM 256, iv aleatório, id como dado autenticado) antes de subir.
 * - A chave da família só existe nos aparelhos e no link de convite (no fragmento "#", que não vai para servidor nenhum).
 * - O servidor (Supabase, ver supabase/schema.sql) só aceita quem manda a "prova" derivada da chave.
 * - Mescla por registro: vale o maior `updatedAt` (no servidor e aqui). Exclusões são marcas (`deleted`), nunca somem.
 * - O que mudou neste aparelho fica numa lista de pendentes (meta "syncDirty") até o servidor confirmar.
 */
import * as db from "./db";
import { isRec, type Rec } from "./model";
import { SUPABASE_KEY, SUPABASE_URL } from "./sync-config";

type Config = { familyId: string; key: string; lastRev: number; lastFull: number };
export type SyncState = {
  status: "off" | "idle" | "syncing" | "error" | "offline";
  familyId?: string;
  lastSync?: number;
  error?: string;
};

const META_CONFIG = "sync";
const META_DIRTY = "syncDirty";
const BATCH = 500;
const FULL_EVERY = 24 * 60 * 60 * 1000; // conferência completa 1×/dia (pega algo que tenha escapado)
const INTERVAL = 60 * 1000;

let config: Config | null = null;
let dirty = new Set<string>();
let state: SyncState = { status: "off" };
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let handlers: { onRemote: (rs: Rec[]) => void; onState: (s: SyncState) => void } | null = null;

const setState = (s: Partial<SyncState>) => { state = { ...state, ...s }; handlers?.onState(state); };
export const getState = () => state;

/* ---------------- Criptografia ---------------- */

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

let keyCache: { raw: string; key: CryptoKey } | null = null;
async function cryptoKey(raw: string): Promise<CryptoKey> {
  if (keyCache?.raw === raw) return keyCache.key;
  const key = await crypto.subtle.importKey("raw", unb64url(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  keyCache = { raw, key };
  return key;
}

/** Prova de que o aparelho tem a chave (o servidor guarda só o SHA-256 dela). */
async function proofOf(raw: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`financas-prova:${raw}`))));
}

async function encrypt(raw: string, r: Rec) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(r.id) }, await cryptoKey(raw), enc.encode(JSON.stringify(r)));
  return { id: r.id, updated_at: r.updatedAt, iv: b64(iv), data: b64(new Uint8Array(data)) };
}

async function decrypt(raw: string, row: { id: string; iv: string; data: string }): Promise<Rec | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv), additionalData: enc.encode(row.id) }, await cryptoKey(raw), unb64(row.data));
    const r = JSON.parse(dec.decode(plain));
    return isRec(r) && r.id === row.id ? r : null;
  } catch {
    return null; // registro corrompido ou de outra chave: ignora
  }
}

/* ---------------- Servidor ---------------- */

class SyncError extends Error {
  constructor(message: string, readonly offline = false) { super(message); }
}

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SyncError("Sem conexão com a internet.", true);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (txt.includes("familia_invalida")) throw new SyncError("Convite ou chave da família inválidos.");
    throw new SyncError(`Servidor respondeu ${res.status}${txt ? `: ${txt.slice(0, 160)}` : ""}`);
  }
  const txt = await res.text();
  return (txt ? JSON.parse(txt) : null) as T;
}

type Row = { id: string; updated_at: number; iv: string; data: string; rev: number };

async function pullAll(c: Config, since: number): Promise<{ recs: Rec[]; maxRev: number }> {
  const proof = await proofOf(c.key);
  const recs: Rec[] = [];
  let maxRev = since;
  for (;;) {
    const rows = await rpc<Row[]>("pull_records", { p_family: c.familyId, p_proof: proof, p_since: maxRev, p_limit: 1000 });
    for (const row of rows) {
      const r = await decrypt(c.key, row);
      if (r) recs.push(r);
      maxRev = Math.max(maxRev, row.rev);
    }
    if (rows.length < 1000) break;
  }
  return { recs, maxRev };
}

async function pushIds(c: Config, ids: string[]) {
  if (!ids.length) return;
  const proof = await proofOf(c.key);
  const byId = new Map((await db.getAll()).map((r) => [r.id, r]));
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const rows = await Promise.all(chunk.map((id) => byId.get(id)).filter((r): r is Rec => !!r).map((r) => encrypt(c.key, r)));
    if (rows.length) await rpc<number>("push_records", { p_family: c.familyId, p_proof: proof, p_rows: rows });
    for (const id of chunk) dirty.delete(id);
    await db.setMeta(META_DIRTY, [...dirty]);
  }
}

/** Grava aqui o que veio do servidor: só o que for mais recente (ou tudo, com `force`). Devolve o que mudou. */
async function applyRemote(recs: Rec[], force = false): Promise<Rec[]> {
  if (!recs.length) return [];
  const local = new Map((await db.getAll()).map((r) => [r.id, r]));
  const changed = recs.filter((r) => {
    const l = local.get(r.id);
    if (!l) return true;
    if (dirty.has(r.id) && !force) return l.updatedAt < r.updatedAt; // alteração local ainda não enviada: só perde para uma mais nova
    return force ? l.updatedAt !== r.updatedAt || JSON.stringify(l) !== JSON.stringify(r) : l.updatedAt < r.updatedAt;
  });
  if (!changed.length) return [];
  await db.putMany(changed);
  for (const r of changed) if (force) dirty.delete(r.id);
  handlers?.onRemote(changed);
  return changed;
}

/* ---------------- Ciclo ---------------- */

async function cycle() {
  const c = config;
  if (!c) return;
  setState({ status: "syncing", error: undefined });
  try {
    await pushIds(c, [...dirty]);
    const full = Date.now() - c.lastFull > FULL_EVERY;
    const { recs, maxRev } = await pullAll(c, full ? 0 : c.lastRev);
    await applyRemote(recs);
    if (config === c) {
      config = { ...c, lastRev: Math.max(c.lastRev, maxRev), ...(full ? { lastFull: Date.now() } : {}) };
      await db.setMeta(META_CONFIG, config);
    }
    setState({ status: "idle", lastSync: Date.now() });
  } catch (e) {
    const err = e instanceof SyncError ? e : new SyncError(String(e));
    setState({ status: err.offline ? "offline" : "error", error: err.message });
  }
}

/** Sincroniza agora (se já estiver sincronizando, roda de novo ao terminar). */
export function syncNow(): Promise<void> {
  if (!config) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    do { again = false; await cycle(); } while (again);
  })().finally(() => { running = null; });
  return running;
}

/** Registros alterados neste aparelho: entram na fila e sobem em seguida. */
export function markDirty(ids: string[]) {
  if (!config || !ids.length) return;
  for (const id of ids) dirty.add(id);
  db.setMeta(META_DIRTY, [...dirty]);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow(); }, 1500);
}

let listening = false;
/** Sincroniza ao voltar para o app, ao reconectar e a cada minuto com o app aberto. */
function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  window.addEventListener("online", () => syncNow());
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, INTERVAL);
}

export async function initSync(h: NonNullable<typeof handlers>) {
  handlers = h;
  config = (await db.getMeta<Config>(META_CONFIG)) ?? null;
  dirty = new Set((await db.getMeta<string[]>(META_DIRTY)) ?? []);
  if (!config) { setState({ status: "off" }); return; }
  setState({ status: "idle", familyId: config.familyId });
  listen();
  syncNow();
}

async function start(c: Config) {
  config = c;
  await db.setMeta(META_CONFIG, c);
  setState({ status: "idle", familyId: c.familyId, error: undefined });
  listen();
}

/** Cria a família com os dados deste aparelho (tudo sobe para a nuvem). */
export async function createFamily() {
  const raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const familyId = crypto.randomUUID();
  await rpc("create_family", { p_family: familyId, p_proof: await proofOf(raw) });
  dirty = new Set((await db.getAll()).map((r) => r.id));
  await db.setMeta(META_DIRTY, [...dirty]);
  await start({ familyId, key: raw, lastRev: 0, lastFull: Date.now() });
  await syncNow();
  if (state.status === "error") throw new Error(state.error);
}

/** Lê "#familia=<id>.<chave>" de um link de convite (ou do próprio trecho). */
export function parseInvite(text: string): { familyId: string; key: string } | null {
  const m = text.trim().match(/familia=([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})/i);
  return m ? { familyId: m[1].toLowerCase(), key: m[2] } : null;
}

/**
 * Entra numa família: os dados da família prevalecem; o que só existe neste aparelho é acrescentado à família.
 */
export async function joinFamily(invite: string) {
  const inv = parseInvite(invite);
  if (!inv) throw new Error("Link de convite inválido.");
  const c: Config = { ...inv, lastRev: 0, lastFull: Date.now() };
  setState({ status: "syncing" });
  let pulled: { recs: Rec[]; maxRev: number };
  try {
    pulled = await pullAll(c, 0); // também confere a chave (erro se inválida)
  } catch (e) {
    setState({ status: "off", error: undefined });
    throw e;
  }
  const { recs, maxRev } = pulled;
  const remoteIds = new Set(recs.map((r) => r.id));
  await start({ ...c, lastRev: maxRev });
  await applyRemote(recs, true);
  const localOnly = (await db.getAll()).filter((r) => !remoteIds.has(r.id)).map((r) => r.id);
  for (const id of localOnly) dirty.add(id);
  await db.setMeta(META_DIRTY, [...dirty]);
  await syncNow();
}

export function inviteLink(): string | null {
  if (!config) return null;
  return `${location.origin}${location.pathname}#familia=${config.familyId}.${config.key}`;
}

/** Para de sincronizar neste aparelho (os dados locais ficam). `deleteCloud` apaga a família da nuvem. */
export async function leaveFamily(deleteCloud = false) {
  const c = config;
  if (c && deleteCloud) await rpc("delete_family", { p_family: c.familyId, p_proof: await proofOf(c.key) });
  config = null;
  dirty = new Set();
  await db.setMeta(META_CONFIG, null);
  await db.setMeta(META_DIRTY, []);
  setState({ status: "off", familyId: undefined, lastSync: undefined, error: undefined });
}
