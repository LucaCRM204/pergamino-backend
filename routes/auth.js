const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../db'); // mysql2/promise pool
const router = express.Router();

// Middleware: valida token desde cookie o header
function requireAuth(req, res, next) {
  const token = req.cookies?.session || (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!token) return res.status(401).json({ error: 'no_token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password, allowInactiveUsers } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    
    // ✅ Solo verificar si el usuario existe, NO el estado active
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    // ✅ Incluir active en el token JWT
    const token = jwt.sign(
      { uid: user.id, role: user.role, id: user.id, email: user.email, active: user.active },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // ✅ Devolver token Y datos del usuario (incluyendo active)
    res.json({ 
      ok: true, 
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        role: user.role,
        active: user.active,  // ✅ Incluir el estado
        reportsTo: user.reportsTo || null
      }
    });
    
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ 
    id: req.user.uid, 
    role: req.user.role, 
    email: req.user.email,
    active: req.user.active  // ✅ Incluir active
  });
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});

module.exports = router;