-- Partner venues on the members site: each can have a logo, and the offer
-- is optional so a partner can be listed before its member offer is set.
-- Logos are uploaded on Members -> Partner venues, resized to a small
-- square and kept in the row as a data: URL (a few KB each).

alter table partner_venues add column if not exists logo text;
alter table partner_venues alter column discount_text drop not null;

-- SOMA is our first partner. Listed by name only - its logo and member
-- offer are added on the Partner venues page.
insert into partner_venues (name, active, sort_order)
select 'SOMA', true, 0
where not exists (select 1 from partner_venues where lower(btrim(name)) = 'soma');

notify pgrst, 'reload schema';
