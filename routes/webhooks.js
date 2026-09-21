/**
 * ============================================
 * WEBHOOKS DE ENTRADA DE LEADS — Alluma Pergamino
 * ============================================
 * Genéricos (round-robin parejo entre vendedores activos):
 *   POST /api/webhooks/whatsapp-bot        -> leads simples, fuente community
 *   POST /api/webhooks/zapier-formularios  -> leads de formularios via Zapier
 *
 * Bot de WhatsApp con IA (index.js del bot, puerto 3700):
 *   POST /api/webhooks/zapier              -> crea el lead al primer mensaje (parcial)
 *   POST /api/webhooks/bot-lead-update     -> lo va completando (nombre/modelo/notas)
 *
 * Autenticación:
 * - whatsapp-bot / zapier-formularios: header x-api-key contra LEAD_API_KEYS
 *   (ver middleware/intakeAuth.js). Formato: whatsapp-bot:clave123;...
 * - zapier / bot-lead-update: header x-zapier-key contra ZAPIER_WEBHOOK_KEY
 *   del .env (tiene que coincidir con el ZAPIER_KEY del bot).
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
// POST /api/webhooks/zapier
// Usado por el bot de WhatsApp con IA (index.js del bot). Crea el lead
// al primer mensaje con datos parciales, y lo va completando después
// con /api/webhooks/bot-lead-update. `equipo` es el id de un gerente —
// si viene `assigned_to` o `supervisor_id`, afinan el reparto.
// Autenticación propia (x-zapier-key), distinta de LEAD_API_KEYS,
// porque el bot ya la trae hardcodeada así de su lado.
// ========================================
function requireZapierKey(req, res, next) {
  const key = req.headers['x-zapier-key'];
  if (!process.env.ZAPIER_WEBHOOK_KEY || key !== process.env.ZAPIER_WEBHOOK_KEY) {
    return res.status(401).json({ error: 'x-zapier-key inválida' });
  }
  next();
}

router.post('/zapier', requireZapierKey, async (req, res) => {
  try {
    const { nombre, telefono, modelo, fuente, notas, equipo, assigned_to, supervisor_id } = req.body;

    if (!nombre || !telefono) {
      return res.status(400).json({ error: 'Nombre y telefono son requeridos' });
    }

    let finalAssignedTo = null;

    if (assigned_to) {
      // Va directo a ese vendedor puntual.
      finalAssignedTo = assigned_to;
    } else if (supervisor_id) {
      // Round-robin entre los vendedores de ese supervisor.
      const [vendedores] = await pool.execute(
        `SELECT id FROM users WHERE role = 'vendedor' AND active = 1 AND reportsTo = ? ORDER BY id`,
        [supervisor_id]
      );
      if (vendedores.length > 0) {
        const [[{ c }]] = await pool.execute(
          `SELECT COUNT(*) AS c FROM leads WHERE assigned_to IN (${vendedores.map(() => '?').join(',')})`,
          vendedores.map(v => v.id)
        );
        finalAssignedTo = vendedores[c % vendedores.length].id;
      }
    } else if (equipo) {
      // Round-robin entre todos los vendedores que reportan (directa o
      // indirectamente) a ese gerente. Simplificado a 2 niveles
      // (vendedor -> supervisor -> gerente), que es la jerarquía real.
      const [vendedores] = await pool.execute(
        `SELECT u.id FROM users u
         LEFT JOIN users sup ON sup.id = u.reportsTo
         WHERE u.role = 'vendedor' AND u.active = 1
           AND (u.reportsTo = ? OR sup.reportsTo = ?)
         ORDER BY u.id`,
        [equipo, equipo]
      );
      if (vendedores.length > 0) {
        const [[{ c }]] = await pool.execute(
          `SELECT COUNT(*) AS c FROM leads WHERE assigned_to IN (${vendedores.map(() => '?').join(',')})`,
          vendedores.map(v => v.id)
        );
        finalAssignedTo = vendedores[c % vendedores.length].id;
      }
    }

    if (!finalAssignedTo) {
      finalAssignedTo = await asignarVendedor(null, 'zapier-bot-ia');
    }
    if (!finalAssignedTo) {
      return res.status(500).json({ error: 'No hay vendedores activos para asignar' });
    }

    const [result] = await pool.execute(
      `INSERT INTO leads
        (nombre, telefono, modelo, marca, formaPago, estado, fuente, notas, assigned_to, created_at, assigned_at)
       VALUES
        (?, ?, ?, 'vw', 'Consultar', 'nuevo', ?, ?, ?, NOW(), NOW())`,
      [nombre, telefono, modelo || 'Consultando...', fuente || 'WhatsApp Bot Pergamino', notas || '', finalAssignedTo]
    );

    const [leadRows] = await pool.execute('SELECT * FROM leads WHERE id = ?', [result.insertId]);
    const lead = leadRows[0] || null;

    const io = req.app.get('io');
    if (io && lead) io.emit('lead:created', lead);

    res.json({ ok: true, lead, leadId: result.insertId, assignedTo: finalAssignedTo });
  } catch (error) {
    console.error('[zapier] Error:', error);
    res.status(500).json({ error: 'Error al procesar lead' });
  }
});

// ========================================
// POST /api/webhooks/bot-lead-update
// El bot va completando el lead a medida que la conversación avanza
// (nombre, modelo, notas). Solo actualiza los campos que vengan.
// ========================================
router.post('/bot-lead-update', requireZapierKey, async (req, res) => {
  try {
    const { leadId, nombre, modelo, notas } = req.body;
    if (!leadId) return res.status(400).json({ error: 'Falta leadId' });

    const sets = [];
    const values = [];
    if (nombre) { sets.push('nombre = ?'); values.push(nombre); }
    if (modelo) { sets.push('modelo = ?'); values.push(modelo); }
    if (notas) { sets.push('notas = ?'); values.push(notas); }
    if (!sets.length) return res.json({ ok: true, updated: false });

    values.push(leadId);
    await pool.execute(`UPDATE leads SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, values);

    const [rows] = await pool.execute('SELECT * FROM leads WHERE id = ?', [leadId]);
    const lead = rows[0] || null;

    const io = req.app.get('io');
    if (io && lead) io.emit('lead:updated', lead);

    res.json({ ok: true, updated: true, lead });
  } catch (error) {
    console.error('[bot-lead-update] Error:', error);
    res.status(500).json({ error: 'Error al actualizar lead' });
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
