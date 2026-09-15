/**
 * MIGRACIONES MYSQL - CRM Alluma
 * Ejecutar: node migrations.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
  console.log('🔄 Iniciando migraciones MySQL para CRM Alluma...\n');

  const connection = await mysql.createConnection(
    process.env.DATABASE_URL || {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'railway',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    }
  );

  try {
    console.log('📡 Conectado a MySQL');
    const [dbInfo] = await connection.execute('SELECT DATABASE() as db');
    console.log(`📁 Base de datos: ${dbInfo[0].db}\n`);

    // 1. TABLA: user_sessions
    console.log('📦 Creando tabla user_sessions...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        date DATE NOT NULL,
        session_start DATETIME NOT NULL,
        session_end DATETIME NULL,
        duration_minutes INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sessions_user_date (user_id, date),
        INDEX idx_sessions_date (date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ user_sessions creada\n');

    // 2. TABLA: lead_reassignment_log
    console.log('📦 Creando tabla lead_reassignment_log...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS lead_reassignment_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lead_id INT NOT NULL,
        from_user_id INT NULL,
        to_user_id INT NULL,
        reason VARCHAR(100) DEFAULT 'manual',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_reassign_lead (lead_id),
        INDEX idx_reassign_from (from_user_id),
        INDEX idx_reassign_created (created_at),
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
        FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ lead_reassignment_log creada\n');

    // 3. AGREGAR COLUMNAS A leads
    console.log('📦 Verificando columnas en tabla leads...');
    
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads'
    `);
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);

    if (!existingColumns.includes('assigned_at')) {
      await connection.execute(`ALTER TABLE leads ADD COLUMN assigned_at DATETIME NULL`);
      console.log('  + assigned_at agregada');
    }

    if (!existingColumns.includes('accepted_at')) {
      await connection.execute(`ALTER TABLE leads ADD COLUMN accepted_at DATETIME NULL`);
      console.log('  + accepted_at agregada');
    }

    if (!existingColumns.includes('response_time_minutes')) {
      await connection.execute(`ALTER TABLE leads ADD COLUMN response_time_minutes INT NULL`);
      console.log('  + response_time_minutes agregada');
    }

    if (!existingColumns.includes('reassignment_count')) {
      await connection.execute(`ALTER TABLE leads ADD COLUMN reassignment_count INT DEFAULT 0`);
      console.log('  + reassignment_count agregada');
    }

    if (!existingColumns.includes('last_status_change')) {
      await connection.execute(`ALTER TABLE leads ADD COLUMN last_status_change DATETIME NULL`);
      console.log('  + last_status_change agregada');
    }

    console.log('✅ Columnas de leads verificadas\n');

    // 4. TABLA: internal_alerts
    console.log('📦 Creando tabla internal_alerts...');
    await connection.execute(`
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
        INDEX idx_alerts_user (user_id, is_read),
        INDEX idx_alerts_created (created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ internal_alerts creada\n');

    // 5. ACTUALIZAR datos existentes
    console.log('📦 Actualizando datos existentes...');
    
    const [result1] = await connection.execute(`
      UPDATE leads 
      SET assigned_at = created_at 
      WHERE assigned_to IS NOT NULL 
        AND assigned_at IS NULL
    `);
    console.log(`  + assigned_at actualizado en ${result1.affectedRows} leads`);

    const [result2] = await connection.execute(`
      UPDATE leads 
      SET accepted_at = COALESCE(updated_at, created_at)
      WHERE assigned_to IS NOT NULL 
        AND estado NOT IN ('nuevo')
        AND accepted_at IS NULL
    `);
    console.log(`  + accepted_at actualizado en ${result2.affectedRows} leads\n`);

    console.log('🎉 ¡Migraciones completadas!\n');

  } catch (error) {
    console.error('❌ Error en migraciones:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

migrate();