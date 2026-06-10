-- 插件账号表（库名 dtx，在 192.168.1.73 上执行）
CREATE DATABASE IF NOT EXISTS dtx DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE dtx;

CREATE TABLE IF NOT EXISTS userchajian (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL COMMENT '登录账号',
  password VARCHAR(128) NOT NULL COMMENT '登录密码',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='插件登录账号';

INSERT INTO userchajian (username, password)
VALUES ('admin', '0000')
ON DUPLICATE KEY UPDATE password = VALUES(password);
