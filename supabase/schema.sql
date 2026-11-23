-- Finanças da família — sincronização (fase 2).
-- Rodar UMA vez no Supabase: painel → SQL Editor → New query → colar tudo → Run.
-- Pode rodar de novo sem problema (só recria as funções).
--
-- O servidor guarda só registros CRIPTOGRAFADOS no aparelho (AES-GCM); nunca vê a chave nem os dados.
-- Acesso: quem tem a chave da família calcula uma "prova" (derivada da chave) e manda junto; o servidor guarda
-- só o SHA-256 dessa prova. Sem a prova certa, nenhuma função lê ou grava nada.
-- As tabelas não têm políticas de RLS: a chave pública (anon) não acessa as tabelas, só estas funções.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.families (
  id uuid primary key,
  proof_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.records (
  family_id uuid not null references public.families(id) on delete cascade,
  id text not null,
  updated_at bigint not null,  -- carimbo do aparelho (ms): vale o maior
  iv text not null,            -- base64
  data text not null,          -- base64 (registro JSON criptografado)
  rev bigint not null,         -- ordem de chegada no servidor (para buscar só o que mudou)
  primary key (family_id, id)
);

create sequence if not exists public.records_rev;
create index if not exists records_family_rev on public.records (family_id, rev);

alter table public.families enable row level security;
alter table public.records enable row level security;
revoke all on public.families, public.records from anon, authenticated;

-- confere a prova da família
create or replace function public._check_family(p_family uuid, p_proof text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (
    select 1 from families where id = p_family and proof_hash = encode(extensions.digest(p_proof, 'sha256'), 'hex')
  ) then
    raise exception 'familia_invalida' using errcode = '28000';
  end if;
end $$;

-- cria a família (o aparelho gera o id e a chave)
create or replace function public.create_family(p_family uuid, p_proof text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(p_proof) < 40 then raise exception 'prova_curta'; end if;
  insert into families (id, proof_hash) values (p_family, encode(extensions.digest(p_proof, 'sha256'), 'hex'));
end $$;

-- envia registros; cada um só substitui o do servidor se for mais recente. Devolve o rev mais alto.
create or replace function public.push_records(p_family uuid, p_proof text, p_rows jsonb) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  perform _check_family(p_family, p_proof);
  if jsonb_array_length(p_rows) > 1000 then raise exception 'lote_grande'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into records (family_id, id, updated_at, iv, data, rev)
    values (p_family, r->>'id', (r->>'updated_at')::bigint, r->>'iv', r->>'data', nextval('records_rev'))
    on conflict (family_id, id) do update
      set updated_at = excluded.updated_at, iv = excluded.iv, data = excluded.data, rev = excluded.rev
      where records.updated_at < excluded.updated_at;
  end loop;
  return coalesce((select max(rev) from records where family_id = p_family), 0);
end $$;

-- busca o que mudou depois de `p_since` (em lotes, pela ordem de chegada)
create or replace function public.pull_records(p_family uuid, p_proof text, p_since bigint, p_limit int default 1000)
returns table (id text, updated_at bigint, iv text, data text, rev bigint)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_family(p_family, p_proof);
  return query
    select r.id, r.updated_at, r.iv, r.data, r.rev from records r
    where r.family_id = p_family and r.rev > p_since
    order by r.rev limit least(greatest(p_limit, 1), 1000);
end $$;

-- apaga a família e todos os registros dela da nuvem (os aparelhos mantêm os dados locais)
create or replace function public.delete_family(p_family uuid, p_proof text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_family(p_family, p_proof);
  delete from families where id = p_family;
end $$;

revoke all on function public._check_family(uuid, text) from public, anon, authenticated;
grant execute on function public.create_family(uuid, text) to anon;
grant execute on function public.push_records(uuid, text, jsonb) to anon;
grant execute on function public.pull_records(uuid, text, bigint, int) to anon;
grant execute on function public.delete_family(uuid, text) to anon;
