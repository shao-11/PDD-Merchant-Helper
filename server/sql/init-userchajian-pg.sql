-- PostgreSQL：插件登录账号表（库 dtx，在 192.168.1.73 上执行）
CREATE TABLE IF NOT EXISTS userchajian (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  password VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_userchajian_username UNIQUE (username)
);

COMMENT ON TABLE userchajian IS '插件登录账号';

INSERT INTO userchajian (username, password)
VALUES ('admin', '0000')
ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password;
