-- Preferenza di attivazione della memoria per ogni account.
-- La disattivazione mantiene il testo salvato, ma il backend non lo usa
-- nelle risposte e non lo aggiorna finché la memoria resta disattivata.
alter table public.user_memory_profiles
  add column if not exists memory_enabled boolean not null default true;

comment on column public.user_memory_profiles.memory_enabled
  is 'Se false, il profilo memoria non viene usato né aggiornato nelle risposte AI.';
