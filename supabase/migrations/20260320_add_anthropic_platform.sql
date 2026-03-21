-- Add 'anthropic' to integrations platform CHECK constraint
-- This allows storing Anthropic API key connections for AI-powered features

-- Drop existing constraint and recreate with anthropic included
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_platform_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_platform_check
  CHECK (platform IN ('stripe', 'hubspot', 'salesforce', 'anthropic'));
