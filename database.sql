-- ============================================
-- ALLUMA PERGAMINO — Schema MySQL
-- Basado en la estructura de GoldPlan CRM, mono-marca VW, con scoring.
-- Reconstruido a partir del código (no es un dump real) — revisar antes
-- de correrlo contra producción.
-- ============================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================
-- USUARIOS
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('owner','director','gerente','supervisor','vendedor','jefe_scoring','scoring','cobranza') DEFAULT 'vendedor',
  reportsTo INT NULL,
  active TINYINT(1) DEFAULT 1,
  lead_percentage INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_reportsto FOREIGN KEY (reportsTo) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_users_reportsto (reportsTo),
  INDEX idx_users_role (role),
  INDEX idx_users_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- LEADS
-- ============================================
CREATE TABLE IF NOT EXISTS leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  telefono VARCHAR(60),
  modelo VARCHAR(120),
  marca ENUM('vw') DEFAULT 'vw',
  formaPago VARCHAR(60),
  notas TEXT,
  estado VARCHAR(40) DEFAULT 'nuevo',
  fuente VARCHAR(60) NULL,
  assigned_to INT NULL,
  infoUsado VARCHAR(255) NULL,
  entrega TINYINT(1) DEFAULT 0,
  fecha DATE NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  assigned_at DATETIME NULL,
  accepted_at DATETIME NULL,
  response_time_minutes INT NULL,
  reassignment_count INT DEFAULT 0,
  last_status_change DATETIME NULL,

  pending_acceptance TINYINT(1) DEFAULT 0,
  current_offer_to INT NULL,
  acceptance_expires_at DATETIME NULL,
  acceptance_attempts TEXT NULL,

  CONSTRAINT fk_lead_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_lead_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_lead_offer_to FOREIGN KEY (current_offer_to) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_leads_assigned (assigned_to),
  INDEX idx_leads_estado (estado),
  INDEX idx_leads_created (created_at),
  INDEX idx_leads_fuente (fuente),
  INDEX idx_leads_pending (pending_acceptance, current_offer_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  action VARCHAR(30) NOT NULL,
  field_name VARCHAR(60) NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  user_id INT NULL,
  user_name VARCHAR(100) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_leadhistory_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_acceptance_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  user_id INT NULL,
  action ENUM('offered','accepted','rejected','timeout') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_acclog_lead (lead_id),
  INDEX idx_acclog_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_reassignment_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  from_user_id INT NULL,
  to_user_id INT NULL,
  reason VARCHAR(100) DEFAULT 'manual',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_reassign_lead (lead_id),
  INDEX idx_reassign_from (from_user_id),
  INDEX idx_reassign_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SESIONES / PRESENCIA
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE NOT NULL,
  session_start DATETIME NOT NULL,
  session_end DATETIME NULL,
  duration_minutes INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_user_date (user_id, date),
  INDEX idx_sessions_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ALERTAS / NOTIFICACIONES INTERNAS
-- ============================================
CREATE TABLE IF NOT EXISTS alertas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  lead_id INT NULL,
  related_id INT NULL,
  is_read TINYINT(1) DEFAULT 0,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  INDEX idx_alertas_user (user_id, is_read),
  INDEX idx_alertas_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) DEFAULT 'normal',
  lead_id INT NULL,
  related_id INT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  INDEX idx_ialerts_user (user_id, is_read),
  INDEX idx_ialerts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- NOTAS INTERNAS / RECORDATORIOS / COTIZACIONES
