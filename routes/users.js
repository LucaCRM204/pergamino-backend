const express = require('express');
const pool = require('../db');
const bcrypt = require('bcryptjs');
const dist = require('../services/distribucion.service'); // distribucion ponderada
const router = express.Router();

// GET /users  → lista usuarios
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, reportsTo, active, recibe_leads, created_at, updated_at FROM users ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    console.error('[USERS LIST]', e);
    res.status(500).json({ error: 'Users list failed' });
  }
});

// POST /users  → crear usuario
router.post('/', async (req, res) => {
  try {
    const { name, email, password = '123456', role = 'vendedor', reportsTo = null, active = 1, recibe_leads = 1 } = req.body || {};
    
    // HASHEAR LA CONTRASEÑA antes de guardar
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [r] = await pool.query(
      'INSERT INTO users (name,email,password,role,reportsTo,active,recibe_leads) VALUES (?,?,?,?,?,?,?)',
      [name, email, hashedPassword, role, reportsTo, active ? 1 : 0, Number(recibe_leads) === 0 ? 0 : 1]
    );
    const [row] = await pool.query('SELECT id, name, email, role, reportsTo, active, recibe_leads FROM users WHERE id=?', [r.insertId]);

    // Entra al reparto de su equipo y los porcentajes se reacomodan solos.
    try { await dist.invalidarPorUsuario(r.insertId); }
    catch (e) { console.error('[USERS CREATE] resync distribucion:', e.message); }

    res.status(201).json(row[0]);
  } catch (e) {
    console.error('[USERS CREATE]', e);
    res.status(500).json({ error: 'User create failed' });
  }
});

// PUT /users/:id  → actualizar usuario
router.put('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // recibe_leads: 0 = pausado (entra al CRM pero no recibe leads automáticos)
    const fields = ['name','email','password','role','reportsTo','active','recibe_leads'];
    const sets = [];
    const vals = [];
    
    for (const f of fields) {
      if (f in req.body) { 
        sets.push(`${f}=?`);
        // Si es password, hashearla antes de guardar
        if (f === 'password') {
          vals.push(await bcrypt.hash(req.body[f], 10));
        } else if (f === 'active' || f === 'recibe_leads') {
          // Llega como true/false, 1/0 o "1"/"0": se guarda siempre 0/1
          const v = req.body[f];
          vals.push(v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
        } else {
          vals.push(req.body[f]);
        }
      }
    }
    
    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });
    vals.push(id);
    await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=?`, vals);

    // Si lo desactivaron, lo reactivaron o lo cambiaron de equipo,
    // sale/entra del reparto en el acto y los demas se reacomodan.
    if ('active' in req.body || 'recibe_leads' in req.body || 'reportsTo' in req.body || 'role' in req.body) {
      try { await dist.invalidarPorUsuario(id); }
      catch (e) { console.error('[USERS UPDATE] resync distribucion:', e.message); }
    }

    const [row] = await pool.query('SELECT id, name, email, role, reportsTo, active, recibe_leads FROM users WHERE id=?', [id]);
    res.json(row[0]);
  } catch (e) {
    console.error('[USERS UPDATE]', e);
    res.status(500).json({ error: 'User update failed' });
  }
});

// DELETE /users/:id  → eliminar usuario
router.delete('/:id', async (req, res) => {
  try {
    // Hay que leer su equipo ANTES de borrarlo, despues ya no existe.
    const [[prev]] = await pool.query('SELECT reportsTo FROM users WHERE id=?', [req.params.id]);

    await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
    await pool.query('DELETE FROM distribucion_pesos WHERE user_id=?', [req.params.id]);

    if (prev?.reportsTo) {
      try { await dist.sincronizarEquipo(prev.reportsTo); }
      catch (e) { console.error('[USERS DELETE] resync distribucion:', e.message); }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[USERS DELETE]', e);
    res.status(500).json({ error: 'User delete failed' });
  }
});

module.exports = router;