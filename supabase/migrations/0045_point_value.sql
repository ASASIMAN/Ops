-- 1 Greyhound point = Rp 1 (confirmed by the owner, 18 Nov 2026: a balance
-- of 871,500 points is Rp 871,500). The members site shows each balance's
-- rupiah equivalent from this. Change it on the Members page.
insert into assumptions (key, value, label)
values ('membership_point_value_idr', 1, 'Membership: rupiah value of 1 Greyhound point')
on conflict (key) do update set value = excluded.value, updated_at = now();
