ALTER TABLE customers ADD COLUMN IF NOT EXISTS hubspot_activities TEXT DEFAULT '[]';
