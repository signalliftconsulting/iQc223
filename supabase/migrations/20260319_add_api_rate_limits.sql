-- ============================================================
-- Migration: Add api_rate_limits table for API rate limiting
-- ============================================================

CREATE TABLE IF NOT EXISTS api_rate_limits (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_type   TEXT NOT NULL CHECK (window_type IN ('minute', 'hour')),
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, window_type)
);

-- No RLS needed - only accessed via service role client in the edge function.

-- Atomic rate-limit check: increments counter or resets if window expired.
-- Returns: allowed (bool), current_count (int), retry_after (int seconds).
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_window_type TEXT,
  p_window_seconds INTEGER,
  p_max_requests INTEGER
) RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, retry_after INTEGER) AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  -- Atomic upsert: insert new window or increment existing
  INSERT INTO api_rate_limits (user_id, window_type, window_start, request_count)
  VALUES (p_user_id, p_window_type, v_now, 1)
  ON CONFLICT (user_id, window_type) DO UPDATE SET
    window_start = CASE
      WHEN api_rate_limits.window_start + (p_window_seconds || ' seconds')::INTERVAL <= v_now
      THEN v_now
      ELSE api_rate_limits.window_start
    END,
    request_count = CASE
      WHEN api_rate_limits.window_start + (p_window_seconds || ' seconds')::INTERVAL <= v_now
      THEN 1
      ELSE api_rate_limits.request_count + 1
    END
  RETURNING api_rate_limits.window_start, api_rate_limits.request_count
  INTO v_window_start, v_count;

  allowed := v_count <= p_max_requests;
  current_count := v_count;
  retry_after := GREATEST(0, EXTRACT(EPOCH FROM (v_window_start + (p_window_seconds || ' seconds')::INTERVAL - v_now))::INTEGER);

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
