-- =====================================================================
-- Starter data: 8 cars and the Amman areas with a proposed home car each.
-- Run AFTER schema.sql. Everything here can be edited later in Admin → Setup.
-- Area coordinates are approximate neighbourhood centres; families' map pins
-- are used instead whenever they drop one.
-- =====================================================================

insert into cars (id, name, sort) values
  (1, 'Car 1', 1), (2, 'Car 2', 2), (3, 'Car 3', 3), (4, 'Car 4', 4),
  (5, 'Car 5', 5), (6, 'Car 6', 6), (7, 'Car 7', 7), (8, 'Car 8', 8);
select setval('cars_id_seq', 8);

-- Zones follow last year's car routes:
--   Car 1  Swefieh, Abdoun, Deir Ghbar, Dahiyet Al Hussein
--   Car 2  Um Uthaina, 4th-6th Circle
--   Car 3  Marj Al Hamam, Dahiyet Al Nakheel, Al Bnayat, Naour, Um Al Kondom, Airport Road, Yasmeen
--   Car 4  Khalda, Um Al Sumaq, Dabouq, Korsi
--   Car 5  7th-8th Circle, Rabieh, Kilo, Dahiyat Al Ameer Rashed
--   Car 6  Shmeisani, Jabal Al Webdeh, Jabal Al Hussein, Abdali, 1st-3rd Circle, Jabal Amman, Downtown
--   Car 7  Tla' Al Ali, Dahiyat Al Rasheed, Jubeiha, University St, Al Madina St, Gardens, Mecca St
--   Car 8  Wadi Al Seer, Dwar Al Nahda, Bayader Wadi Al Seer, Jandaweel, Thuhair
insert into areas (name_en, car_id, lat, lng, sort) values
  ('1st Circle', 6, 31.9515, 35.9239, 1),
  ('2nd Circle', 6, 31.954, 35.918, 2),
  ('3rd Circle', 6, 31.9563, 35.9106, 3),
  ('4th Circle', 2, 31.958, 35.902, 4),
  ('5th Circle', 2, 31.961, 35.8935, 5),
  ('6th Circle', 2, 31.966, 35.884, 6),
  ('7th Circle', 5, 31.969, 35.874, 7),
  ('8th Circle', 5, 31.972, 35.858, 8),
  ('Abdali', 6, 31.964, 35.91, 10),
  ('Abdoun', 1, 31.943, 35.889, 10),
  ('Airport Road', 3, 31.9, 35.9, 10),
  ('Al Bnayat', 3, 31.899, 35.864, 10),
  ('Al Madina St', 7, 31.99, 35.865, 10),
  ('Bayader Wadi Al Seer', 8, 31.953, 35.835, 10),
  ('Dabouq', 4, 31.99, 35.81, 10),
  ('Dahiyat Al Ameer Rashed', 5, 31.996, 35.862, 10),
  ('Dahiyat Al Rasheed', 7, 32.012, 35.862, 10),
  ('Dahiyet Al Hussein', 1, 31.972, 35.886, 10),
  ('Deir Ghbar', 1, 31.953, 35.858, 10),
  ('Downtown / Al Balad', 6, 31.952, 35.934, 10),
  ('Dwar Al Nahda', 8, 31.952, 35.825, 10),
  ('Gardens', 7, 31.989, 35.877, 10),
  ('Jabal Al Hussein', 6, 31.974, 35.92, 10),
  ('Jabal Al Webdeh', 6, 31.958, 35.922, 10),
  ('Jabal Amman', 6, 31.952, 35.918, 10),
  ('Jandaweel', 8, 31.96, 35.85, 10),
  ('Jubeiha', 7, 32.026, 35.867, 10),
  ('Khalda', 4, 31.998, 35.846, 10),
  ('Kilo', 5, 32.01, 35.85, 10),
  ('Korsi', 4, 31.983, 35.836, 10),
  ('Marj Al Hamam', 3, 31.887, 35.836, 10),
  ('Mecca St', 7, 31.98, 35.865, 10),
  ('Dahiyet Al Nakheel', 3, 31.9, 35.85, 10),
  ('Naour', 3, 31.875, 35.83, 10),
  ('Rabieh', 5, 31.98, 35.88, 10),
  ('Shmeisani', 6, 31.972, 35.9, 10),
  ('Swefieh', 1, 31.955, 35.865, 10),
  ('Thuhair', 8, 31.97, 35.825, 10),
  ('Tla'' Al Ali', 7, 32.003, 35.865, 10),
  ('Um Al Kondom', 3, 31.885, 35.82, 10),
  ('Um Al Sumaq', 4, 31.981, 35.85, 10),
  ('Um Uthaina', 2, 31.967, 35.88, 10),
  ('University St', 7, 32.015, 35.872, 10),
  ('Wadi Al Seer', 8, 31.955, 35.815, 10),
  ('Yasmeen', 3, 31.918, 35.905, 10),
  ('Other', null, null, null, 99);
