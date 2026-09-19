-- ============================================================================
-- ADDABAAZ — catalogue seed data
--
-- Generated from the content that used to live inside index.html:
--   4 shows, 35 episodes, 158 promos/specials, 32 posters, 9 team members,
--   6 services, site settings and the hero banners.
--
-- Safe to run once on a fresh database. Every statement is keyed on a natural
-- key (show.key, poster file name, ...) so re-running it is idempotent.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Genres & tags
-- ---------------------------------------------------------------------------
insert into genre (name, slug) values
    ('Drama & History', 'drama-history'),
    ('Comedy', 'comedy'),
    ('Stand-Up Comedy', 'stand-up-comedy'),
    ('Satire', 'satire'),
    ('Documentary', 'documentary')
on conflict (slug) do nothing;

insert into tag (name, slug) values
    ('Bengali', 'bengali'),
    ('Web Series', 'web-series'),
    ('ADDABAAZ Original', 'addabaaz-original'),
    ('History', 'history'),
    ('Shorts', 'shorts')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Shows
-- ---------------------------------------------------------------------------
insert into show (key, title, subtitle, description, image_url, genre, sort_order, published) values
    ('shahid', 'শহীদ (Shahid)', 'Web Series • Drama & History', 'Bengali historical drama series from ADDABAAZ.', 'images/Shahid.webp', 'Drama & History', 0, true),
    ('laughBite', 'LAUGH BITE', 'Stand-Up Comedy', 'Bengali stand-up comedy featuring ADDABAAZ comedians.', 'images/laughBite.webp', 'Comedy', 1, true),
    ('faltu', 'FALTU KOTHA', 'Comedy • Fake Podcast', 'Unfiltered Bengali comedy and satirical fake-podcast episodes.', 'images/FaltuKatha.webp', 'Comedy', 2, true),
    ('centralCalcuttaBoarding', 'সেন্ট্রাল ক্যালকাটা বোর্ডিং', 'Web Series • Comedy', 'The Central Calcutta Boarding comedy web-series catalogue.', '', 'Comedy', 3, false)
on conflict (key) do update set
    title = excluded.title,
    subtitle = excluded.subtitle,
    description = excluded.description,
    image_url = excluded.image_url,
    genre = excluded.genre,
    published = excluded.published;


insert into show_genre (show_id, genre_id)
select s.id, g.id from show s cross join genre g
where (s.key, g.slug) in (
    ('shahid', 'drama-history'),
    ('laughBite', 'comedy'),
    ('faltu', 'comedy'),
    ('centralCalcuttaBoarding', 'comedy')
) on conflict do nothing;

insert into show_tag (show_id, tag_id)
select s.id, t.id from show s cross join tag t
where (s.key, t.slug) in (
    ('shahid', 'bengali'),
    ('shahid', 'web-series'),
    ('shahid', 'addabaaz-original'),
    ('shahid', 'history'),
    ('laughBite', 'bengali'),
    ('laughBite', 'stand-up-comedy'),
    ('laughBite', 'addabaaz-original'),
    ('faltu', 'bengali'),
    ('faltu', 'addabaaz-original'),
    ('faltu', 'satire'),
    ('centralCalcuttaBoarding', 'bengali'),
    ('centralCalcuttaBoarding', 'web-series')
) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Episodes
-- ---------------------------------------------------------------------------

with data (external_id, position, title, youtube_id, duration, views, thumbnail_url,
           availability, episode_no, kind, publish_date) as (values
    ('v35', 35, 'হাসতে হাসতে ফাঁসির মঞ্চে | শহীদ | EP-01| Khudiram Bose | Gourav | Sudip | Deep | Sourav | Mainak', '7jz3BSqSXsM', '15:48', 5191, 'https://i.ytimg.com/vi/7jz3BSqSXsM/hqdefault.jpg', 'available', 1, 'EPISODE', '2026-08-15T06:30:05Z'::timestamptz),
    ('v25', 25, '৬৩ দিনের অগ্নিপরীক্ষা | শহীদ | EP-02 | Jatindra Nath Das | Gourav | Sudip | Deep | Sourav | Mainak', '1GsBEE9jkqw', '15:43', 569, 'https://i.ytimg.com/vi/1GsBEE9jkqw/hqdefault.jpg', 'available', 2, 'EPISODE', '2026-08-22T13:31:24Z'::timestamptz),
    ('v13', 13, 'প্রীতিলতা ওয়াদ্দেদার | শহীদ | EP-03 | Sritama| Gourav | Sudip | Deep | Sourav | Mainak', 'djjo0qJ5gY8', '14:45', 106, 'https://i.ytimg.com/vi/djjo0qJ5gY8/hqdefault.jpg', 'available', 3, 'EPISODE', '2026-08-29T13:30:16Z'::timestamptz),
    ('v9', 9, 'প্রফুল্ল চাকী, মোকামা ঘাটের শেষ লড়াই | শহীদ | EP-04 | Kaustav | Gourav | Sudip | Deep | Sourav', 'Cp8uG-44ICk', '15:50', 80, 'https://i.ytimg.com/vi/Cp8uG-44ICk/hqdefault.jpg', 'available', 4, 'EPISODE', '2026-09-05T13:30:03Z'::timestamptz),
    ('v3', 3, 'সমাবর্তনে ৫টি গুলি! বীণা দাশের সেই দুঃসাহসিক কাণ্ড | শহীদ |EP 05 | ADDABAAZ', 'SBFaqlpsu6c', '14:46', 55, 'https://i.ytimg.com/vi/SBFaqlpsu6c/hqdefault.jpg', 'available', 5, 'EPISODE', '2026-09-12T13:30:16Z'::timestamptz)
)
insert into episode (show_id, external_id, position, title, youtube_id, duration, views,
                     thumbnail_url, availability, episode_no, kind, publish_date)
select s.id, d.external_id, d.position, d.title, d.youtube_id, d.duration, d.views,
       d.thumbnail_url, d.availability, d.episode_no, d.kind, d.publish_date
from data d
cross join show s
where s.key = 'shahid'
on conflict (show_id, external_id) do update set
    title = excluded.title,
    youtube_id = excluded.youtube_id,
    duration = excluded.duration,
    views = excluded.views,
    thumbnail_url = excluded.thumbnail_url,
    availability = excluded.availability,
    episode_no = excluded.episode_no,
    kind = excluded.kind,
    publish_date = excluded.publish_date;

with data (external_id, position, title, youtube_id, duration, views, thumbnail_url,
           availability, episode_no, kind, publish_date) as (values
    ('v187', 187, 'বনগাঁ লোকাল কি ট্রেন ? ওর মধ্যে এতো লোকের যায় কি ভাবে? | Laugh Bite|EP-01| Addabaaz|| Pramit Mitra', '9wwtkOdslzc', '06:41', 526, 'https://i.ytimg.com/vi/9wwtkOdslzc/hqdefault.jpg', 'available', 1, 'EPISODE', '2026-04-15T14:30:06Z'::timestamptz),
    ('v180', 180, 'Laugh Bite|| Addabaaz||Subhadip Ghosh || EP-02 #addabaaz #comedy #bengalacomedy #standupcomedy', 'NBsrq9eUkfk', '07:13', 290, 'https://i.ytimg.com/vi/NBsrq9eUkfk/hqdefault.jpg', 'available', 2, 'EPISODE', '2026-04-18T13:30:34Z'::timestamptz),
    ('v174', 174, 'বিরিয়ানির নেশা ছাড়তে নেশামুক্তি কেন্দ্রে ভর্তি!|Laugh Bite|EP-03|Vaskar Manna| আড্ডাবাজ (Addabaaz)', 'WgqXiJGIz8w', '06:58', 217, 'https://i.ytimg.com/vi/WgqXiJGIz8w/hqdefault.jpg', 'available', 3, 'EPISODE', '2026-04-21T13:30:42Z'::timestamptz),
    ('v168', 168, 'Laugh Bite|| Addabaaz||ANAMITRA || EP-04 #addabaaz #comedy #bengalacomedy #standupcomedy', 'beXqA1EFixo', '06:16', 57, 'https://i.ytimg.com/vi/beXqA1EFixo/hqdefault.jpg', 'available', 4, 'EPISODE', '2026-04-24T13:30:06Z'::timestamptz),
    ('v165', 165, 'Laugh Bite|| Addabaaz|| Pramit Mitra || EP-05 #addabaaz #comedy #bengalacomedy #standupcomedy', '4tsQaM3H9OY', '04:55', 455, 'https://i.ytimg.com/vi/4tsQaM3H9OY/hqdefault.jpg', 'available', 5, 'EPISODE', '2026-04-26T09:30:02Z'::timestamptz),
    ('v158', 158, 'Laugh Bite|| Addabaaz||Subhadip Ghosh || EP-06 #addabaaz #comedy #bengalacomedy #standupcomedy', 'N7siPX4p5WI', '07:40', 99, 'https://i.ytimg.com/vi/N7siPX4p5WI/hqdefault.jpg', 'available', 6, 'EPISODE', '2026-04-29T13:30:22Z'::timestamptz),
    ('v152', 152, 'Laugh Bite|| Addabaaz||VASKAR MANNA || EP-07 #addabaaz #comedy #bengalacomedy #standupcomedy', '1AUTSwYkdsk', '07:15', 172, 'https://i.ytimg.com/vi/1AUTSwYkdsk/hqdefault.jpg', 'available', 7, 'EPISODE', '2026-05-02T13:30:03Z'::timestamptz),
    ('v134', 134, 'Laugh Bite|| Addabaaz ||Subhadip Ghosh || EP-8 #addabaaz #comedy #bengalacomedy #standupcomedy', 'dQvC5URlb0Y', '06:06', 100, 'https://i.ytimg.com/vi/dQvC5URlb0Y/hqdefault.jpg', 'available', 8, 'EPISODE', '2026-05-12T09:30:30Z'::timestamptz),
    ('v117', 117, 'Laugh Bite|| Addabaaz||Vaskar Manna || EP-9 #addabaaz #comedy #bengalacomedy #standupcomedy', 'vhn5kzfYiD4', '07:00', 98, 'https://i.ytimg.com/vi/vhn5kzfYiD4/hqdefault.jpg', 'available', 9, 'EPISODE', '2026-05-21T13:30:39Z'::timestamptz),
    ('v110', 110, 'গোলাপ থাকে Love Bite পর্যন্ত || Laugh Bite || Addabaaz || Subhadip Ghosh || EP-10', '7QXsnr7kQU0', '05:50', 152, 'https://i.ytimg.com/vi/7QXsnr7kQU0/hqdefault.jpg', 'available', 10, 'EPISODE', '2026-05-27T14:05:20Z'::timestamptz),
    ('v97', 97, 'Laugh Bite|| Addabaaz||Vaskar Manna || EP-11 || Addabaaz', 'AY7lc6xvDk4', '07:38', 60, 'https://i.ytimg.com/vi/AY7lc6xvDk4/hqdefault.jpg', 'available', 11, 'EPISODE', '2026-06-09T12:30:29Z'::timestamptz),
    ('v90', 90, 'Corporate চাকরি না জেলখানা? 😵‍💫|| Lught Bite || Subhadip Ghosh || EP-12 | Addabaaz', 'ZQBf4oi3Jzw', '07:45', 52, 'https://i.ytimg.com/vi/ZQBf4oi3Jzw/hqdefault.jpg', 'available', 12, 'EPISODE', '2026-06-16T12:30:29Z'::timestamptz),
    ('v83', 83, 'Laugh Bite|| Addabaaz||Anmitra Sarkar || EP-13 || Standupcomedy', 'KHhJyHjShyI', '04:26', 21, 'https://i.ytimg.com/vi/KHhJyHjShyI/hqdefault.jpg', 'available', 13, 'EPISODE', '2026-06-23T12:30:23Z'::timestamptz),
    ('v76', 76, 'Reels নাকি Cinema? 😳 ১২ সেকেন্ডেই Emotion Damage!| Pramit Mitra | EP-14 | addabaaz | Lught Bite', 'zzyMGH6BAAE', '06:03', 134359, 'https://i.ytimg.com/vi/zzyMGH6BAAE/hqdefault.jpg', 'available', 14, 'EPISODE', '2026-06-30T12:30:02Z'::timestamptz),
    ('v62', 62, 'Laugh Bite|| Addabaaz||Anmitra Sarkar || EP-16 || Stand up comedy | আড্ডাবাজ (ADDABAAZ)', 'MKm_nMLC60Y', '04:40', 43, 'https://i.ytimg.com/vi/MKm_nMLC60Y/hqdefault.jpg', 'available', 16, 'EPISODE', '2026-07-14T12:30:11Z'::timestamptz),
    ('v56', 56, 'Laugh Bite|| Addabaaz ||Vaskar Manna || EP-17 || Stand up comedy | আড্ডাবাজ (ADDABAAZ)', 'qhdj8tpfY0k', '04:51', 35, 'https://i.ytimg.com/vi/qhdj8tpfY0k/hqdefault.jpg', 'available', 17, 'EPISODE', '2026-07-21T12:30:27Z'::timestamptz)
)
insert into episode (show_id, external_id, position, title, youtube_id, duration, views,
                     thumbnail_url, availability, episode_no, kind, publish_date)
