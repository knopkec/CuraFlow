-- Migration: Add per-workplace absence overlap flag
-- Allows selected services to be assigned even when an absence exists on the same day.

ALTER TABLE Workplace
ADD COLUMN IF NOT EXISTS allows_absence_overlap BOOLEAN DEFAULT FALSE;