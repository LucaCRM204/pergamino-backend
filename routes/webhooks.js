/**
 * ============================================
 * WEBHOOKS DE ENTRADA DE LEADS — Alluma Pergamino
 * ============================================
 * Dos endpoints base para arrancar:
 *   POST /api/webhooks/whatsapp-bot        -> leads que entran por el bot de WhatsApp
 *   POST /api/webhooks/zapier-formularios  -> leads de formularios via Zapier
 *
 * Ambos usan round-robin parejo entre vendedores activos. Para agregar
 * más fuentes a medida que se arme el bot, el patrón es: duplicar uno
 * de estos dos bloques, cambiar la ruta y el nombre del provider en
 * LEAD_API_KEYS.
 *
 * Autenticación: header x-api-key, validado contra LEAD_API_KEYS en
 * el .env (ver middleware/intakeAuth.js). Formato:
 *   whatsapp-bot:clave123;zapier-formularios:clave456
 */

const express = require('express');
const pool = require('../db');
const intakeAuth = require('../middleware/intakeAuth');
const router = express.Router();

let roundRobinIndex = 0;

async function getVendedoresActivos() {
  const [rows] = await pool.execute(
    `SELECT id, name FROM users WHERE role = 'vendedor' AND active = 1 ORDER BY id`
  );
  return rows;
}

async function asignarVendedor(leadId, fuente) {
  const vendedores = await getVendedoresActivos();
  if (vendedores.length === 0) return null;

  const vendedor = vendedores[roundRobinIndex % vendedores.length];
  roundRobinIndex = (roundRobinIndex + 1) % vendedores.length;

  console.log(`[${fuente}] Lead #${leadId || '?'} -> ${vendedor.name} (${vendedor.id})`);
  return vendedor.id;
}

// ========================================
// POST /api/webhooks/whatsapp-bot
// ========================================
router.post('/whatsapp-bot', intakeAuth, async (req, res) => {
  try {
    const { nombre, telefono, modelo, notas, formaPago } = req.body;

    console.log('[whatsapp-bot] Recibido:', JSON.stringify(req.body));

    if (!nombre || !telefono) {
      return res.status(400).json({
        error: 'Nombre y telefono son requeridos',
        received: { nombre, telefono }
      });
    }

    const assigned_to = await asignarVendedor(null, 'whatsapp-bot');
    if (!assigned_to) {
      return res.status(500).json({ error: 'No hay vendedores activos para asignar' });
    }

    const [result] = await pool.execute(
      `INSERT INTO leads
        (nombre, telefono, modelo, marca, formaPago, estado, fuente, notas, assigned_to, created_at, assigned_at)
       VALUES
        (?, ?, ?, 'vw', ?, 'nuevo', 'community', ?, ?, NOW(), NOW())`,
      [
        nombre,
        telefono,
        modelo || 'Consultar',
        formaPago || 'Consultar',
        notas || '',
        assigned_to
      ]
    );

    const [leadRows] = await pool.execute('SELECT * FROM leads WHERE id = ?', [result.insertId]);
    const lead = leadRows[0] || null;

    const io = req.app.get('io');
    if (io && lead) {
      io.emit('lead:created', lead);
    }

    res.json({
      ok: true,
      lead,
      leadId: result.insertId,
      assignedTo: assigned_to,
      fuente: 'whatsapp-bot'
    });
  } catch (error) {
    console.error('[whatsapp-bot] Error:', error);
    res.status(500).json({ error: 'Error al procesar lead' });
  }
});

// ========================================
// POST /api/webhooks/zapier-formularios
// ========================================
router.post('/zapier-formularios', intakeAuth, async (req, res) => {
  try {
    const { nombre, telefono, modelo, notas, formaPago, email } = req.body;

    console.log('[zapier-formularios] Recibido:', JSON.stringify(req.body));

    if (!nombre || !telefono) {
      return res.status(400).json({
        error: 'Nombre y telefono son requeridos',
        received: { nombre, telefono }
      });
    }

    const assigned_to = await asignarVendedor(null, 'zapier-formularios');
    if (!assigned_to) {
      return res.status(500).json({ error: 'No hay vendedores activos para asignar' });
    }

    const notasFinal = email ? `Mail: ${email}${notas ? ' | ' + notas : ''}` : (notas || '');

    const [result] = await pool.execute(
      `INSERT INTO leads
        (nombre, telefono, modelo, marca, formaPago, estado, fuente, notas, assigned_to, created_at, assigned_at)
       VALUES
        (?, ?, ?, 'vw', ?, 'nuevo', 'community', ?, ?, NOW(), NOW())`,
      [
        nombre,
        telefono,
        modelo || 'Consultar',
        formaPago || 'Consultar',
        notasFinal,
        assigned_to
      ]
    );

    const [leadRows] = await pool.execute('SELECT * FROM leads WHERE id = ?', [result.insertId]);
    const lead = leadRows[0] || null;

    const io = req.app.get('io');
    if (io && lead) {
      io.emit('lead:created', lead);
    }

    res.json({
      ok: true,
      lead,
      leadId: result.insertId,
      assignedTo: assigned_to,
      fuente: 'zapier-formularios'
    });
  } catch (error) {
    console.error('[zapier-formularios] Error:', error);
    res.status(500).json({ error: 'Error al procesar lead' });
  }
});

// ========================================
// GET /api/webhooks/health
// ========================================
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    roundRobinIndex
  });
});

module.exports = router;