select s.id, d.external_id, d.position, d.title, d.youtube_id, d.duration, d.views,
       d.thumbnail_url, d.availability, d.episode_no, d.kind, d.publish_date
from data d
cross join show s
where s.key = 'laughBite'
on conflict (show_id, external_id) do update set
    title = excluded.title,
    youtube_id = excluded.youtube_id,
    duration = excluded.duration,
    views = excluded.views,
    thumbnail_url = excluded.thumbnail_url,
    availability = excluded.availability,
    episode_no = excluded.episode_no,
    kind = excluded.kind,
    publish_date = excluded.publish_date;

with data (external_id, position, title, youtube_id, duration, views, thumbnail_url,
           availability, episode_no, kind, publish_date) as (values
    ('v146', 146, 'এই তর্ক দেখার পর আপনার মত বদলে যাবে! নারী বনাম পুরুষ | পর্ব ১ ।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'U4C_QnhSm6U', '11:48', 21060, 'https://i.ytimg.com/vi/U4C_QnhSm6U/hqdefault.jpg', 'available', 1, 'EPISODE', '2026-05-06T11:30:20Z'::timestamptz),
    ('v139', 139, '“সত্যি না মিথ্যে?” 🤯 IT Cell কীভাবে ইতিহাস বদলায়! | পর্ব ২।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'YM9jW3ZNqkM', '04:46', 2144, 'https://i.ytimg.com/vi/YM9jW3ZNqkM/hqdefault.jpg', 'available', 2, 'EPISODE', '2026-05-10T04:35:00Z'::timestamptz),
    ('v126', 126, 'Hit না, শুধু Flop! ফ্লপ সিনেমা বানিয়েই Famous! 😂 | পর্ব ৩ ।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'W3FPTBYPMy4', '06:34', 465, 'https://i.ytimg.com/vi/W3FPTBYPMy4/hqdefault.jpg', 'available', 3, 'EPISODE', '2026-05-16T11:30:32Z'::timestamptz),
    ('v120', 120, 'CCTVকাকিমা in action, Balcony থেকে গোটা পাড়া Control করে| পর্ব ৪ ।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'YYxRWpvK93Y', '16:49', 1651, 'https://i.ytimg.com/vi/YYxRWpvK93Y/hqdefault.jpg', 'available', 4, 'EPISODE', '2026-05-19T11:30:32Z'::timestamptz),
    ('v115', 115, '“সাকসেস না স্ক্যাম? মোটিভেশনাল গুরুর ভয়ংকর সত্য | পর্ব ৫।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'A9ZB0IhJ228', '07:15', 356, 'https://i.ytimg.com/vi/A9ZB0IhJ228/hqdefault.jpg', 'available', 5, 'EPISODE', '2026-05-23T12:30:21Z'::timestamptz),
    ('v111', 111, 'আমি Toxic না!’ 😭 কিন্তু Boyfriend-এর সব Password চাই!| পর্ব ৬ ।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'LUzh-6hn8SE', '12:55', 1375, 'https://i.ytimg.com/vi/LUzh-6hn8SE/hqdefault.jpg', 'available', 6, 'EPISODE', '2026-05-26T12:30:15Z'::timestamptz),
    ('v107', 107, 'ফেক প্রোফাইলের আড়ালে কোটি খিস্তি! Netizen-এর আসল মুখ ফাঁস | পর্ব ৭ ।Fake Podcast | আড্ডাবাজ', 'DgsksdQwsnU', '09:20', 251, 'https://i.ytimg.com/vi/DgsksdQwsnU/hqdefault.jpg', 'available', 7, 'EPISODE', '2026-05-30T12:30:15Z'::timestamptz),
    ('v104', 104, 'যাদবপুরের ললিপপ বিপ্লবী | আন্দোলন-লেনিনের প্রেম!| পর্ব ৮ ।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'XfW-t3IlD5o', '13:02', 4232, 'https://i.ytimg.com/vi/XfW-t3IlD5o/hqdefault.jpg', 'available', 8, 'EPISODE', '2026-06-02T12:30:35Z'::timestamptz),
    ('v100', 100, 'Gen Z কি করছে আজকাল? এই ইন্টারভিউ দেখলে অবাক হবেন | পর্ব ৯ | Fake Podcast | আড্ডাবাজ (Addabaaz)', 'Kx8UvKhDkgY', '09:02', 2299, 'https://i.ytimg.com/vi/Kx8UvKhDkgY/hqdefault.jpg', 'available', 9, 'EPISODE', '2026-06-06T12:30:12Z'::timestamptz),
    ('v93', 93, 'AI Girlfriend বানিয়ে প্রেম! 😱 মাসে ₹999 দিয়ে | পর্ব ১০।Fake Podcast | আড্ডাবাজ (Addabaaz)', '001IXO-JZog', '05:34', 213, 'https://i.ytimg.com/vi/001IXO-JZog/hqdefault.jpg', 'available', 10, 'EPISODE', '2026-06-13T12:30:35Z'::timestamptz),
    ('v86', 86, 'Relationship না Customer Support Job? 🤯| পর্ব ১১ ।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'lTCtA864fN8', '10:28', 156, 'https://i.ytimg.com/vi/lTCtA864fN8/hqdefault.jpg', 'available', 11, 'EPISODE', '2026-06-20T12:30:05Z'::timestamptz),
    ('v79', 79, 'Trainer না Businessman? Gym Guru-র Supplement Scam ফাঁস! | পর্ব ১২ ।Fake Podcast | আড্ডাবাজ', 'v9TPpETeZEM', '08:58', 1274, 'https://i.ytimg.com/vi/v9TPpETeZEM/hqdefault.jpg', 'available', 12, 'EPISODE', '2026-06-27T12:30:32Z'::timestamptz),
    ('v72', 72, 'iPhone-এ পুঁজিবাদবিরোধী বিপ্লব | আন্দোলন-লেনিনের প্রেম!|পর্ব -১৩ ।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'n2i_46N6Mh8', '11:05', 264, 'https://i.ytimg.com/vi/n2i_46N6Mh8/hqdefault.jpg', 'available', 13, 'EPISODE', '2026-07-04T12:30:37Z'::timestamptz),
    ('v65', 65, 'ফুটপাতে হাঁটা নিষেধ! কমরেডের আজব বিপ্লব |পর্ব -১৪।ফালতু কথা | Fake Podcast | আড্ডাবাজ (Addabaaz)', 'HRohhXBp6Qs', '08:04', 678, 'https://i.ytimg.com/vi/HRohhXBp6Qs/hqdefault.jpg', 'available', 14, 'EPISODE', '2026-07-11T12:30:35Z'::timestamptz)
)
insert into episode (show_id, external_id, position, title, youtube_id, duration, views,
                     thumbnail_url, availability, episode_no, kind, publish_date)
select s.id, d.external_id, d.position, d.title, d.youtube_id, d.duration, d.views,
       d.thumbnail_url, d.availability, d.episode_no, d.kind, d.publish_date
from data d
cross join show s
where s.key = 'faltu'
on conflict (show_id, external_id) do update set
    title = excluded.title,
    youtube_id = excluded.youtube_id,
    duration = excluded.duration,
    views = excluded.views,
    thumbnail_url = excluded.thumbnail_url,
    availability = excluded.availability,
    episode_no = excluded.episode_no,
    kind = excluded.kind,
    publish_date = excluded.publish_date;


-- ---------------------------------------------------------------------------
-- Promos, reels & specials
-- ---------------------------------------------------------------------------
with data (external_id, position, title, youtube_id, duration, views, thumbnail_url,
           availability, kind, publish_date) as (values
    ('v1', 1, 'শহীদ | Part - 18| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'yxpctHMPcCk', '00:30', 18, 'https://i.ytimg.com/vi/yxpctHMPcCk/hqdefault.jpg', 'available', 'PROMO', '2026-09-14T13:30:04Z'::timestamptz),
    ('v2', 2, 'শহীদ | Part - 17| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'C26VrT3kTtM', '00:58', 14, 'https://i.ytimg.com/vi/C26VrT3kTtM/hqdefault.jpg', 'available', 'PROMO', '2026-09-14T10:56:39Z'::timestamptz),
    ('v4', 4, 'প্রফুল্ল চাকী মৃত্যুর মুখেও হার মানেননি ! বাংলার অমর বিপ্লবীর গল্প। শহীদ | Reel-05| EP-04| Addabaaz', 'PTEPziaTDzQ', '01:45', 49, 'https://i.ytimg.com/vi/PTEPziaTDzQ/hqdefault.jpg', 'available', 'PROMO', '2026-09-11T13:30:07Z'::timestamptz),
    ('v5', 5, 'প্রফুল্ল শেষ মুহূর্তের সেই সিদ্ধান্ত! ইতিহাসের শিহরণ জাগানো কাহিনি । শহীদ | Reel-04| EP-04| Addabaaz', '5uX2-b6DeA8', '00:53', 246, 'https://i.ytimg.com/vi/5uX2-b6DeA8/hqdefault.jpg', 'available', 'PROMO', '2026-09-10T13:30:19Z'::timestamptz),
    ('v6', 6, 'প্রফুল্ল চাকীর জীবনের সেই গোপন অধ্যায় | কী লুকিয়ে ছিল সেই কাগজে?। শহীদ | Reel-03| EP-04| Addabaaz', '5o0eQomkmgs', '01:14', 52, 'https://i.ytimg.com/vi/5o0eQomkmgs/hqdefault.jpg', 'available', 'PROMO', '2026-09-07T13:30:14Z'::timestamptz),
    ('v7', 7, 'প্রফুল্ল চাকী - দেশের জন্য শেষ আত্মত্যাগ। শহীদ | Reel-02| EP-04| Addabazz', 'IYREigy7dqA', '01:27', 58, 'https://i.ytimg.com/vi/IYREigy7dqA/hqdefault.jpg', 'available', 'PROMO', '2026-09-06T13:30:23Z'::timestamptz),
    ('v8', 8, 'প্রফুল্ল চাকীর শেষ লড়াই ! ইতিহাসের এক অজানা অধ্যায়। শহীদ | Reel-01| EP-04 | Addabaaz', '4YW1wjhpIxM', '01:37', 48, 'https://i.ytimg.com/vi/4YW1wjhpIxM/hqdefault.jpg', 'available', 'PROMO', '2026-09-06T13:30:12Z'::timestamptz),
    ('v10', 10, 'প্রফুল্ল চাকী, শেষ ট্রেনযাত্রা!।শহীদ | Trailer | EP-03| Addabazz', 'eD2ijKbTpqk', '00:57', 61, 'https://i.ytimg.com/vi/eD2ijKbTpqk/hqdefault.jpg', 'available', 'PROMO', '2026-09-05T07:13:37Z'::timestamptz),
    ('v11', 11, 'শহীদ | Part - 16| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'C3_eHtqrYo8', '00:29', 253, 'https://i.ytimg.com/vi/C3_eHtqrYo8/hqdefault.jpg', 'available', 'PROMO', '2026-09-04T13:30:06Z'::timestamptz),
    ('v12', 12, 'শহীদ |REEL-01| EP-02 | Addabazz | Kaustav | Ritam Jana | Gourav | Sudip | Deep | Sourav |', 'h4-gUXaGpz4', '01:26', 35, 'https://i.ytimg.com/vi/h4-gUXaGpz4/hqdefault.jpg', 'available', 'PROMO', '2026-09-03T13:30:13Z'::timestamptz),
    ('v14', 14, 'প্রীতিলতা ওয়াদ্দেদার—শুধু একজন শহিদ নন, তিনি একটা প্রশ্ন।শহীদ | Trailer | EP-03| Addabazz', 'jreSzqkfShg', '01:20', 62, 'https://i.ytimg.com/vi/jreSzqkfShg/hqdefault.jpg', 'available', 'PROMO', '2026-08-29T08:00:37Z'::timestamptz),
    ('v15', 15, 'শহীদ | Part - 15| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'Eep1QMCVIm4', '00:46', 46, 'https://i.ytimg.com/vi/Eep1QMCVIm4/hqdefault.jpg', 'available', 'PROMO', '2026-08-28T13:30:16Z'::timestamptz),
    ('v16', 16, 'শহীদ | Part - 14| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', '1kLuk4nlkgU', '00:40', 66, 'https://i.ytimg.com/vi/1kLuk4nlkgU/hqdefault.jpg', 'available', 'PROMO', '2026-08-28T07:00:30Z'::timestamptz),
    ('v17', 17, 'শহীদ | Part - 13| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'W2vfbLu3Wlg', '00:34', 330, 'https://i.ytimg.com/vi/W2vfbLu3Wlg/hqdefault.jpg', 'available', 'PROMO', '2026-08-27T13:30:31Z'::timestamptz),
    ('v18', 18, 'শহীদ | Part - 12| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'g5LWdij7w6s', '00:49', 78, 'https://i.ytimg.com/vi/g5LWdij7w6s/hqdefault.jpg', 'available', 'PROMO', '2026-08-26T13:30:31Z'::timestamptz),
    ('v19', 19, 'শহীদ | Part - 11| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'XvpOuz9Mf08', '00:59', 125, 'https://i.ytimg.com/vi/XvpOuz9Mf08/hqdefault.jpg', 'available', 'PROMO', '2026-08-26T07:00:32Z'::timestamptz),
    ('v20', 20, 'শহীদ | Part - 10| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', '3NVo7WtiTXg', '00:51', 273, 'https://i.ytimg.com/vi/3NVo7WtiTXg/hqdefault.jpg', 'available', 'PROMO', '2026-08-24T13:30:13Z'::timestamptz),
    ('v21', 21, 'শহীদ | Part - 9| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'GS9fcoJVvE4', '00:50', 306, 'https://i.ytimg.com/vi/GS9fcoJVvE4/hqdefault.jpg', 'available', 'PROMO', '2026-08-24T09:30:16Z'::timestamptz),
    ('v22', 22, 'শহীদ | Part - 8| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'C7k5FSKn4Gw', '00:45', 499, 'https://i.ytimg.com/vi/C7k5FSKn4Gw/hqdefault.jpg', 'available', 'PROMO', '2026-08-23T13:30:01Z'::timestamptz),
    ('v23', 23, 'শহীদ | Part - 7| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', '1YH-ij2eBkI', '00:42', 88, 'https://i.ytimg.com/vi/1YH-ij2eBkI/hqdefault.jpg', 'available', 'PROMO', '2026-08-23T07:00:29Z'::timestamptz),
    ('v24', 24, 'শহীদ |Trailer | EP-02 | Addabazz | Kaustav | Ritam Jana | Gourav | Sudip | Deep | Sourav | Mainak', '-SGbw97-1wM', '01:35', 15395, 'https://i.ytimg.com/vi/-SGbw97-1wM/hqdefault.jpg', 'available', 'PROMO', '2026-08-22T16:30:27Z'::timestamptz),
    ('v26', 26, 'শহীদ | Part - 6| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 's5x5L-syLvo', '00:52', 161, 'https://i.ytimg.com/vi/s5x5L-syLvo/hqdefault.jpg', 'available', 'PROMO', '2026-08-21T13:30:20Z'::timestamptz),
    ('v27', 27, 'শহীদ | Part - 5| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'qMjeC5f1QEo', '00:44', 140, 'https://i.ytimg.com/vi/qMjeC5f1QEo/hqdefault.jpg', 'available', 'PROMO', '2026-08-21T09:30:15Z'::timestamptz),
    ('v28', 28, 'শহীদ | Part - 4| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'Ki7S3mYZBV0', '00:39', 169, 'https://i.ytimg.com/vi/Ki7S3mYZBV0/hqdefault.jpg', 'available', 'PROMO', '2026-08-20T13:30:03Z'::timestamptz),
    ('v29', 29, 'শহীদ | Part - 3| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'wAr76XbeL6E', '00:46', 157, 'https://i.ytimg.com/vi/wAr76XbeL6E/hqdefault.jpg', 'available', 'PROMO', '2026-08-20T04:30:19Z'::timestamptz),
    ('v30', 30, 'শহীদ | Part - 2| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', '5M9pAD0Iako', '00:46', 71, 'https://i.ytimg.com/vi/5M9pAD0Iako/hqdefault.jpg', 'available', 'PROMO', '2026-08-19T13:30:33Z'::timestamptz),
    ('v31', 31, 'শহীদ | Part - 1| Khudiram Bose | Addabazz | Kaustav | Gourav | Sudip | Deep | Sourav | Mainak', 'e6WNHAEYdaI', '00:49', 181, 'https://i.ytimg.com/vi/e6WNHAEYdaI/hqdefault.jpg', 'available', 'PROMO', '2026-08-19T04:30:17Z'::timestamptz),
    ('v32', 32, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'o31DjxoaHM8', '00:33', 760, 'https://i.ytimg.com/vi/o31DjxoaHM8/hqdefault.jpg', 'available', 'PROMO', '2026-08-17T04:30:04Z'::timestamptz),
    ('v33', 33, 'Sahid (শহীদ) | Promo | Addabazz | Gourav | Sudip | Deep | Sourav | Mainak', '5WcpoVrf-nk', '01:47', 37, 'https://i.ytimg.com/vi/5WcpoVrf-nk/hqdefault.jpg', 'available', 'PROMO', '2026-08-16T13:22:27Z'::timestamptz),
    ('v34', 34, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', '0eHrzHXG2Ys', '00:34', 368, 'https://i.ytimg.com/vi/0eHrzHXG2Ys/hqdefault.jpg', 'available', 'PROMO', '2026-08-16T04:30:17Z'::timestamptz),
    ('v36', 36, 'Sahid (শহীদ) | Promo | Addabazz | Gourav | Sudip | Deep | Sourav | Mainak', 'Z_YguFelLy4', '01:08', 21290, 'https://i.ytimg.com/vi/Z_YguFelLy4/hqdefault.jpg', 'available', 'PROMO', '2026-08-14T15:45:54Z'::timestamptz),
    ('v37', 37, 'ক্ষুদিরাম বসু !! দেশের স্বাধীনতার জন্য কীভাবে নিজের জীবন উৎসর্গ করেছিলেন তিনি?', 'sveSHsfEYx4', '01:43', 231, 'https://i.ytimg.com/vi/sveSHsfEYx4/hqdefault.jpg', 'available', 'PROMO', '2026-08-14T07:00:23Z'::timestamptz),
    ('v38', 38, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', '6uF9z6XiPuw', '00:21', 177, 'https://i.ytimg.com/vi/6uF9z6XiPuw/hqdefault.jpg', 'available', 'PROMO', '2026-08-14T04:30:15Z'::timestamptz),
    ('v39', 39, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'xVPdbkDjgfc', '00:31', 55, 'https://i.ytimg.com/vi/xVPdbkDjgfc/hqdefault.jpg', 'available', 'PROMO', '2026-08-13T04:30:23Z'::timestamptz),
    ('v40', 40, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', '4pdafr46SgY', '00:23', 72, 'https://i.ytimg.com/vi/4pdafr46SgY/hqdefault.jpg', 'available', 'PROMO', '2026-08-12T04:30:03Z'::timestamptz),
    ('v41', 41, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'vbiQfTlPKBk', '00:30', 1012, 'https://i.ytimg.com/vi/vbiQfTlPKBk/hqdefault.jpg', 'available', 'PROMO', '2026-08-11T04:30:20Z'::timestamptz),
    ('v42', 42, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'NX-2nyrONgU', '00:33', 139, 'https://i.ytimg.com/vi/NX-2nyrONgU/hqdefault.jpg', 'available', 'PROMO', '2026-08-10T04:30:12Z'::timestamptz),
    ('v43', 43, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'Zm2RLO-doj4', '00:27', 219, 'https://i.ytimg.com/vi/Zm2RLO-doj4/hqdefault.jpg', 'available', 'PROMO', '2026-08-05T04:30:36Z'::timestamptz),
    ('v44', 44, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'peXmjIvR5W8', '00:24', 82, 'https://i.ytimg.com/vi/peXmjIvR5W8/hqdefault.jpg', 'available', 'PROMO', '2026-08-04T04:30:18Z'::timestamptz),
    ('v45', 45, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'S_Td3a6neyk', '00:31', 56, 'https://i.ytimg.com/vi/S_Td3a6neyk/hqdefault.jpg', 'available', 'PROMO', '2026-08-03T04:30:26Z'::timestamptz),
    ('v46', 46, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'SZlJgaRQm0Q', '00:43', 48, 'https://i.ytimg.com/vi/SZlJgaRQm0Q/hqdefault.jpg', 'available', 'PROMO', '2026-08-02T04:30:07Z'::timestamptz),
    ('v47', 47, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'gf7xdl3ibt8', '00:42', 589, 'https://i.ytimg.com/vi/gf7xdl3ibt8/hqdefault.jpg', 'available', 'PROMO', '2026-08-01T04:30:14Z'::timestamptz),
    ('v48', 48, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'X9lyomnnlL8', '00:30', 1184, 'https://i.ytimg.com/vi/X9lyomnnlL8/hqdefault.jpg', 'available', 'PROMO', '2026-07-31T04:30:17Z'::timestamptz),
    ('v49', 49, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'IQzlhRUSbTM', '00:51', 79, 'https://i.ytimg.com/vi/IQzlhRUSbTM/hqdefault.jpg', 'available', 'PROMO', '2026-07-30T04:30:26Z'::timestamptz),
    ('v50', 50, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', '0ngZptKE0ls', '00:28', 161, 'https://i.ytimg.com/vi/0ngZptKE0ls/hqdefault.jpg', 'available', 'PROMO', '2026-07-29T04:30:00Z'::timestamptz),
    ('v51', 51, '“বিয়ে না Silicone Doll? 🤯 আধুনিক সম্পর্কের ভয়ংকর সত্য!” || EP-18 || আড্ডাবাজ (ADDABAAZ)', 'lJ5SOYQc-1g', '04:29', 2956, 'https://i.ytimg.com/vi/lJ5SOYQc-1g/hqdefault.jpg', 'available', 'SPECIAL', '2026-07-28T12:30:09Z'::timestamptz),
    ('v52', 52, 'XX ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'RUKUEZ6NbxM', '00:58', 55, 'https://i.ytimg.com/vi/RUKUEZ6NbxM/hqdefault.jpg', 'available', 'PROMO', '2026-07-27T04:30:18Z'::timestamptz),
    ('v53', 53, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'zIef-ntK6wc', '00:45', 47, 'https://i.ytimg.com/vi/zIef-ntK6wc/hqdefault.jpg', 'available', 'PROMO', '2026-07-25T15:34:42Z'::timestamptz),
    ('v54', 54, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'NxJhyNA2GOQ', '00:17', 28, 'https://i.ytimg.com/vi/NxJhyNA2GOQ/hqdefault.jpg', 'available', 'PROMO', '2026-07-23T12:30:09Z'::timestamptz),
    ('v55', 55, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'QI-y8SLY4MI', '00:15', 27, 'https://i.ytimg.com/vi/QI-y8SLY4MI/hqdefault.jpg', 'available', 'PROMO', '2026-07-22T12:30:39Z'::timestamptz),
    ('v57', 57, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'RVa3w4jFCxw', '00:17', 31, 'https://i.ytimg.com/vi/RVa3w4jFCxw/hqdefault.jpg', 'available', 'PROMO', '2026-07-20T12:30:31Z'::timestamptz),
    ('v58', 58, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'jlJyDXTBkdY', '00:17', 25, 'https://i.ytimg.com/vi/jlJyDXTBkdY/hqdefault.jpg', 'available', 'PROMO', '2026-07-19T12:30:19Z'::timestamptz),
    ('v59', 59, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'Q-gNUoAU2UA', '00:14', 32, 'https://i.ytimg.com/vi/Q-gNUoAU2UA/hqdefault.jpg', 'available', 'PROMO', '2026-07-17T12:30:35Z'::timestamptz),
    ('v60', 60, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', '_vVX_zTACxM', '00:13', 22, 'https://i.ytimg.com/vi/_vVX_zTACxM/hqdefault.jpg', 'available', 'PROMO', '2026-07-16T12:30:39Z'::timestamptz),
    ('v61', 61, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'pOuqQ-MjQ6M', '00:29', 19, 'https://i.ytimg.com/vi/pOuqQ-MjQ6M/hqdefault.jpg', 'available', 'PROMO', '2026-07-15T12:30:37Z'::timestamptz),
    ('v63', 63, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'tYnF71HdaYk', '00:23', 42, 'https://i.ytimg.com/vi/tYnF71HdaYk/hqdefault.jpg', 'available', 'PROMO', '2026-07-13T12:30:08Z'::timestamptz),
    ('v64', 64, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'o1aMOGfeieA', '00:18', 42, 'https://i.ytimg.com/vi/o1aMOGfeieA/hqdefault.jpg', 'available', 'PROMO', '2026-07-12T12:30:26Z'::timestamptz),
    ('v66', 66, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'typzGcuWM5g', '00:28', 29, 'https://i.ytimg.com/vi/typzGcuWM5g/hqdefault.jpg', 'available', 'PROMO', '2026-07-10T12:30:07Z'::timestamptz),
    ('v67', 67, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'exGz4Qk4Exs', '00:18', 30, 'https://i.ytimg.com/vi/exGz4Qk4Exs/hqdefault.jpg', 'available', 'PROMO', '2026-07-09T12:30:25Z'::timestamptz),
    ('v68', 68, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', '1nKFHlpqrXo', '00:16', 56, 'https://i.ytimg.com/vi/1nKFHlpqrXo/hqdefault.jpg', 'available', 'PROMO', '2026-07-08T12:30:25Z'::timestamptz),
    ('v69', 69, 'New Year Night & Madness ||Subhadip Ghosh || EP-15 || Stand up comedy | আড্ডাবাজ (ADDABAAZ)', 'BlqUjY2QYts', '06:47', 32, 'https://i.ytimg.com/vi/BlqUjY2QYts/hqdefault.jpg', 'available', 'SPECIAL', '2026-07-07T12:30:29Z'::timestamptz),
    ('v70', 70, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'CPbIErpQ-ko', '00:16', 32, 'https://i.ytimg.com/vi/CPbIErpQ-ko/hqdefault.jpg', 'available', 'PROMO', '2026-07-06T12:30:15Z'::timestamptz),
    ('v71', 71, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', '68O016VMnao', '00:17', 36, 'https://i.ytimg.com/vi/68O016VMnao/hqdefault.jpg', 'available', 'PROMO', '2026-07-05T12:30:38Z'::timestamptz),
    ('v73', 73, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'Lm2ImosnUMs', '00:27', 32, 'https://i.ytimg.com/vi/Lm2ImosnUMs/hqdefault.jpg', 'available', 'PROMO', '2026-07-03T12:30:32Z'::timestamptz),
    ('v74', 74, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'T4S_IaN9r4k', '00:34', 31, 'https://i.ytimg.com/vi/T4S_IaN9r4k/hqdefault.jpg', 'available', 'PROMO', '2026-07-02T12:30:20Z'::timestamptz),
    ('v75', 75, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'Yio34_DCx4o', '00:31', 34, 'https://i.ytimg.com/vi/Yio34_DCx4o/hqdefault.jpg', 'available', 'PROMO', '2026-07-01T12:30:35Z'::timestamptz),
    ('v77', 77, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'ajMuAPEA2fA', '00:25', 995, 'https://i.ytimg.com/vi/ajMuAPEA2fA/hqdefault.jpg', 'available', 'PROMO', '2026-06-29T12:30:32Z'::timestamptz),
    ('v78', 78, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'zd-rXXqGkss', '00:31', 273, 'https://i.ytimg.com/vi/zd-rXXqGkss/hqdefault.jpg', 'available', 'PROMO', '2026-06-28T12:30:14Z'::timestamptz),
    ('v80', 80, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', '_YBv9vHhSCM', '00:27', 470, 'https://i.ytimg.com/vi/_YBv9vHhSCM/hqdefault.jpg', 'available', 'PROMO', '2026-06-26T12:30:14Z'::timestamptz),
    ('v81', 81, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'gmgRCtiaUTM', '00:25', 165, 'https://i.ytimg.com/vi/gmgRCtiaUTM/hqdefault.jpg', 'available', 'PROMO', '2026-06-25T12:30:12Z'::timestamptz),
    ('v82', 82, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'DIK4coqQBzU', '00:21', 243, 'https://i.ytimg.com/vi/DIK4coqQBzU/hqdefault.jpg', 'available', 'PROMO', '2026-06-24T12:30:36Z'::timestamptz),
    ('v84', 84, 'ফালতু কথা || REELS || FALTU KOTHA ||FAKE PODCAST || ADDABAAZ #comedy #entertainment', 'f9s1Wz7thHE', '00:31', 250, 'https://i.ytimg.com/vi/f9s1Wz7thHE/hqdefault.jpg', 'available', 'PROMO', '2026-06-22T12:30:25Z'::timestamptz),
    ('v85', 85, 'আড্ডাবাজ || Addabaaz reels || Addabaaz content || Addabaaz Promo || Reel-07', 'dz2Ew3Yd2eY', '00:28', 899, 'https://i.ytimg.com/vi/dz2Ew3Yd2eY/hqdefault.jpg', 'available', 'PROMO', '2026-06-21T12:30:05Z'::timestamptz),
    ('v87', 87, 'আড্ডাবাজ || Addabaaz reels || Addabaaz content || Addabaaz Promo || Reel-06', 'rhqpUVg_Wn4', '00:48', 902, 'https://i.ytimg.com/vi/rhqpUVg_Wn4/hqdefault.jpg', 'available', 'PROMO', '2026-06-19T12:30:08Z'::timestamptz),
    ('v88', 88, 'আড্ডাবাজ || Addabaaz reels || Addabaaz content || Addabaaz Promo || Reel-05', 'Q3k1I55fof0', '00:39', 169, 'https://i.ytimg.com/vi/Q3k1I55fof0/hqdefault.jpg', 'available', 'PROMO', '2026-06-18T12:30:16Z'::timestamptz),
    ('v89', 89, 'আড্ডাবাজ || Addabaaz reels || Addabaaz content || Addabaaz Promo || Reel-04', 'xd6hQLLJ3LE', '00:27', 84, 'https://i.ytimg.com/vi/xd6hQLLJ3LE/hqdefault.jpg', 'available', 'PROMO', '2026-06-17T12:30:30Z'::timestamptz),
    ('v91', 91, 'আড্ডাবাজ || Addabaaz reels || Addabaaz content || Addabaaz Promo || Reel-03', 'JT4WZVQk6bM', '00:38', 98, 'https://i.ytimg.com/vi/JT4WZVQk6bM/hqdefault.jpg', 'available', 'PROMO', '2026-06-15T12:30:14Z'::timestamptz),
    ('v92', 92, 'আড্ডাবাজ || Addabaaz reels || Addabaaz content || Addabaaz Promo || Reel-02', '3Y0JKfIaRhs', '00:31', 148, 'https://i.ytimg.com/vi/3Y0JKfIaRhs/hqdefault.jpg', 'available', 'PROMO', '2026-06-14T12:30:27Z'::timestamptz),
    ('v94', 94, 'আড্ডাবাজ || Addabaaz reels || Addabaaz content || Addabaaz Promo || Reel-01', 'qwiGU-YIkSA', '00:46', 254, 'https://i.ytimg.com/vi/qwiGU-YIkSA/hqdefault.jpg', 'available', 'PROMO', '2026-06-12T12:30:39Z'::timestamptz),
    ('v95', 95, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-09|| CKB || Promo || Addabaaz', '5uR2DC2m32Y', '00:22', 1195, 'https://i.ytimg.com/vi/5uR2DC2m32Y/hqdefault.jpg', 'available', 'PROMO', '2026-06-11T12:30:07Z'::timestamptz),
    ('v96', 96, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-08|| CKB || Promo || Addabaaz', '89wX-i-m71g', '00:25', 1007, 'https://i.ytimg.com/vi/89wX-i-m71g/hqdefault.jpg', 'available', 'PROMO', '2026-06-10T12:30:39Z'::timestamptz),
    ('v98', 98, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-07|| CKB || Promo || Addabaaz', 'tFz4hdrW5bI', '00:34', 197, 'https://i.ytimg.com/vi/tFz4hdrW5bI/hqdefault.jpg', 'available', 'PROMO', '2026-06-08T12:30:40Z'::timestamptz),
    ('v99', 99, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-06|| CKB || Promo || Addabaaz', 'IsJwBRe5KFI', '00:25', 370, 'https://i.ytimg.com/vi/IsJwBRe5KFI/hqdefault.jpg', 'available', 'PROMO', '2026-06-07T12:30:01Z'::timestamptz),
    ('v101', 101, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-05|| CKB || Promo || Addabaaz', 'ffJEFljYyh8', '00:30', 342, 'https://i.ytimg.com/vi/ffJEFljYyh8/hqdefault.jpg', 'available', 'PROMO', '2026-06-05T12:30:17Z'::timestamptz),
    ('v102', 102, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-04|| CKB || Promo || Addabaaz', '06XG7n0un1s', '00:30', 104, 'https://i.ytimg.com/vi/06XG7n0un1s/hqdefault.jpg', 'available', 'PROMO', '2026-06-04T12:30:31Z'::timestamptz),
    ('v103', 103, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-03|| CKB || Promo || Addabaaz', 'KdVgociXnnw', '00:26', 286, 'https://i.ytimg.com/vi/KdVgociXnnw/hqdefault.jpg', 'available', 'PROMO', '2026-06-03T12:30:26Z'::timestamptz),
    ('v105', 105, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-02|| CKB || Promo || Addabaaz', 'BtnQg_Sn1YY', '00:30', 2096, 'https://i.ytimg.com/vi/BtnQg_Sn1YY/hqdefault.jpg', 'available', 'PROMO', '2026-06-01T12:30:30Z'::timestamptz),
    ('v106', 106, 'সেন্ট্রাল ক্যালকাটা বোর্ডিং || New Web Series || comedy series|| Reel-01|| CKB || Promo || Addabaaz', 'ekjbbpeDSko', '00:34', 1062, 'https://i.ytimg.com/vi/ekjbbpeDSko/hqdefault.jpg', 'available', 'PROMO', '2026-05-31T12:30:03Z'::timestamptz),
    ('v108', 108, 'Blocked… কিন্তু Mind থেকে Delete হয়নি! 💔 || REELS || FALTU KOTHA || ADDABAAZ', 'iKmdUTc8x9g', '00:17', 247, 'https://i.ytimg.com/vi/iKmdUTc8x9g/hqdefault.jpg', 'available', 'PROMO', '2026-05-29T12:30:37Z'::timestamptz),
    ('v109', 109, 'অপারেশন থামিয়ে Message? তারপর যা হলো… || REELS || FALTU KOTHA || ADDABAAZ', 'xGwezpzpdds', '00:24', 129, 'https://i.ytimg.com/vi/xGwezpzpdds/hqdefault.jpg', 'available', 'PROMO', '2026-05-28T12:30:17Z'::timestamptz),
    ('v112', 112, 'Privacy vs Trust 🔥 প্রেমে ফোন চেক করা কি Wrong? || REELS || FALTU KOTHA || ADDABAAZ', 'z_VO6mwOjSM', '00:16', 477, 'https://i.ytimg.com/vi/z_VO6mwOjSM/hqdefault.jpg', 'available', 'PROMO', '2026-05-25T12:30:00Z'::timestamptz),
    ('v113', 113, '“Babu Khayecho শুনলেই Mood Off 😵” || REELS || FALTU KOTHA || ADDABAAZ', 'mcA8r9So-4I', '00:19', 221, 'https://i.ytimg.com/vi/mcA8r9So-4I/hqdefault.jpg', 'available', 'PROMO', '2026-05-24T10:00:31Z'::timestamptz),
    ('v114', 114, '“Relationship এ আসল জিনিস কী? 😳” || REELS || FALTU KOTHA || ADDABAAZ', 'Cd3qX4h0DVI', '00:19', 164, 'https://i.ytimg.com/vi/Cd3qX4h0DVI/hqdefault.jpg', 'available', 'PROMO', '2026-05-24T07:00:39Z'::timestamptz),
    ('v116', 116, '“২৪ ঘণ্টা Available থাকাই কি True Love? 🤯” || REELS || FALTU KOTHA || ADDABAAZ', 'AQJ2UtuBixA', '00:26', 136, 'https://i.ytimg.com/vi/AQJ2UtuBixA/hqdefault.jpg', 'available', 'PROMO', '2026-05-23T07:00:14Z'::timestamptz),
    ('v118', 118, '“Netflix And Chill Gone Wrong 😭🍿” || REELS || FALTU KOTHA || ADDABAAZ', 'a8aubxLrcFE', '00:12', 151, 'https://i.ytimg.com/vi/a8aubxLrcFE/hqdefault.jpg', 'available', 'PROMO', '2026-05-21T07:00:32Z'::timestamptz),
    ('v119', 119, '“Good Night নাকি Love Party? 🤨💀” || REELS || FALTU KOTHA || ADDABAAZ', 'Mfz_Xfkq184', '00:21', 281, 'https://i.ytimg.com/vi/Mfz_Xfkq184/hqdefault.jpg', 'available', 'PROMO', '2026-05-20T07:00:16Z'::timestamptz),
    ('v121', 121, '“BF নাকি Customer Care Executive? 😭📞” || REELS || FALTU KOTHA || ADDABAAZ', 'Mt8Rm3_jP2s', '00:51', 803, 'https://i.ytimg.com/vi/Mt8Rm3_jP2s/hqdefault.jpg', 'available', 'PROMO', '2026-05-19T07:00:15Z'::timestamptz),
    ('v122', 122, '“Seen করে Reply নেই? BREAKUP CONFIRMED 💔”| REEL।Fake Podcast | আড্ডাবাজ (Addabaaz)', '5QWIbaYv3_4', '00:48', 220, 'https://i.ytimg.com/vi/5QWIbaYv3_4/hqdefault.jpg', 'available', 'PROMO', '2026-05-18T10:00:13Z'::timestamptz),
    ('v123', 123, '“Knife নিয়ে দৌড়ালেও সেটা Love? 🤣”| REEL।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'iWNRlz3NfiQ', '00:21', 271, 'https://i.ytimg.com/vi/iWNRlz3NfiQ/hqdefault.jpg', 'available', 'PROMO', '2026-05-18T07:00:36Z'::timestamptz),
    ('v124', 124, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'kJD_Zc4Kc40', '00:27', 140, 'https://i.ytimg.com/vi/kJD_Zc4Kc40/hqdefault.jpg', 'available', 'PROMO', '2026-05-17T10:00:59Z'::timestamptz),
    ('v125', 125, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'erBlhjiv19c', '00:35', 136, 'https://i.ytimg.com/vi/erBlhjiv19c/hqdefault.jpg', 'available', 'PROMO', '2026-05-17T07:00:27Z'::timestamptz),
    ('v127', 127, 'LAUGH BITE || ADDABAAZ|| Ami Soumyo #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'c5NrHzBl3w8', '00:43', 133, 'https://i.ytimg.com/vi/c5NrHzBl3w8/hqdefault.jpg', 'available', 'PROMO', '2026-05-16T07:00:39Z'::timestamptz),
    ('v128', 128, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'qYlsmT-yGlE', '00:19', 184, 'https://i.ytimg.com/vi/qYlsmT-yGlE/hqdefault.jpg', 'available', 'PROMO', '2026-05-15T10:01:29Z'::timestamptz),
    ('v129', 129, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', '_pjpCoDGaQ0', '01:15', 16, 'https://i.ytimg.com/vi/_pjpCoDGaQ0/hqdefault.jpg', 'available', 'PROMO', '2026-05-15T07:00:33Z'::timestamptz),
    ('v130', 130, 'LAUGH BITE || ADDABAAZ|| Ami Soumyo #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', '9BdhbE7s5GE', '00:37', 115, 'https://i.ytimg.com/vi/9BdhbE7s5GE/hqdefault.jpg', 'available', 'PROMO', '2026-05-14T10:00:13Z'::timestamptz),
    ('v131', 131, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'TPnO3agMZVM', '00:34', 111, 'https://i.ytimg.com/vi/TPnO3agMZVM/hqdefault.jpg', 'available', 'PROMO', '2026-05-14T07:00:32Z'::timestamptz),
    ('v132', 132, 'LAUGH BITE || ADDABAAZ|| Ami Soumyo #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'u6a6zgKbFkM', '00:32', 104, 'https://i.ytimg.com/vi/u6a6zgKbFkM/hqdefault.jpg', 'available', 'PROMO', '2026-05-13T10:01:30Z'::timestamptz),
    ('v133', 133, 'ছবি নয়, জীবন EDIT হচ্ছে ! শিউরে উঠবেন এই গল্প শুনে | REEL- 01।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'XQ2Bh0gZDbk', '00:28', 149, 'https://i.ytimg.com/vi/XQ2Bh0gZDbk/hqdefault.jpg', 'available', 'PROMO', '2026-05-12T18:14:51Z'::timestamptz),
    ('v135', 135, 'ছবি নয়, জীবন EDIT হচ্ছে ! শিউরে উঠবেন এই গল্প শুনে | REEL- 02।Fake Podcast | আড্ডাবাজ (Addabaaz)', '3Vqw0-I9DI4', '00:23', 109, 'https://i.ytimg.com/vi/3Vqw0-I9DI4/hqdefault.jpg', 'available', 'PROMO', '2026-05-12T04:30:04Z'::timestamptz),
    ('v136', 136, '"পকেটে টাকা না থাকলে প্রেমও নেই! AI Girlfriend Truth" | REEL- 04।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'OrsLu_KqO7s', '00:18', 107, 'https://i.ytimg.com/vi/OrsLu_KqO7s/hqdefault.jpg', 'available', 'PROMO', '2026-05-11T10:00:40Z'::timestamptz),
    ('v137', 137, '"পকেটে টাকা না থাকলে প্রেমও নেই! AI Girlfriend Truth" | REEL- 05।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'w2z_q8BE_eg', '00:24', 75, 'https://i.ytimg.com/vi/w2z_q8BE_eg/hqdefault.jpg', 'available', 'PROMO', '2026-05-11T07:00:56Z'::timestamptz),
    ('v138', 138, 'ছবি নয়, জীবন EDIT হচ্ছে ! শিউরে উঠবেন এই গল্প শুনে | REEL- 03।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'z8hIEm16iWI', '00:19', 221, 'https://i.ytimg.com/vi/z8hIEm16iWI/hqdefault.jpg', 'available', 'PROMO', '2026-05-10T10:52:54Z'::timestamptz),
    ('v140', 140, '"পকেটে টাকা না থাকলে প্রেমও নেই! AI Girlfriend Truth" | REEL- 06।Fake Podcast | আড্ডাবাজ (Addabaaz)', '1VLe0L0HXvI', '00:24', 94, 'https://i.ytimg.com/vi/1VLe0L0HXvI/hqdefault.jpg', 'available', 'PROMO', '2026-05-09T10:00:06Z'::timestamptz),
    ('v141', 141, '"পকেটে টাকা না থাকলে প্রেমও নেই! AI Girlfriend Truth" | REEL- 07।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'XAslqnmpMfk', '00:32', 147, 'https://i.ytimg.com/vi/XAslqnmpMfk/hqdefault.jpg', 'available', 'PROMO', '2026-05-09T07:00:34Z'::timestamptz),
    ('v142', 142, 'ট্রোলিং থেকে থাইল্যান্ড ট্রিপ ! লোকটা জিনিয়াস না পাগল?| REEL- 08।Fake Podcast | আড্ডাবাজ (Addabaaz)', 't3djL70W8P8', '00:40', 200, 'https://i.ytimg.com/vi/t3djL70W8P8/hqdefault.jpg', 'available', 'PROMO', '2026-05-08T10:01:28Z'::timestamptz),
    ('v143', 143, 'ট্রোলিং থেকে থাইল্যান্ড ট্রিপ ! লোকটা জিনিয়াস না পাগল?| REEL- 09।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'oeBZDcB664k', '00:29', 143, 'https://i.ytimg.com/vi/oeBZDcB664k/hqdefault.jpg', 'available', 'PROMO', '2026-05-08T07:00:46Z'::timestamptz),
    ('v144', 144, 'ট্রোলিং থেকে থাইল্যান্ড ট্রিপ ! লোকটা জিনিয়াস না পাগল?| REEL- 10।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'QcBkSc6lvYY', '00:27', 236, 'https://i.ytimg.com/vi/QcBkSc6lvYY/hqdefault.jpg', 'available', 'PROMO', '2026-05-07T09:30:11Z'::timestamptz),
    ('v145', 145, 'ট্রোলিং থেকে থাইল্যান্ড ট্রিপ ! লোকটা জিনিয়াস না পাগল?| REEL- 11।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'bR1xWnRjLgQ', '00:23', 73, 'https://i.ytimg.com/vi/bR1xWnRjLgQ/hqdefault.jpg', 'available', 'PROMO', '2026-05-07T07:00:36Z'::timestamptz),
    ('v147', 147, 'ট্রোলিং থেকে থাইল্যান্ড ট্রিপ ! লোকটা জিনিয়াস না পাগল?| REEL- 09।Fake Podcast | আড্ডাবাজ (Addabaaz)', 'kqUg-5WAVSU', '00:23', 797, 'https://i.ytimg.com/vi/kqUg-5WAVSU/hqdefault.jpg', 'available', 'PROMO', '2026-05-06T07:00:44Z'::timestamptz),
    ('v148', 148, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'DZnPia9eAdM', '00:39', 329, 'https://i.ytimg.com/vi/DZnPia9eAdM/hqdefault.jpg', 'available', 'PROMO', '2026-05-05T11:30:11Z'::timestamptz),
    ('v149', 149, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'UoBAYZb83h4', '00:28', 126, 'https://i.ytimg.com/vi/UoBAYZb83h4/hqdefault.jpg', 'available', 'PROMO', '2026-05-05T07:00:26Z'::timestamptz),
    ('v150', 150, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'sLP48saRriw', '00:26', 473, 'https://i.ytimg.com/vi/sLP48saRriw/hqdefault.jpg', 'available', 'PROMO', '2026-05-03T10:01:27Z'::timestamptz),
    ('v151', 151, 'LAUGH BITE || ADDABAAZ|| Ami Soumyo #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'Y_hKpNSRFec', '00:54', 245, 'https://i.ytimg.com/vi/Y_hKpNSRFec/hqdefault.jpg', 'available', 'PROMO', '2026-05-03T07:20:00Z'::timestamptz),
    ('v153', 153, 'LAUGH BITE || ADDABAAZ|| PTAMIT MITRA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'oI0kuaTj3IU', '00:35', 491, 'https://i.ytimg.com/vi/oI0kuaTj3IU/hqdefault.jpg', 'available', 'PROMO', '2026-05-02T07:30:32Z'::timestamptz),
    ('v154', 154, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'bYamM3HqEXo', '00:39', 280, 'https://i.ytimg.com/vi/bYamM3HqEXo/hqdefault.jpg', 'available', 'PROMO', '2026-05-01T10:01:05Z'::timestamptz),
    ('v155', 155, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'N58kYlmLgSY', '00:48', 453, 'https://i.ytimg.com/vi/N58kYlmLgSY/hqdefault.jpg', 'available', 'PROMO', '2026-05-01T07:00:31Z'::timestamptz),
    ('v156', 156, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'PgLH8nam0hA', '00:30', 806, 'https://i.ytimg.com/vi/PgLH8nam0hA/hqdefault.jpg', 'available', 'PROMO', '2026-04-30T10:00:46Z'::timestamptz),
    ('v157', 157, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'gPLfLpcPoRs', '00:28', 2175, 'https://i.ytimg.com/vi/gPLfLpcPoRs/hqdefault.jpg', 'available', 'PROMO', '2026-04-30T07:00:40Z'::timestamptz),
    ('v159', 159, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'e-2hEURH514', '00:27', 573, 'https://i.ytimg.com/vi/e-2hEURH514/hqdefault.jpg', 'available', 'PROMO', '2026-04-29T07:00:35Z'::timestamptz),
    ('v160', 160, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'iAb01ZTInyQ', '00:29', 846, 'https://i.ytimg.com/vi/iAb01ZTInyQ/hqdefault.jpg', 'available', 'PROMO', '2026-04-28T10:01:11Z'::timestamptz),
    ('v161', 161, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'JT97wKMwtPU', '00:37', 562, 'https://i.ytimg.com/vi/JT97wKMwtPU/hqdefault.jpg', 'available', 'PROMO', '2026-04-28T07:00:15Z'::timestamptz),
    ('v162', 162, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', '6f5NQvAJ_JI', '00:27', 1117, 'https://i.ytimg.com/vi/6f5NQvAJ_JI/hqdefault.jpg', 'available', 'PROMO', '2026-04-27T10:00:11Z'::timestamptz),
    ('v163', 163, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'ZAcR6uqXHv0', '00:52', 152, 'https://i.ytimg.com/vi/ZAcR6uqXHv0/hqdefault.jpg', 'available', 'PROMO', '2026-04-27T07:00:28Z'::timestamptz),
    ('v164', 164, 'FALTU KOTHA || FAKE PODCAST || ADDABAAZ|| PROMO #ytshorts #comedy #funny #comedyreels', '3rehYgxSpRU', '00:49', 369, 'https://i.ytimg.com/vi/3rehYgxSpRU/hqdefault.jpg', 'available', 'PROMO', '2026-04-26T13:30:08Z'::timestamptz),
    ('v166', 166, 'FALTU KOTHA || FAKE PODCAST || ADDABAAZ|| PROMO #ytshorts #comedy #funny #comedyreels', 'eQc27qM04W8', '00:31', 353, 'https://i.ytimg.com/vi/eQc27qM04W8/hqdefault.jpg', 'available', 'PROMO', '2026-04-25T14:30:28Z'::timestamptz),
    ('v167', 167, 'FALTU KOTHA || FAKE PODCAST || ADDABAAZ|| PROMO #ytshorts #comedy #funny #comedyreels', 'NkLCTDyPzl8', '00:44', 759, 'https://i.ytimg.com/vi/NkLCTDyPzl8/hqdefault.jpg', 'available', 'PROMO', '2026-04-25T12:19:29Z'::timestamptz),
    ('v169', 169, 'LAUGH BITE || ADDABAAZ|| Ami Soumyo #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', '09eJiHOAzh8', '00:43', 175, 'https://i.ytimg.com/vi/09eJiHOAzh8/hqdefault.jpg', 'available', 'PROMO', '2026-04-24T07:00:00Z'::timestamptz),
    ('v170', 170, 'LAUGH BITE || ADDABAAZ|| PTAMIT MITRA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'bLavUns5h1w', '00:18', 446, 'https://i.ytimg.com/vi/bLavUns5h1w/hqdefault.jpg', 'available', 'PROMO', '2026-04-23T10:01:03Z'::timestamptz),
    ('v171', 171, 'LAUGH BITE || ADDABAAZ|| REELS #addabaaz #comedy #comedyreels #bengalacomedy #Promotion #ytshorts', '_FtnL0Ld4V8', '00:24', 458, 'https://i.ytimg.com/vi/_FtnL0Ld4V8/hqdefault.jpg', 'available', 'PROMO', '2026-04-23T07:00:23Z'::timestamptz),
    ('v172', 172, 'LAUGH BITE || ADDABAAZ|| Ami Soumyo #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'U5WVciuEy5g', '00:37', 668, 'https://i.ytimg.com/vi/U5WVciuEy5g/hqdefault.jpg', 'available', 'PROMO', '2026-04-22T10:01:01Z'::timestamptz),
    ('v173', 173, 'FALTU KOTHA || FAKE PODCAST || ADDABAAZ|| PROMO||  Avisekk Sikdar Sukanya Dutta #ytshorts', 'YMhMlJMW86Y', '00:47', 1187, 'https://i.ytimg.com/vi/YMhMlJMW86Y/hqdefault.jpg', 'available', 'PROMO', '2026-04-22T07:00:35Z'::timestamptz),
    ('v175', 175, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'sDs6NeuckkU', '00:18', 98, 'https://i.ytimg.com/vi/sDs6NeuckkU/hqdefault.jpg', 'available', 'PROMO', '2026-04-21T10:01:32Z'::timestamptz),
    ('v176', 176, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'kcKRCO5KGBI', '00:21', 4014, 'https://i.ytimg.com/vi/kcKRCO5KGBI/hqdefault.jpg', 'available', 'PROMO', '2026-04-20T11:01:09Z'::timestamptz),
    ('v177', 177, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'rzSI_K_w3To', '00:21', 307, 'https://i.ytimg.com/vi/rzSI_K_w3To/hqdefault.jpg', 'available', 'PROMO', '2026-04-20T07:00:57Z'::timestamptz),
    ('v178', 178, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', '8Rk_nbcxmOE', '00:32', 574, 'https://i.ytimg.com/vi/8Rk_nbcxmOE/hqdefault.jpg', 'available', 'PROMO', '2026-04-19T10:00:23Z'::timestamptz),
    ('v179', 179, 'LAUGH BITE || ADDABAAZ|| VASKAR MANNA #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', '1fIHKqZh9ho', '00:31', 1589, 'https://i.ytimg.com/vi/1fIHKqZh9ho/hqdefault.jpg', 'available', 'PROMO', '2026-04-19T07:00:02Z'::timestamptz),
    ('v181', 181, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'ehATnUSaj8A', '00:22', 785, 'https://i.ytimg.com/vi/ehATnUSaj8A/hqdefault.jpg', 'available', 'PROMO', '2026-04-18T09:30:31Z'::timestamptz),
    ('v182', 182, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', 'HBC_ONSGzqg', '00:45', 552, 'https://i.ytimg.com/vi/HBC_ONSGzqg/hqdefault.jpg', 'available', 'PROMO', '2026-04-17T13:30:30Z'::timestamptz),
    ('v183', 183, 'LAUGH BITE || ADDABAAZ|| Subhadip Ghosh #addabaaz #comedy #comedyreels #bengalacomedy #ytshorts', '9xc1_f0XqUg', '00:24', 1409, 'https://i.ytimg.com/vi/9xc1_f0XqUg/hqdefault.jpg', 'available', 'PROMO', '2026-04-17T09:30:05Z'::timestamptz),
    ('v184', 184, 'নববর্ষ ! দন্ত বিকাশ মার্কা শুভেচ্ছা ও ভালোবাস।#addabaaz #song #funnyvideo #newsong #newbengalisong', 'viYOzaxvxZk', '00:50', 1360, 'https://i.ytimg.com/vi/viYOzaxvxZk/hqdefault.jpg', 'available', 'PROMO', '2026-04-16T14:30:44Z'::timestamptz),
    ('v185', 185, 'LAUGH BITE || ADDABAAZ || PRAMIT #addabaaz #comedy #comedyreels #bengalacomedy #Promotion #ytshorts', 'tr_Ss-QzSS0', '00:43', 775, 'https://i.ytimg.com/vi/tr_Ss-QzSS0/hqdefault.jpg', 'available', 'PROMO', '2026-04-16T13:31:05Z'::timestamptz),
    ('v186', 186, 'LAUGH BITE || ADDABAAZ || PRAMIT #addabaaz #comedy #comedyreels #bengalacomedy #Promotion #ytshorts', 'PI_PaceVnM4', '00:47', 402, 'https://i.ytimg.com/vi/PI_PaceVnM4/hqdefault.jpg', 'available', 'PROMO', '2026-04-16T09:30:13Z'::timestamptz),
    ('v188', 188, 'LAUGH BITE || ADDABAAZ|| REELS #addabaaz #comedy #comedyreels #bengalacomedy #Promotion #ytshorts', 'qJopz44zm7w', '00:19', 359, 'https://i.ytimg.com/vi/qJopz44zm7w/hqdefault.jpg', 'available', 'PROMO', '2026-04-15T09:30:26Z'::timestamptz),
    ('v189', 189, 'LAUGH BITE || ADDABAAZ|| PROMO #addabaaz #comedy #comedyreels #bengalacomedy #Promotion #ytshorts', 'WSHBN0bIRE4', '01:41', 280, 'https://i.ytimg.com/vi/WSHBN0bIRE4/hqdefault.jpg', 'available', 'PROMO', '2026-04-14T14:01:01Z'::timestamptz),
    ('v190', 190, 'নববর্ষর "শুভেচ্ছা ও ভালোবাসা" ||Buddhadeb Bhattacharya || Addabaaz #wish #ytshorts #reels', 'xtftMJP4LLQ', '00:42', 990, 'https://i.ytimg.com/vi/xtftMJP4LLQ/hqdefault.jpg', 'available', 'PROMO', '2026-04-14T09:30:36Z'::timestamptz),
    ('v191', 191, 'নববর্ষর "শুভেচ্ছা ও ভালোবাসা" ||Annmary Tom || Addabaaz #wish #ytshorts #reels', 'E0br6qGRCv8', '00:45', 191, 'https://i.ytimg.com/vi/E0br6qGRCv8/hqdefault.jpg', 'available', 'PROMO', '2026-04-13T12:30:16Z'::timestamptz),
    ('v192', 192, 'LAUGH BITE || ADDABAAZ|| PROMO #addabaaz #comedy #comedyreels #bengalacomedy #Promotion #ytshorts', '2Jj7oTsfw00', '01:20', 1373, 'https://i.ytimg.com/vi/2Jj7oTsfw00/hqdefault.jpg', 'available', 'PROMO', '2026-04-13T09:30:00Z'::timestamptz),
    ('v193', 193, 'নববর্ষর "শুভেচ্ছা ও ভালোবাসা" ||Prantikk Banerjee || Addabaaz #wish #ytshorts #reels', 'urIWSr67j2k', '00:54', 183, 'https://i.ytimg.com/vi/urIWSr67j2k/hqdefault.jpg', 'available', 'PROMO', '2026-04-13T04:30:38Z'::timestamptz)
)
insert into promo_video (external_id, position, title, youtube_id, duration, views,
                         thumbnail_url, availability, kind, publish_date)
select d.external_id, d.position, d.title, d.youtube_id, d.duration, d.views,
       d.thumbnail_url, d.availability, d.kind, d.publish_date
from data d
on conflict (external_id) do update set
    title = excluded.title,
    youtube_id = excluded.youtube_id,
    duration = excluded.duration,
    views = excluded.views,
    thumbnail_url = excluded.thumbnail_url,
    availability = excluded.availability,
    kind = excluded.kind,
    publish_date = excluded.publish_date;

-- ---------------------------------------------------------------------------
-- Posters: upcoming releases + behind the scenes
-- ---------------------------------------------------------------------------
insert into poster (kind, folder, file_name, title, badge, sort_order, published) values
    ('UPCOMING', 'UpcomingReleases/', 'POSTER (1).png', null, 'Coming Soon', 0, true),
    ('UPCOMING', 'UpcomingReleases/', 'POSTER (3).png', null, 'Coming Soon', 1, true),
    ('UPCOMING', 'UpcomingReleases/', 'POSTER (4).png', null, 'Coming Soon', 2, true),
    ('UPCOMING', 'UpcomingReleases/', 'POSTER (5).png', null, 'Coming Soon', 3, true),
    ('UPCOMING', 'UpcomingReleases/', 'POSTER (6).png', null, 'Coming Soon', 4, true),
    ('UPCOMING', 'UpcomingReleases/', 'POSTER (7).png', null, 'Coming Soon', 5, true),
    ('UPCOMING', 'UpcomingReleases/', 'POSTER (8).png', null, 'Coming Soon', 6, true),
    ('UPCOMING', 'UpcomingReleases/', 'Untitled - May 10, 2026 at 13.25.46-21.png', null, 'Coming Soon', 7, true),
    ('UPCOMING', 'UpcomingReleases/', 'ChatGPT Image Jun 11, 2026, 02_53_40 AM.png', null, 'Coming Soon', 8, true),
    ('UPCOMING', 'UpcomingReleases/', 'ChatGPT Image Jun 11, 2026, 02_57_55 AM.png', null, 'Coming Soon', 9, true),
    ('UPCOMING', 'UpcomingReleases/', 'ChatGPT Image Jun 11, 2026, 03_00_37 AM.png', null, 'Coming Soon', 10, true),
    ('UPCOMING', 'UpcomingReleases/', 'ChatGPT Image Jun 11, 2026, 03_03_30 AM.png', null, 'Coming Soon', 11, true),
    ('UPCOMING', 'UpcomingReleases/', 'Gemini_Generated_Image_d59vdwd59vdwd59v.png', null, 'Coming Soon', 12, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (16).png', null, 'BTS', 0, true),
    ('BTS', 'BTS/', 'Bina.jpeg', null, 'BTS', 1, true),
    ('BTS', 'BTS/', 'SONG BTS (2).png', null, 'BTS', 2, true),
    ('BTS', 'BTS/', 'SONG BTS (3).png', null, 'BTS', 3, true),
    ('BTS', 'BTS/', 'SONG BTS (4).png', null, 'BTS', 4, true),
    ('BTS', 'BTS/', 'SONG BTS (5).png', null, 'BTS', 5, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (2).png', null, 'BTS', 6, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (4).png', null, 'BTS', 7, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (5).png', null, 'BTS', 8, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (6).png', null, 'BTS', 9, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (7).png', null, 'BTS', 10, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (8).png', null, 'BTS', 11, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (9).png', null, 'BTS', 12, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (10).png', null, 'BTS', 13, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (11).png', null, 'BTS', 14, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (12).png', null, 'BTS', 15, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (13).png', null, 'BTS', 16, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (14).png', null, 'BTS', 17, true),
    ('BTS', 'BTS/', 'UTTRAN BTS (15).png', null, 'BTS', 18, true)
on conflict (kind, folder, file_name) do update set
    title = excluded.title,
    badge = excluded.badge,
    sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Hero banners (three most-watched shows, matching the old homepage carousel)
-- ---------------------------------------------------------------------------
delete from banner;

insert into banner (show_id, title, subtitle, image_url, youtube_id, sort_order, active)
select s.id, s.title, s.subtitle, s.image_url, e.youtube_id, v.sort_order, true
from show s
join (
    values
    ('laughBite', 0, '9wwtkOdslzc'),
    ('faltu', 1, 'U4C_QnhSm6U'),
    ('shahid', 2, '7jz3BSqSXsM')
) as v (show_key, sort_order, youtube_id) on v.show_key = s.key
left join episode e on e.show_id = s.id and e.youtube_id = v.youtube_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------------
delete from team_member;

insert into team_member (name, role, image_url, quote, sort_order, published) values
    ('Deep', '🎬 Creative Director', 'images/Team/Deep.png',
     '“Create your own ideas, tell your own stories—that’s where films are born.”', 1, true),
    ('S. Sikdar', '🎥 Brand Director', 'images/Team/S_Sikdar.png',
     '“Leaders emphasize that brands live in the mind, defined by customer perception, stories, and relationships rather than just factory output.”', 2, true),
    ('Rajdeep Ghosh', '🎞️ Film Director', 'images/Team/Rajdeep.png', null, 3, true),
    ('Sujoy Sarkar', '🎞️ Film Director', 'images/Team/Sujoy.png', null, 4, true),
    ('Anuraag Pati', '🎞️ Film Director', 'images/Team/Anuraag.png', null, 5, true),
    ('Ashim Das', '✂️ Film Editor', 'images/Team/Ashim.png',
     'The storyteller behind the cut — shaping moments, emotions and rhythm into cinema.', 6, true),
    ('Anupam Gupta Roy', '✂️ Film Editor', 'images/Team/Anupam.png',
     'The storyteller behind the cut — shaping moments, emotions and rhythm into cinema.', 7, true),
    ('Sourav Chatterjee', '📸 Director of Photography (DOP)', 'images/Team/Sourav.png',
     '“Focus on visual storytelling, lighting for mood, and translating a director’s vision into moving images.”', 8, true),
    ('Rupak Chakraborty', '✍️ Writer & Screenplay Director', 'images/Team/Rupak.png',
     '“Let every word become a clear, captivating, and meaningful story.”', 9, true);

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
delete from service;

insert into service (num, title, description, sort_order, published) values
    ('01', 'Film Production', 'Developing and executing full-length feature films, indie projects, and short films from initial narrative concept to silver screen release.', 1, true),
    ('02', 'Ad Film Production', 'Translating brand visions and corporate identities into high-impact visual stories, TV commercials, and digital brand films.', 2, true),
    ('03', 'Direction & Production', 'Providing end-to-end creative leadership and technical production management across pre-production, principal photography, and post-production.', 3, true),
    ('04', 'Script & Storytelling', 'Nurturing raw ideas into polished screenplays, sharp dialogues, and deeply engaging cinematic narratives engineered for emotional resonance.', 4, true),
    ('05', 'Cinematic Visuals', 'Crafting a signature visual aesthetic through modern camera work, artistic lighting design, expert color grading, and meticulous creative direction.', 5, true),
    ('06', 'Digital Content', 'Producing trend-defining digital shows, web series, webcasts, and high-converting video assets optimized for OTT platforms, YouTube, and social media.', 6, true);

-- ---------------------------------------------------------------------------
-- Site settings (contact details, social links, copy)
-- ---------------------------------------------------------------------------
insert into site_setting (key, value) values
    ('contact', '{
        "email": "office@addabaaz.in",
        "landline": "+91 33318 66791",
        "phones": ["+91 90074 17916", "+91 90077 71995"],
        "whatsapp": {"number": "+91 74397 41537",
                     "url": "https://wa.me/917439741537?text=Hello%20ADDABAAZ%2C%20I%27d%20like%20to%20discuss%20a%20project."},
        "address": ["162/B, 283 Lake Gardens", "Kolkata, West Bengal 700045", "India"],
        "mapsUrl": "https://maps.app.goo.gl/4pKaxqR8CGJ5S6Fd7"
    }'::jsonb),
    ('social', '[
        {"label": "Facebook", "icon": "fab fa-facebook-f", "url": "https://www.facebook.com/ADDABAAZDEEP"},
        {"label": "Instagram", "icon": "fab fa-instagram", "url": "https://www.instagram.com/addabaazdeep"},
        {"label": "YouTube", "icon": "fab fa-youtube", "url": "https://www.youtube.com/@ADDABAAZ01"}
    ]'::jsonb),
    ('mission.bengali', '[
        "নতুন ও মৌলিক গল্পের মাধ্যমে দর্শকের মনে গভীর ছাপ তৈরি করা।",
        "সিনেমা ও বিজ্ঞাপনে সৃজনশীলতা, গুণমান এবং নতুন ভাবনার সংমিশ্রণ ঘটানো।",
        "প্রতিভাবান লেখক, পরিচালক ও শিল্পীদের তাঁদের নিজস্ব গল্প বলার সুযোগ করে দেওয়া।",
        "স্থানীয় গল্পকে আন্তর্জাতিক মানের ভিজ্যুয়াল ও নির্মাণশৈলীতে তুলে ধরা।",
        "এমন চলচ্চিত্র ও বিজ্ঞাপন তৈরি করা, যা শুধু দেখা নয়—অনুভব ও মনে রাখার মতো।"
    ]'::jsonb),
    ('mission.english', '[
        "Creating a lasting impact through original, compelling storytelling.",
        "Blending artistic creativity, high production quality, and innovative concepts in cinema & advertising.",
        "Empowering visionaries, emerging writers, directors, and artists to express their authentic voices.",
        "Elevating hyper-local narratives onto a global stage with world-class visuals and craftsmanship.",
        "Crafting cinematic experiences and brand commercials that resonate emotionally and remain unforgettable."
    ]'::jsonb),
    ('home.featuredUpcoming', '{"folder": "UpcomingReleases/", "fileName": "Durga.png", "badge": "Releasing This Month"}'::jsonb),
    ('home.upcomingHiddenFiles', '["ChatGPT Image Jun 11, 2026, 03_00_37 AM.png"]'::jsonb),
    ('home.limits', '{"upcoming": 10, "bts": 10, "promosPerRow": 10}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

commit;
