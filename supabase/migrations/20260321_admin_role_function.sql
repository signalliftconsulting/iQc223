-- ═══════════════════════════════════════════════════════════════
-- Migration: Replace hardcoded admin email arrays with role-based function
-- ═══════════════════════════════════════════════════════════════

-- Create a SECURITY DEFINER function to check admin status
-- This avoids recursive RLS checks on user_profiles
CREATE OR REPLACE FUNCTION public.is_jwt_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- Ensure current admin users have role = 'admin'
UPDATE public.user_profiles
SET role = 'admin'
WHERE user_id IN (
  SELECT id FROM auth.users
  WHERE email IN ('signalliftconsulting@gmail.com', 'ian@iqcadence.com')
);
