-- Master outbound kill switch (idempotent)
CREATE TABLE IF NOT EXISTS system_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  outbound_calling_enabled boolean NOT NULL DEFAULT false,
  test_mode_only boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text DEFAULT 'system'
);

INSERT INTO system_config (id, outbound_calling_enabled, test_mode_only, updated_at, updated_by)
VALUES (1, false, true, now(), 'migration')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'system_config' AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY "service_role_only" ON system_config
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END;
$$;
