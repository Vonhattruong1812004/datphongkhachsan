CREATE TABLE IF NOT EXISTS system_notifications (
  id SERIAL PRIMARY KEY,
  recipient_account_id INT NULL REFERENCES taikhoan(matk) ON DELETE CASCADE,
  recipient_role_id INT NULL REFERENCES vaitro(mavaitro) ON DELETE CASCADE,
  recipient_customer_id INT NULL REFERENCES khachhang(makhachhang) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  href TEXT NOT NULL,
  entity_type VARCHAR(60),
  entity_id INT,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_notifications_account ON system_notifications(recipient_account_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_notifications_role ON system_notifications(recipient_role_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_notifications_customer ON system_notifications(recipient_customer_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_notifications_entity ON system_notifications(entity_type, entity_id);
