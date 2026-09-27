-- Youths and senior members, and a church's own words for its age bands.
--
-- Additive only. Every existing count keeps its column, so exports, analytics
-- and year-on-year comparisons are untouched.
--
-- Note for whoever reads this later: turning Youths on changes what Adults
-- MEANS from that day forward. Before these columns existed, youths were
-- counted among the adults, and nothing re-splits the history.
ALTER TABLE "attendance_session" ADD COLUMN IF NOT EXISTS "youth_male_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "attendance_session" ADD COLUMN IF NOT EXISTS "youth_female_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "attendance_session" ADD COLUMN IF NOT EXISTS "senior_male_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "attendance_session" ADD COLUMN IF NOT EXISTS "senior_female_count" integer DEFAULT 0 NOT NULL;

-- Null means "never configured", which reads as the defaults.
ALTER TABLE "church" ADD COLUMN IF NOT EXISTS "attendance_bands" jsonb;