-- ============================================
CREATE TABLE IF NOT EXISTS notas_internas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  texto TEXT NOT NULL,
  usuario VARCHAR(100) NOT NULL,
  user_id INT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notas_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recordatorios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  descripcion TEXT NOT NULL,
  completado TINYINT(1) DEFAULT 0,
  created_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_recordatorios_lead (lead_id),
  INDEX idx_recordatorios_fecha (fecha, completado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cotizaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  vehiculo VARCHAR(150),
  precio_contado DECIMAL(14,2),
  anticipo DECIMAL(14,2),
  valor_usado DECIMAL(14,2),
  planes TEXT,
  bonificaciones TEXT,
  notas TEXT,
  created_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_cotizaciones_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presupuestos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  modelo VARCHAR(150) NOT NULL,
  marca VARCHAR(60) DEFAULT 'vw',
  imagen_url VARCHAR(500),
  precio_contado DECIMAL(14,2),
  especificaciones_tecnicas TEXT,
  planes_cuotas TEXT,
  bonificaciones TEXT,
  anticipo DECIMAL(14,2),
  activo TINYINT(1) DEFAULT 1,
  created_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_presupuestos_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS metas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendedor_id INT NOT NULL,
  mes VARCHAR(7) NOT NULL,
  meta_ventas INT DEFAULT 0,
  meta_leads INT DEFAULT 0,
  created_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendedor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_meta_vendedor_mes (vendedor_id, mes),
  INDEX idx_metas_mes (mes)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS call_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  user_id INT NOT NULL,
  telefono VARCHAR(60),
  duracion_segundos INT DEFAULT 0,
  resultado VARCHAR(60) DEFAULT 'contactado',
  notas TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_calls_lead (lead_id),
  INDEX idx_calls_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DISTRIBUCIÓN PONDERADA DE LEADS
-- ============================================
CREATE TABLE IF NOT EXISTS distribucion_equipos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lider_id INT NOT NULL,
  modo ENUM('plano','cascada') DEFAULT 'plano',
  nota VARCHAR(255) NULL,
  activo TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lider_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_distequipo_lider (lider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS distribucion_pesos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope VARCHAR(60) NOT NULL,
  user_id INT NOT NULL,
  peso DECIMAL(7,4) DEFAULT 0,
  peso_previo DECIMAL(7,4) DEFAULT 0,
  fijo TINYINT(1) DEFAULT 0,
  activo TINYINT(1) DEFAULT 1,
  pausado TINYINT(1) DEFAULT 0,
  current_weight DECIMAL(10,4) DEFAULT 0,
  asignados_total INT DEFAULT 0,
  asignados_mes INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_distpeso_scope_user (scope, user_id),
  INDEX idx_distpeso_scope (scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS distribucion_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope VARCHAR(60) NOT NULL,
  lead_id INT NULL,
  user_id INT NOT NULL,
  peso DECIMAL(7,4),
  fuente VARCHAR(60) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  INDEX idx_distlog_scope (scope),
  INDEX idx_distlog_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SCORING (venta -> autorización -> scoring -> cobranza)
-- Reconstruido leyendo routes/scoring.js.
-- ============================================
CREATE TABLE IF NOT EXISTS ventas_scoring (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  vendedor_id INT NOT NULL,
  supervisor_id INT NULL,
  scoring_user_id INT NULL,
  estado ENUM(
    'pendiente_supervisor','ingresada','asignada','en_proceso','observada',
    'rechazada','pendiente_pago','seña','finalizada','cargada_concesionario'
  ) DEFAULT 'pendiente_supervisor',
  fecha_venta DATE NULL,
  tipo_venta VARCHAR(60) NULL,
  pdf_url VARCHAR(500) NULL,
  notas_vendedor TEXT NULL,
  motivo_rechazo TEXT NULL,
  pv VARCHAR(100) NULL,
  medio_pago VARCHAR(60) NULL,
  monto_total DECIMAL(14,2) NULL,
  monto_seña DECIMAL(14,2) NULL,
  autorizado_at DATETIME NULL,
  tomada_scoring_at DATETIME NULL,
  resuelta_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (vendedor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (scoring_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ventas_estado (estado),
  INDEX idx_ventas_vendedor (vendedor_id),
  INDEX idx_ventas_scoring_user (scoring_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scoring_notas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venta_id INT NOT NULL,
  user_id INT NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  estado_anterior VARCHAR(40) NULL,
  estado_nuevo VARCHAR(40) NULL,
  mensaje TEXT NULL,
  visible_para TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venta_id) REFERENCES ventas_scoring(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_scoringnotas_venta (venta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scoring_alertas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venta_id INT NOT NULL,
  user_id INT NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  mensaje TEXT NOT NULL,
  leida TINYINT(1) DEFAULT 0,
  leida_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venta_id) REFERENCES ventas_scoring(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_scoringalertas_user (user_id, leida)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scoring_mensajes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venta_id INT NOT NULL,
  remitente_id INT NOT NULL,
  destinatario_id INT NOT NULL,
  mensaje TEXT NOT NULL,
  tipo VARCHAR(40) NULL,
  leido TINYINT(1) DEFAULT 0,
  leido_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venta_id) REFERENCES ventas_scoring(id) ON DELETE CASCADE,
  FOREIGN KEY (remitente_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (destinatario_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_scoringmsj_venta (venta_id),
  INDEX idx_scoringmsj_destinatario (destinatario_id, leido)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

CREATE OR REPLACE VIEW v_scoring_dashboard AS
SELECT
  v.id AS venta_id,
  v.estado,
  v.fecha_venta,
  v.created_at,
  l.id AS lead_id,
  l.nombre AS cliente,
  l.telefono,
  l.modelo,
  vend.name AS vendedor,
  sup.name AS supervisor,
  sco.name AS scoring_user
FROM ventas_scoring v
JOIN leads l ON l.id = v.lead_id
JOIN users vend ON vend.id = v.vendedor_id
LEFT JOIN users sup ON sup.id = v.supervisor_id
LEFT JOIN users sco ON sco.id = v.scoring_user_id;

-- ============================================
-- SEED: usuario owner inicial
-- La password acá es un placeholder EN TEXTO PLANO — hashearla con bcrypt
-- (ver seed-admin.js) antes de insertar, nunca guardarla así.
-- ============================================
-- INSERT IGNORE INTO users (name, email, password, role) VALUES
-- ('Admin Pergamino', 'admin@allumapergamino.com', '<hash_bcrypt_aca>', 'owner');
