-- ============================================================
-- TEAMPLANER — Demo-Zugang
-- ============================================================
-- Nach 01-datenbank.sql, 02-mailversand.sql und 03-feedback.sql im
-- SQL Editor ausführen (darf jederzeit erneut ausgeführt werden).
--
-- Idee: In der App gibt es einen eingebauten Demo-Bereich (eine fertige
-- Beispiel-Welt, die komplett im Browser läuft – nichts geht an die
-- Datenbank). Erreichbar ist er nur für EIN festgelegtes Konto: Wer sich
-- mit genau dieser E-Mail anmeldet, sieht auf der Seite „Hilfe“ einen
-- Knopf in den Demo-Bereich. Für alle anderen ist er unsichtbar.
--
-- E-Mail festlegen (einmalig, mit der gewünschten Adresse):
--   select set_demo('demo@example.com');
-- Wieder abschalten:
--   select set_demo('');
-- ============================================================

-- Die festgelegte Demo-Adresse liegt – wie die Inhaber*in-Adresse – in mail_settings.
alter table public.mail_settings add column if not exists demo_email text;

-- Darf die angemeldete Person den Demo-Bereich öffnen?
-- (Vergleich der Konto-E-Mail mit der hinterlegten Demo-Adresse, Groß/Klein egal.)
create or replace function public.can_demo() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is not null
     and exists (
       select 1 from mail_settings s
        where nullif(s.demo_email, '') is not null
          and lower(s.demo_email) = lower(public.user_email(auth.uid())));
$$;
revoke execute on function public.can_demo() from public, anon;
grant execute on function public.can_demo() to authenticated;

-- Demo-Adresse setzen oder leeren (nur direkt im SQL-Editor, nicht aus der App).
create or replace function public.set_demo(email text) returns text
language plpgsql security definer set search_path = public as $$
begin
  update mail_settings set demo_email = nullif(lower(trim(email)), '') where id = 1;
  return 'Demo-Zugang für: ' || coalesce(nullif(lower(trim(email)), ''), '(niemanden)');
end; $$;
revoke execute on function public.set_demo(text) from public, anon, authenticated;
