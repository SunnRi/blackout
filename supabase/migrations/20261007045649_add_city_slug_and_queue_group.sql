/*
# Add city_slug column for bezsvitla/Yasno city-based schedule lookup

1. Modified Tables
- `user_preferences`: Add `city_slug` (text) and `queue_group` (text)
  to store the selected city and outage queue group.
  These replace the yasno_region_id/yasno_dso_id/yasno_group columns
  for the new unified city-based approach.
*/

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS city_slug text,
  ADD COLUMN IF NOT EXISTS queue_group text;