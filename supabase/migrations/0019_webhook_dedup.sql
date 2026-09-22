-- 0019: de-duplicate webhook deliveries by payload hash.
--
-- Some providers (GitHub included) deliver the same event more than once, and
-- clients may retry identical payloads. The unique (provider, event_id) index
-- from 0016 catches events whose id the provider repeats deterministically; a
-- content hash catches the rest — including bodies that carry no event_id at
-- all. Only the first delivery is recorded, so replay handlers can treat the
-- table as idempotent.

alter table public.webhook_events
  add column content_hash text;

-- Same provider + same verified payload = the same delivery.
create unique index webhook_events_provider_content_hash_key
  on public.webhook_events (provider, content_hash)
  where content_hash is not null;