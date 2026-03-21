-- Add 'openai' to integrations platform CHECK constraint
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_platform_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_platform_check
  CHECK (platform IN ('stripe', 'hubspot', 'salesforce', 'anthropic', 'openai'));
