-- ============================================
-- MIGRACIÓN: soporte para el bot de WhatsApp con IA de Pergamino
-- Correr UNA VEZ contra la base de Pergamino (Railway), después de
-- database.sql. Agrega columnas y tablas, no rompe nada existente.
-- ============================================

-- Contador de mensajes de WhatsApp sin leer, por lead.
ALTER TABLE leads
  ADD COLUMN wa_unread INT DEFAULT 0 AFTER acceptance_attempts;

-- Estado de conexión de cada sesión del bot (1 fila por vendedor/
-- supervisor/gerente conectado, o por bot "extra" con id >= 9000).
CREATE TABLE IF NOT EXISTS wa_sessions (
  id INT NOT NULL,
  supervisor_name VARCHAR(100) NULL,
  phone VARCHAR(30) NULL,
  status VARCHAR(20) DEFAULT 'disconnected',
  bot_enabled TINYINT(1) DEFAULT 0,
  bot_fuente VARCHAR(100) NULL,
  gerencia_id INT NULL, -- a qué gerente/supervisor le llegan los leads de esta sesión
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estado de la conversación con cada cliente (una fila por teléfono).
CREATE TABLE IF NOT EXISTS wa_conversations (
  phone VARCHAR(30) NOT NULL,
  session_id VARCHAR(50) NULL,
  nombre VARCHAR(100) NULL,
  modelo VARCHAR(100) NULL,
  step VARCHAR(30) DEFAULT 'inicio',
  origen ENUM('pagina','bot','directo','desconocido') DEFAULT 'desconocido',
  lead_sent TINYINT(1) DEFAULT 0,
  vendor_takeover TINYINT(1) DEFAULT 0,
  data JSON NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (phone),
  INDEX idx_wa_conv_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historial de mensajes entrantes/salientes por número.
CREATE TABLE IF NOT EXISTS wa_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(50) NULL,
  lead_id INT NULL,
  phone VARCHAR(30) NULL,
  direction ENUM('in','out') DEFAULT 'in',
  message TEXT NULL,
  media_type VARCHAR(20) NULL,
  media_url VARCHAR(255) NULL,
  timestamp BIGINT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  INDEX idx_wa_msg_phone (phone),
  INDEX idx_wa_msg_lead (lead_id),
  INDEX idx_wa_msg_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
