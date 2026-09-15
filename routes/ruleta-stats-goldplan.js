const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../db');

const PANEL_USER = process.env.PANEL_USER || 'luca';
const PANEL_PASS_HASH = process.env.PANEL_PASS_HASH || '$2b$10$ZJoox6EiQma63Hbh5RW7PuTNHCZZwh3zo8mnRJMcd/4roEABk4bMS';
const PANEL_JWT_SECRET = process.env.PANEL_JWT_SECRET || '2becc678b8b970ce42e43a3cceca97e7ef5ef274371d78f67cea22fdd565917467fe0de44b77218d218e8f7b342802ff';
const JWT_EXPIRY = '7d';

router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sin token' });
  try {
    req.panelUser = jwt.verify(token, PANEL_JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

router.post('/login', async (req, res) => {
  try {
    const { user, pass } = req.body || {};
    if (!user || !pass) return res.status(400).json({ error: 'Faltan credenciales' });
    if (user !== PANEL_USER) return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
    const ok = await bcrypt.compare(pass, PANEL_PASS_HASH);
    if (!ok) return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
    const token = jwt.sign({ user: PANEL_USER }, PANEL_JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({ ok: true, token, user: PANEL_USER });
  } catch (err) {
    console.error('Panel login error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const { from, to, limit } = req.query;
    const limitN = Math.min(parseInt(limit || '1000', 10), 5000);
    const wheres = ["fuente = 'ruleta_digital'"];
    const params = [];
    if (from) { wheres.push('created_at >= ?'); params.push(from + ' 00:00:00'); }
    if (to)   { wheres.push('created_at <= ?'); params.push(to   + ' 23:59:59'); }
    const sql = "SELECT id, nombre, telefono, modelo, marca, notas, assigned_to, created_at FROM leads WHERE " + wheres.join(' AND ') + " ORDER BY created_at DESC LIMIT " + limitN;
    const [rows] = await pool.execute(sql, params);

    const MARCA_NAMES = { vw: 'Volkswagen', fiat: 'Fiat', peugeot: 'Peugeot', renault: 'Renault' };

    const partidas = rows.map(r => {
      const notas = r.notas || '';
      const premioMatch = notas.match(/PREMIO GANADO:\s*(.+?)(?:\s*\u2B50\s*DESTACADO)?\s*$/im);
      const premio = premioMatch ? premioMatch[1].trim() : 'Desconocido';
      const destacado = /\u2B50\s*DESTACADO/i.test(notas);
      const marcaMatch = notas.match(/Marca de inter[e\u00e9]s:\s*(.+?)$/im);
      let marca_pretty = marcaMatch ? marcaMatch[1].trim() : '';
      // Si la columna marca tiene un valor (vw/fiat/peugeot/renault), úsala como fuente de verdad
      if (r.marca && MARCA_NAMES[String(r.marca).toLowerCase()]) {
        marca_pretty = MARCA_NAMES[String(r.marca).toLowerCase()];
      }
      const usadoMatch = notas.match(/Auto usado:\s*(.+?)$/im);
      const auto_usado = usadoMatch ? usadoMatch[1].trim() : '';
      const emoji = inferEmoji(premio);
      const partes = (r.nombre || '').split(' ');
      const nombre = partes[0] || '';
      const apellido = partes.slice(1).join(' ');
      return {
        id: r.id,
        ts: new Date(r.created_at).getTime(),
        fecha: r.created_at,
        nombre: nombre,
        apellido: apellido,
        email: '',
        telefono: r.telefono || '',
        marca: r.marca || '',
        marca_pretty: marca_pretty,
        premio: premio,
        premio_emoji: emoji,
        premio_destacado: destacado,
        auto_usado_texto: auto_usado,
        tiene_usado: /^s[i\u00ed]/i.test(auto_usado),
      };
    });

    res.json({ ok: true, total: partidas.length, partidas: partidas });
  } catch (err) {
    console.error('Panel stats error:', err);
    res.status(500).json({ error: 'Error al obtener stats' });
  }
});

function inferEmoji(premio) {
  const p = (premio || '').toUpperCase();
  if (p.includes('BARILOCHE')) return '\uD83C\uDFD4\uFE0F';
  if (p.includes('SUSCRIPCI')) return '\uD83D\uDCCB';
  if (p.includes('LLAVERO')) return '\uD83D\uDD11';
  if (p.includes('LAPICERA')) return '\u270F\uFE0F';
  if (p.includes('TIRA DE NUEVO')) return '\uD83D\uDD04';
  if (p.includes('CUOTAS')) return '\uD83D\uDCB0';
  if (p.includes('DESCUENTO') || p.includes('1.000.000')) return '\uD83C\uDF89';
  if (p.includes('RETIRO')) return '\uD83D\uDE97';
  return '\uD83C\uDF81';
}

module.exports = router;
