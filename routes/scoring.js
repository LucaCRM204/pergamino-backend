/**
 * ============================================
 * ROUTES/SCORING.JS - MÓDULO DE SCORING v8
 * ============================================
 * CAMBIOS v8:
 * - Mejor manejo de errores con mensajes detallados
 * - Cloudinary opcional (no falla si no está configurado)
 * - Logs mejorados para debug
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ============================================
// CLOUDINARY SETUP (OPCIONAL)
// ============================================
let cloudinary = null;
try {
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('✅ Cloudinary configurado correctamente');
  } else {
    console.log('⚠️ Cloudinary no configurado - archivos se guardarán localmente');
  }
} catch (err) {
  console.log('⚠️ Error configurando Cloudinary:', err.message);
}

// ============================================
// HELPER: Comprimir PDF con Ghostscript
// ============================================
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function comprimirPDF(inputPath, maxSizeMB = 9) {
  const stats = fs.statSync(inputPath);
  const fileSizeMB = stats.size / (1024 * 1024);
  
  console.log(`📊 Tamaño original del PDF: ${fileSizeMB.toFixed(2)} MB`);
  
  // Si ya es menor al límite, no comprimir
  if (fileSizeMB <= maxSizeMB) {
    console.log('✅ PDF dentro del límite, no requiere compresión');
    return inputPath;
  }
  
  const outputPath = inputPath.replace(/\.[^.]+$/, '-compressed.pdf');
  
  // Niveles de compresión de Ghostscript (de mayor a menor calidad)
  const qualitySettings = [
    '/ebook',      // ~150 dpi - buena calidad, buen tamaño
    '/screen',     // ~72 dpi - menor calidad, archivo pequeño
  ];
  
  for (const quality of qualitySettings) {
    try {
      console.log(`🔄 Intentando comprimir con calidad: ${quality}`);
      
      const gsCommand = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${quality} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;
      
      await execPromise(gsCommand, { timeout: 60000 });
      
      // Verificar tamaño resultante
      if (fs.existsSync(outputPath)) {
        const compressedStats = fs.statSync(outputPath);
        const compressedSizeMB = compressedStats.size / (1024 * 1024);
        
        console.log(`📊 Tamaño comprimido: ${compressedSizeMB.toFixed(2)} MB (calidad: ${quality})`);
        
        if (compressedSizeMB <= maxSizeMB) {
          // Eliminar original y retornar comprimido
          fs.unlinkSync(inputPath);
          return outputPath;
        }
      }
    } catch (err) {
      console.error(`⚠️ Error comprimiendo con ${quality}:`, err.message);
    }
  }
  
  // Si ninguna compresión funcionó, verificar si el comprimido es al menos más pequeño
  if (fs.existsSync(outputPath)) {
    const compressedStats = fs.statSync(outputPath);
    if (compressedStats.size < stats.size) {
      fs.unlinkSync(inputPath);
      console.log('⚠️ PDF comprimido pero aún excede el límite');
      return outputPath;
    }
    fs.unlinkSync(outputPath);
  }
  
  console.log('⚠️ No se pudo comprimir suficientemente el PDF');
  return inputPath; // Retornar original si no se pudo comprimir
}

// Configuración de multer para subir PDFs
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = '/tmp/scoring';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'venta-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten PDF e imágenes'), false);
    }
  }
});

// =============================================
// Importar middleware de autenticación
// =============================================
const { authenticateToken } = require('../middleware/auth');
const authMiddleware = authenticateToken;

// Estados posibles de VENTA (scoring)
const ESTADOS = {
  PENDIENTE_SUPERVISOR: 'pendiente_supervisor',
  INGRESADA: 'ingresada',
  ASIGNADA: 'asignada',
  EN_PROCESO: 'en_proceso',
  OBSERVADA: 'observada',
  RECHAZADA: 'rechazada',
  PENDIENTE_PAGO: 'pendiente_pago',
  SENA: 'seña',
  FINALIZADA: 'finalizada',
  CARGADA_CONCESIONARIO: 'cargada_concesionario'
};

// Estados protegidos de LEAD (solo automáticos)
const ESTADOS_LEAD_PROTEGIDOS = {
  RECHAZADO_SUPERVISOR: 'rechazado_supervisor',
  RECHAZADO_SCORING: 'rechazado_scoring'
};

// Transiciones permitidas
const TRANSICIONES_PERMITIDAS = {
  [ESTADOS.PENDIENTE_SUPERVISOR]: [ESTADOS.INGRESADA],
  [ESTADOS.INGRESADA]: [ESTADOS.ASIGNADA],
  [ESTADOS.ASIGNADA]: [ESTADOS.EN_PROCESO, ESTADOS.OBSERVADA, ESTADOS.RECHAZADA, ESTADOS.PENDIENTE_PAGO],
  [ESTADOS.EN_PROCESO]: [ESTADOS.OBSERVADA, ESTADOS.RECHAZADA, ESTADOS.PENDIENTE_PAGO],
  [ESTADOS.OBSERVADA]: [ESTADOS.EN_PROCESO, ESTADOS.RECHAZADA, ESTADOS.PENDIENTE_PAGO],
  [ESTADOS.RECHAZADA]: [],
  [ESTADOS.PENDIENTE_PAGO]: [ESTADOS.SENA, ESTADOS.FINALIZADA],
  [ESTADOS.SENA]: [ESTADOS.FINALIZADA],
  [ESTADOS.FINALIZADA]: [ESTADOS.CARGADA_CONCESIONARIO],
  [ESTADOS.CARGADA_CONCESIONARIO]: []
};

// Roles permitidos
const ROLES_VENTAS = ['owner', 'director', 'gerente', 'supervisor', 'vendedor'];
const ROLES_AUTORIZACION = ['owner', 'director', 'gerente', 'supervisor'];
const ROLES_SCORING = ['owner', 'jefe_scoring', 'scoring'];
const ROLES_COBRANZA = ['owner', 'cobranza'];
const ROLES_VER_TODO = ['owner', 'director'];
const ROLES_ELIMINAR = ['owner', 'jefe_scoring']; // Solo owner y jefe_scoring pueden eliminar ventas

// Helper para crear alertas
async function crearAlerta(pool, ventaId, userId, tipo, mensaje) {
  try {
    await pool.query(`
      INSERT INTO scoring_alertas (venta_id, user_id, tipo, mensaje)
      VALUES (?, ?, ?, ?)
    `, [ventaId, userId, tipo, mensaje]);
  } catch (err) {
    console.error('Error creando alerta:', err.message);
  }
}

// Helper para crear nota en historial
async function crearNota(pool, ventaId, userId, tipo, estadoAnterior, estadoNuevo, mensaje, visiblePara = null) {
  try {
    await pool.query(`
      INSERT INTO scoring_notas (venta_id, user_id, tipo, estado_anterior, estado_nuevo, mensaje, visible_para)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [ventaId, userId, tipo, estadoAnterior, estadoNuevo, mensaje, visiblePara ? JSON.stringify(visiblePara) : null]);
  } catch (err) {
    console.error('Error creando nota:', err.message);
  }
}

// ============================================
// HELPER: Cambiar estado del lead automáticamente
// ============================================
async function cambiarEstadoLead(pool, leadId, nuevoEstado, motivo) {
  try {
    const timestamp = new Date().toISOString();
    await pool.query(`
      UPDATE leads 
      SET estado = ?, 
          notas = CONCAT(IFNULL(notas, ''), '\n[', ?, '] Estado cambiado automáticamente a ', ?, ': ', ?)
      WHERE id = ?
    `, [nuevoEstado, timestamp, nuevoEstado, motivo || 'Cambio desde scoring', leadId]);
  } catch (err) {
    console.error('Error cambiando estado de lead:', err.message);
  }
}

// ============================================
// HELPER: Crear mensaje interno
// ============================================
async function crearMensajeInterno(pool, ventaId, remitenteId, destinatarioId, mensaje, tipo) {
  try {
    const [result] = await pool.query(`
      INSERT INTO scoring_mensajes (venta_id, remitente_id, destinatario_id, mensaje, tipo)
      VALUES (?, ?, ?, ?, ?)
    `, [ventaId, remitenteId, destinatarioId, mensaje, tipo]);
    return result.insertId;
  } catch (err) {
    console.error('Error creando mensaje interno:', err.message);
    return null;
  }
}

// ============================================
// HELPER: Verificar si usuario puede autorizar venta
// ============================================
async function puedeAutorizarVenta(pool, userId, role, venta) {
  // Owner y Director pueden autorizar cualquier venta
  if (role === 'owner' || role === 'director') {
    return true;
  }
  
  // Supervisor puede autorizar si es el supervisor directo del vendedor
  if (role === 'supervisor') {
    // Si es el supervisor guardado en la venta
    if (venta.supervisor_id === userId) {
      return true;
    }
    
    // O si el vendedor reporta directamente a este supervisor
    const [esSubordinado] = await pool.query(`
      SELECT 1 FROM users WHERE id = ? AND reportsTo = ? LIMIT 1
    `, [venta.vendedor_id, userId]);
    
    if (esSubordinado.length > 0) {
      return true;
    }
  }
  
  // Gerente puede autorizar ventas de todo su equipo
  if (role === 'gerente') {
    const [esDeEquipo] = await pool.query(`
      SELECT 1 FROM users u
      WHERE u.id = ? 
      AND (
        u.reportsTo = ? 
        OR u.reportsTo IN (SELECT id FROM users WHERE reportsTo = ?)
      )
      LIMIT 1
    `, [venta.vendedor_id, userId, userId]);
    
    if (esDeEquipo.length > 0) {
      return true;
    }
  }
  
  return false;
}

// ============================================
// 1. CREAR VENTA (Vendedor)
// ============================================
router.post('/', authMiddleware, upload.single('pdf'), async (req, res) => {
  const pool = req.app.get('db');
  const io = req.app.get('io');
  const { id: userId, role } = req.user;
  
  console.log('📝 Intentando crear venta - Usuario:', userId, 'Rol:', role);
  
  if (!ROLES_VENTAS.includes(role)) {
    return res.status(403).json({ error: 'No tenés permiso para crear ventas' });
  }
  
  try {
    const { lead_id, fecha_venta, notas_vendedor, tipo_venta } = req.body;
    
    console.log('📝 Datos recibidos:', { lead_id, fecha_venta, tipo_venta });
    
    if (!lead_id || !fecha_venta) {
      return res.status(400).json({ error: 'lead_id y fecha_venta son obligatorios' });
    }
    
    // Obtener info del lead
    console.log('🔍 Buscando lead:', lead_id);
    const [leadRows] = await pool.query(`
      SELECT l.*, u.reportsTo as supervisor_id
      FROM leads l
      LEFT JOIN users u ON l.assigned_to = u.id
      WHERE l.id = ?
    `, [lead_id]);
    
    if (leadRows.length === 0) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }
    
    const lead = leadRows[0];
    console.log('✅ Lead encontrado:', lead.nombre);
    
    // VALIDACIÓN: Verificar que el lead pertenece al usuario (excepto roles superiores)
    if (role === 'vendedor' && lead.assigned_to !== userId) {
      return res.status(403).json({ 
        error: 'No podés cargar ventas de leads que no te pertenecen',
        detalle: 'Solo podés cargar ventas de tus propios leads.'
      });
    }
    
    // Supervisor solo puede cargar de sus vendedores o propios
    if (role === 'supervisor') {
      const [esSubordinado] = await pool.query(
        'SELECT 1 FROM users WHERE id = ? AND reportsTo = ? LIMIT 1',
        [lead.assigned_to, userId]
      );
      if (lead.assigned_to !== userId && esSubordinado.length === 0) {
        return res.status(403).json({ 
          error: 'No podés cargar ventas de leads que no pertenecen a tu equipo'
        });
      }
    }
    
    // Verificar que el lead no esté en estado protegido
    if ([ESTADOS_LEAD_PROTEGIDOS.RECHAZADO_SUPERVISOR, ESTADOS_LEAD_PROTEGIDOS.RECHAZADO_SCORING].includes(lead.estado)) {
      return res.status(400).json({ 
        error: 'No se puede crear una venta para un lead rechazado',
        detalle: 'Este lead fue rechazado previamente. Contactá al owner para reactivarlo.'
      });
    }
    
    // VALIDACIÓN: Verificar que no exista ya una venta para este lead
    const [ventasExistentes] = await pool.query(`
      SELECT id, estado FROM ventas_scoring WHERE lead_id = ? LIMIT 1
    `, [lead_id]);
    
    if (ventasExistentes.length > 0) {
      const ventaExistente = ventasExistentes[0];
      return res.status(400).json({ 
        error: 'Ya existe una venta para este lead',
        detalle: `Este lead ya tiene una venta (ID: ${ventaExistente.id}, Estado: ${ventaExistente.estado}). No se pueden crear ventas duplicadas.`
      });
    }
    
    const supervisorId = lead.supervisor_id || null;
    console.log('👤 Supervisor ID:', supervisorId);
    
    // Subir archivo a Cloudinary si existe y está configurado
    let pdfUrl = null;
    if (req.file) {
      console.log('📎 Archivo recibido:', req.file.originalname);
      
      if (cloudinary) {
        try {
          // Comprimir PDF si es necesario (límite 9MB para dejar margen)
          let filePath = req.file.path;
          if (req.file.mimetype === 'application/pdf') {
            filePath = await comprimirPDF(req.file.path, 9);
          }
          
          const result = await cloudinary.uploader.upload(filePath, {
            folder: 'scoring',
            resource_type: 'auto',
            public_id: `venta-${Date.now()}`,
            access_mode: 'public',  // CORREGIDO: Permite acceso público a PDFs
            timeout: 30000
          });
          pdfUrl = result.secure_url;
          console.log('✅ Archivo subido a Cloudinary:', pdfUrl);
          
          // Limpiar archivo (puede ser el original o el comprimido)
          fs.unlink(filePath, () => {});
          if (filePath !== req.file.path && fs.existsSync(req.file.path)) {
            fs.unlink(req.file.path, () => {});
          }
        } catch (cloudinaryError) {
          console.error('⚠️ Error subiendo a Cloudinary:', cloudinaryError.message);
          // Limpiar archivo temporal
          fs.unlink(req.file.path, () => {});
          // Continuar sin el archivo
        }
      } else {
        console.log('⚠️ Cloudinary no configurado, archivo no se guardará');
        // Limpiar archivo temporal
        fs.unlink(req.file.path, () => {});
      }
    }
    
    // Crear la venta
    console.log('💾 Insertando venta en BD...');
    const [result] = await pool.query(`
      INSERT INTO ventas_scoring 
      (lead_id, vendedor_id, supervisor_id, estado, fecha_venta, pdf_url, notas_vendedor, tipo_venta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [lead_id, userId, supervisorId, ESTADOS.PENDIENTE_SUPERVISOR, fecha_venta, pdfUrl, notas_vendedor || null, tipo_venta || null]);
    
    const ventaId = result.insertId;
    console.log('✅ Venta creada con ID:', ventaId);
    
    // Crear nota (no bloqueante)
    await crearNota(pool, ventaId, userId, 'creacion', null, ESTADOS.PENDIENTE_SUPERVISOR, 'Venta creada por vendedor');
    
    // Crear alerta para supervisor si existe
    if (supervisorId) {
      await crearAlerta(pool, ventaId, supervisorId, 'nueva_venta', `Nueva venta pendiente de autorización: ${lead.nombre}`);
      
      if (io) {
        io.to(`user_${supervisorId}`).emit('scoring:alerta', {
          tipo: 'nueva_venta',
          ventaId,
          mensaje: `Nueva venta pendiente de autorización: ${lead.nombre}`
        });
      }
    }
    
    res.status(201).json({ 
      ok: true, 
      ventaId,
      mensaje: 'Venta creada correctamente. Esperando autorización del supervisor.'
    });
    
  } catch (error) {
    console.error('❌ Error al crear venta:', error.message);
    console.error('Stack:', error.stack);
    if (error.sqlMessage) {
      console.error('SQL Error:', error.sqlMessage);
    }
    res.status(500).json({ 
      error: error.message || 'Error interno del servidor',
      sqlError: error.sqlMessage || null
    });
  }
});

// ============================================
// 2. LISTAR VENTAS (según rol)
// ============================================
router.get('/', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const { id: userId, role } = req.user;
  const { estado, vendedor_id, fecha_desde, fecha_hasta } = req.query;
  
  try {
    let query = `SELECT * FROM v_scoring_dashboard WHERE 1=1`;
    const params = [];
    
    if (ROLES_VER_TODO.includes(role)) {
      // Owner y Director ven todo
    } else if (role === 'jefe_scoring') {
      query += ` AND estado != 'pendiente_supervisor'`;
    } else if (role === 'scoring') {
      query += ` AND (scoring_user_id = ? OR (estado = 'ingresada' AND scoring_user_id IS NULL))`;
      params.push(userId);
    } else if (role === 'cobranza') {
      query += ` AND estado IN ('pendiente_pago', 'seña', 'finalizada', 'cargada_concesionario')`;
    } else if (role === 'gerente') {
      // Gerente ve ventas de su equipo completo
      query += ` AND (vendedor_id = ? OR supervisor_id = ? OR vendedor_id IN (
        SELECT id FROM users WHERE reportsTo = ? OR reportsTo IN (SELECT id FROM users WHERE reportsTo = ?)
      ))`;
      params.push(userId, userId, userId, userId);
    } else if (role === 'supervisor') {
      // Supervisor ve ventas propias y de vendedores que le reportan
      query += ` AND (vendedor_id = ? OR supervisor_id = ? OR vendedor_id IN (
        SELECT id FROM users WHERE reportsTo = ?
      ))`;
      params.push(userId, userId, userId);
    } else if (role === 'vendedor') {
      query += ` AND vendedor_id = ?`;
      params.push(userId);
    }
    
    if (estado) {
      query += ` AND estado = ?`;
      params.push(estado);
    }
    if (vendedor_id) {
      query += ` AND vendedor_id = ?`;
      params.push(vendedor_id);
    }
    if (fecha_desde) {
      query += ` AND fecha_venta >= ?`;
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      query += ` AND fecha_venta <= ?`;
      params.push(fecha_hasta);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const [ventas] = await pool.query(query, params);
    
    res.json(ventas);
    
  } catch (error) {
    console.error('Error al listar ventas:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 3. OBTENER VENTA POR ID (con historial y mensajes)
// ============================================
router.get('/:id', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const { id } = req.params;
  const { id: userId, role } = req.user;
  
  try {
    const [ventas] = await pool.query(`SELECT * FROM v_scoring_dashboard WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    
    const tieneAcceso = 
      ROLES_VER_TODO.includes(role) ||
      venta.vendedor_id === userId ||
      venta.supervisor_id === userId ||
      venta.scoring_user_id === userId ||
      venta.cobranza_user_id === userId ||
      ['jefe_scoring', 'scoring', 'cobranza'].includes(role);
    
    if (!tieneAcceso) {
      return res.status(403).json({ error: 'No tenés acceso a esta venta' });
    }
    
    // Obtener notas/historial
    const [notas] = await pool.query(`
      SELECT sn.*, u.name as usuario_nombre
      FROM scoring_notas sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.venta_id = ?
      ORDER BY sn.created_at DESC
    `, [id]);
    
    // Obtener mensajes internos
    const [mensajes] = await pool.query(`
      SELECT 
        sm.*,
        u_rem.name as remitente_nombre,
        u_rem.role as remitente_rol
      FROM scoring_mensajes sm
      LEFT JOIN users u_rem ON sm.remitente_id = u_rem.id
      WHERE sm.venta_id = ?
      ORDER BY sm.created_at ASC
    `, [id]);
    
    res.json({ ok: true, venta, notas, mensajes });
    
  } catch (error) {
    console.error('Error al obtener venta:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 4. AUTORIZAR VENTA (Supervisor/Gerente) - CORREGIDO v7
// ============================================
router.post('/:id/autorizar', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const io = req.app.get('io');
  const { id } = req.params;
  const { id: userId, role } = req.user;
  const { pv, medio_pago } = req.body;
  
  if (!ROLES_AUTORIZACION.includes(role)) {
    return res.status(403).json({ error: 'No tenés permiso para autorizar ventas' });
  }
  
  try {
    const [ventas] = await pool.query(`SELECT * FROM ventas_scoring WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    
    if (venta.estado !== ESTADOS.PENDIENTE_SUPERVISOR) {
      return res.status(400).json({ error: 'Esta venta ya fue procesada' });
    }
    
    // VERIFICAR PERMISOS - CORREGIDO v7
    const puedeAutorizar = await puedeAutorizarVenta(pool, userId, role, venta);
    
    if (!puedeAutorizar) {
      return res.status(403).json({ error: 'Solo podés autorizar ventas de tu equipo' });
    }
    
    if (!pv || !medio_pago) {
      return res.status(400).json({ error: 'PV y medio de pago son obligatorios' });
    }
    
    await pool.query(`
      UPDATE ventas_scoring 
      SET estado = ?, pv = ?, medio_pago = ?, autorizado_at = NOW()
      WHERE id = ?
    `, [ESTADOS.INGRESADA, pv, medio_pago, id]);
    
    await crearNota(pool, id, userId, 'cambio_estado', ESTADOS.PENDIENTE_SUPERVISOR, ESTADOS.INGRESADA, 'Venta autorizada por supervisor');
    
    if (io) {
      io.emit('scoring:nueva_venta_disponible', { ventaId: id });
    }
    
    res.json({ ok: true, mensaje: 'Venta autorizada correctamente' });
    
  } catch (error) {
    console.error('Error al autorizar venta:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 4.1 RECHAZAR VENTA (Supervisor) - CON CAMBIO DE LEAD - CORREGIDO v7
// ============================================
router.post('/:id/rechazar-supervisor', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const io = req.app.get('io');
  const { id } = req.params;
  const { id: userId, role } = req.user;
  const { motivo } = req.body;
  
  if (!ROLES_AUTORIZACION.includes(role)) {
    return res.status(403).json({ error: 'No tenés permiso para rechazar ventas' });
  }
  
  if (!motivo || !motivo.trim()) {
    return res.status(400).json({ error: 'El motivo del rechazo es obligatorio' });
  }
  
  try {
    const [ventas] = await pool.query(`SELECT * FROM ventas_scoring WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    
    if (venta.estado !== ESTADOS.PENDIENTE_SUPERVISOR) {
      return res.status(400).json({ error: 'Esta venta ya fue procesada' });
    }
    
    // VERIFICAR PERMISOS - CORREGIDO v7
    const puedeRechazar = await puedeAutorizarVenta(pool, userId, role, venta);
    
    if (!puedeRechazar) {
      return res.status(403).json({ error: 'Solo podés rechazar ventas de tu equipo' });
    }
    
    // Actualizar venta a rechazada
    await pool.query(`
      UPDATE ventas_scoring 
      SET estado = 'rechazada', 
          motivo_rechazo = ?
      WHERE id = ?
    `, [motivo, id]);
    
    // CAMBIAR ESTADO DEL LEAD A 'rechazado_supervisor'
    await cambiarEstadoLead(
      pool, 
      venta.lead_id, 
      ESTADOS_LEAD_PROTEGIDOS.RECHAZADO_SUPERVISOR, 
      `Rechazado por supervisor: ${motivo}`
    );
    
    await crearNota(pool, id, userId, 'rechazo_supervisor', ESTADOS.PENDIENTE_SUPERVISOR, 'rechazada', `Rechazado por supervisor: ${motivo}`);
    
    // Crear alerta para el vendedor
    await crearAlerta(pool, id, venta.vendedor_id, 'venta_rechazada_supervisor', `Tu venta fue rechazada por el supervisor: ${motivo}`);
    
    if (io) {
      io.to(`user_${venta.vendedor_id}`).emit('scoring:alerta', {
        tipo: 'venta_rechazada_supervisor',
        ventaId: id,
        mensaje: `Tu venta fue rechazada: ${motivo}`
      });
      
      io.emit('scoring:estado_cambiado', { 
        ventaId: id, 
        estadoAnterior: ESTADOS.PENDIENTE_SUPERVISOR, 
        nuevoEstado: 'rechazada' 
      });
      
      io.emit('lead:updated', { leadId: venta.lead_id });
    }
    
    res.json({ ok: true, mensaje: 'Venta rechazada correctamente' });
    
  } catch (error) {
    console.error('Error al rechazar venta:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 5. TOMAR VENTA (Scoring)
// ============================================
router.post('/:id/tomar', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const io = req.app.get('io');
  const { id } = req.params;
  const { id: userId, role } = req.user;
  
  if (!ROLES_SCORING.includes(role)) {
    return res.status(403).json({ error: 'No tenés permiso para tomar ventas' });
  }
  
  try {
    const [ventas] = await pool.query(`SELECT * FROM ventas_scoring WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    
    if (venta.estado !== ESTADOS.INGRESADA) {
      return res.status(400).json({ error: 'Esta venta no está disponible para tomar' });
    }
    
    if (venta.scoring_user_id && venta.scoring_user_id !== userId) {
      return res.status(400).json({ error: 'Esta venta ya fue tomada por otro usuario' });
    }
    
    await pool.query(`
      UPDATE ventas_scoring 
      SET estado = ?, scoring_user_id = ?, tomada_scoring_at = NOW()
      WHERE id = ?
    `, [ESTADOS.ASIGNADA, userId, id]);
    
    await crearNota(pool, id, userId, 'cambio_estado', ESTADOS.INGRESADA, ESTADOS.ASIGNADA, 'Venta tomada por scoring');
    
    if (io) {
      io.emit('scoring:venta_tomada', { ventaId: id, scoringUserId: userId });
    }
    
    res.json({ ok: true, mensaje: 'Venta asignada correctamente' });
    
  } catch (error) {
    console.error('Error al tomar venta:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 6. CAMBIAR ESTADO (Scoring/Cobranza) - CON MENSAJES EN OBSERVACIONES
// ============================================
router.put('/:id/estado', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const io = req.app.get('io');
  const { id } = req.params;
  const { id: userId, role, name: userName } = req.user;
  const { nuevo_estado, notas, motivo_rechazo } = req.body;
  
  try {
    const [ventas] = await pool.query(`SELECT * FROM ventas_scoring WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    const estadoActual = venta.estado;
    
    // Jefe de scoring y owner pueden saltar transiciones
    const puedeOmitirTransiciones = role === 'jefe_scoring' || role === 'owner';
    
    // Verificar transición permitida
    const transicionesPermitidas = TRANSICIONES_PERMITIDAS[estadoActual] || [];
    if (!puedeOmitirTransiciones && !transicionesPermitidas.includes(nuevo_estado)) {
      return res.status(400).json({ 
        error: `No se puede pasar de "${estadoActual}" a "${nuevo_estado}"`,
        transiciones_permitidas: transicionesPermitidas
      });
    }
    
    // Verificar permisos
    let tienePermiso = false;
    
    // Jefe de scoring puede cambiar TODOS los estados
    if (role === 'jefe_scoring' || role === 'owner') {
      tienePermiso = true;
    } else if (['asignada', 'en_proceso', 'observada', 'rechazada', 'pendiente_pago'].includes(nuevo_estado)) {
      tienePermiso = ROLES_SCORING.includes(role) && (venta.scoring_user_id === userId);
    } else if (['seña', 'finalizada', 'cargada_concesionario'].includes(nuevo_estado)) {
      tienePermiso = ROLES_COBRANZA.includes(role);
    }
    
    if (!tienePermiso) {
      return res.status(403).json({ error: 'No tenés permiso para este cambio de estado' });
    }
    
    // Validaciones específicas
    if (nuevo_estado === ESTADOS.RECHAZADA && !motivo_rechazo) {
      return res.status(400).json({ error: 'El motivo de rechazo es obligatorio' });
    }
    if (nuevo_estado === ESTADOS.OBSERVADA && !notas) {
      return res.status(400).json({ error: 'Las notas son obligatorias para observar' });
    }
    
    // Construir query de actualización
    let updateQuery = `UPDATE ventas_scoring SET estado = ?`;
    const updateParams = [nuevo_estado];
    
    // GUARDAR FECHA/HORA EN NOTAS CON FORMATO ESPECIAL
    if (notas) {
      const timestamp = new Date().toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const notaFormateada = `[${timestamp}] ${userName || 'Scoring'}: ${notas}`;
      updateQuery += `, notas_scoring = CONCAT(IFNULL(notas_scoring, ''), '\n', ?)`;
      updateParams.push(notaFormateada);
    }
    
    if (motivo_rechazo) {
      updateQuery += `, motivo_rechazo = ?`;
      updateParams.push(motivo_rechazo);
    }
    
    // SI ES OBSERVACIÓN, GUARDAR TIMESTAMP Y CREAR MENSAJE
    if (nuevo_estado === ESTADOS.OBSERVADA) {
      updateQuery += `, observada_at = NOW()`;
      
      // Crear mensaje interno automático para supervisor
      await crearMensajeInterno(
        pool, 
        id, 
        userId, 
        venta.supervisor_id,
        notas,
        'observacion'
      );
      
      // También para vendedor si es distinto
      if (venta.vendedor_id && venta.vendedor_id !== venta.supervisor_id) {
        await crearMensajeInterno(
          pool, 
          id, 
          userId, 
          venta.vendedor_id,
          notas,
          'observacion'
        );
      }
    }
    
    // Timestamps específicos
    if (nuevo_estado === ESTADOS.PENDIENTE_PAGO) {
      updateQuery += `, scoring_completado_at = NOW()`;
    } else if (nuevo_estado === ESTADOS.FINALIZADA) {
      updateQuery += `, cobranza_completada_at = NOW()`;
    }
    
    // Asignar usuario de cobranza si corresponde
    if (['seña', 'finalizada', 'cargada_concesionario'].includes(nuevo_estado) && !venta.cobranza_user_id) {
      updateQuery += `, cobranza_user_id = ?`;
      updateParams.push(userId);
    }
    
    updateQuery += ` WHERE id = ?`;
    updateParams.push(id);
    
    await pool.query(updateQuery, updateParams);
    
    // SI ES RECHAZO DE SCORING, CAMBIAR ESTADO DEL LEAD
    if (nuevo_estado === ESTADOS.RECHAZADA) {
      await cambiarEstadoLead(
        pool, 
        venta.lead_id, 
        ESTADOS_LEAD_PROTEGIDOS.RECHAZADO_SCORING, 
        `Rechazado por scoring: ${motivo_rechazo}`
      );
      
      if (io) {
        io.emit('lead:updated', { leadId: venta.lead_id });
      }
    }
    
    await crearNota(pool, id, userId, 'cambio_estado', estadoActual, nuevo_estado, notas || motivo_rechazo || 'Cambio de estado');
    
    // Notificar si es rechazo u observación
    if ([ESTADOS.RECHAZADA, ESTADOS.OBSERVADA].includes(nuevo_estado)) {
      const notificarA = [venta.vendedor_id, venta.supervisor_id].filter(Boolean);
      
      for (const targetUserId of notificarA) {
        const tipoAlerta = nuevo_estado === ESTADOS.RECHAZADA ? 'venta_rechazada_scoring' : 'venta_observada';
        await crearAlerta(pool, id, targetUserId, tipoAlerta, `Venta ${nuevo_estado}: ${motivo_rechazo || notas}`);
        
        if (io) {
          io.to(`user_${targetUserId}`).emit('scoring:alerta', {
            tipo: tipoAlerta,
            ventaId: id,
            mensaje: motivo_rechazo || notas
          });
        }
      }
    }
    
    if (io) {
      io.emit('scoring:estado_cambiado', { ventaId: id, estadoAnterior: estadoActual, nuevoEstado: nuevo_estado });
    }
    
    res.json({ ok: true, mensaje: `Estado cambiado a "${nuevo_estado}"` });
    
  } catch (error) {
    console.error('Error al cambiar estado:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 6.1 RESUBIR PDF (Vendedor/Supervisor cuando está observada o rechazada por supervisor)
// ============================================
router.post('/:id/resubir-pdf', authMiddleware, upload.single('pdf'), async (req, res) => {
  const pool = req.app.get('db');
  const io = req.app.get('io');
  const { id } = req.params;
  const { id: userId, role, name: userName } = req.user;
  
  console.log(`📎 Intento de resubir PDF para venta ${id} por usuario ${userId} (${role})`);
  
  try {
    // Verificar que la venta existe
    const [ventas] = await pool.query(`SELECT * FROM ventas_scoring WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    
    // Verificar que el usuario tiene acceso (vendedor o supervisor de esta venta)
    const tieneAcceso = 
      ROLES_VER_TODO.includes(role) ||
      venta.vendedor_id === userId ||
      venta.supervisor_id === userId;
    
    if (!tieneAcceso) {
      return res.status(403).json({ error: 'No tenés permiso para modificar esta venta' });
    }
    
    // Solo permitir resubir en estados observada o rechazada (por supervisor)
    const estadosPermitidos = [ESTADOS.OBSERVADA, 'rechazada', ESTADOS.PENDIENTE_SUPERVISOR];
    if (!estadosPermitidos.includes(venta.estado)) {
      return res.status(400).json({ 
        error: 'Solo se puede resubir documentación cuando la venta está observada o rechazada',
        estado_actual: venta.estado
      });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Debe adjuntar un archivo PDF o imagen' });
    }
    
    console.log('📎 Archivo recibido:', req.file.originalname);
    
    // Subir a Cloudinary
    let pdfUrl = venta.pdf_url; // Mantener el anterior si falla
    
    if (cloudinary) {
      try {
        // Comprimir PDF si es necesario (límite 9MB para dejar margen)
        let filePath = req.file.path;
        if (req.file.mimetype === 'application/pdf') {
          filePath = await comprimirPDF(req.file.path, 9);
        }
        
        const result = await cloudinary.uploader.upload(filePath, {
          folder: 'scoring',
          resource_type: 'auto',
          public_id: `venta-${id}-resubido-${Date.now()}`,
          access_mode: 'public',
          timeout: 30000
        });
        pdfUrl = result.secure_url;
        console.log('✅ Archivo subido a Cloudinary:', pdfUrl);
        
        // Limpiar archivos temporales
        fs.unlink(filePath, () => {});
        if (filePath !== req.file.path && fs.existsSync(req.file.path)) {
          fs.unlink(req.file.path, () => {});
        }
      } catch (cloudinaryError) {
        console.error('⚠️ Error subiendo a Cloudinary:', cloudinaryError.message);
        fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: 'Error al subir el archivo. Si el archivo es muy grande, intente escanearlo con menor resolución.' });
      }
    } else {
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({ error: 'Servicio de archivos no disponible' });
    }
    
    // Actualizar la venta con el nuevo PDF
    // Si estaba rechazada por supervisor, volver a pendiente_supervisor
    let nuevoEstado = venta.estado;
    if (venta.estado === 'rechazada' && !venta.scoring_user_id) {
      // Fue rechazada por supervisor, volver a pendiente
      nuevoEstado = ESTADOS.PENDIENTE_SUPERVISOR;
    } else if (venta.estado === ESTADOS.OBSERVADA) {
      // Mantener en observada pero marcar como corregida (scoring revisará)
      nuevoEstado = ESTADOS.EN_PROCESO;
    }
    
    await pool.query(`
      UPDATE ventas_scoring 
      SET pdf_url = ?,
          estado = ?,
          resuelta_at = ${venta.estado === ESTADOS.OBSERVADA ? 'NOW()' : 'resuelta_at'}
      WHERE id = ?
    `, [pdfUrl, nuevoEstado, id]);
    
    // Crear nota del cambio
    await crearNota(
      pool, id, userId, 'resubir_pdf', 
      venta.estado, nuevoEstado, 
      `Documentación resubida por ${userName}`
    );
    
    // Crear mensaje interno
    await crearMensajeInterno(
      pool, id, userId, 
      venta.scoring_user_id || venta.supervisor_id,
      `Se resubió la documentación. Por favor revisar nuevamente.`,
      'correccion'
    );
    
    // Notificar por socket
    if (io) {
      // Notificar al scoring si existe
      if (venta.scoring_user_id) {
        io.to(`user_${venta.scoring_user_id}`).emit('scoring:alerta', {
          tipo: 'pdf_resubido',
          ventaId: id,
          mensaje: `Se resubió documentación para venta #${id}`
        });
      }
      
      // Notificar al supervisor si corresponde
      if (venta.supervisor_id && nuevoEstado === ESTADOS.PENDIENTE_SUPERVISOR) {
        io.to(`user_${venta.supervisor_id}`).emit('scoring:alerta', {
          tipo: 'venta_corregida',
          ventaId: id,
          mensaje: `Venta #${id} corregida, pendiente de autorización`
        });
      }
      
      io.emit('scoring:estado_cambiado', { 
        ventaId: id, 
        estadoAnterior: venta.estado, 
        nuevoEstado 
      });
    }
    
    console.log(`✅ PDF resubido para venta ${id}, nuevo estado: ${nuevoEstado}`);
    
    res.json({ 
      ok: true, 
      mensaje: 'Documentación actualizada correctamente',
      nuevoEstado,
      pdfUrl
    });
    
  } catch (error) {
    console.error('❌ Error al resubir PDF:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 7. ENVIAR MENSAJE INTERNO (Supervisor/Vendedor responde a Scoring)
// ============================================
// Acepta tanto /mensaje como /mensajes (singular y plural)
router.post('/:id/mensaje(s)?', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const io = req.app.get('io');
  const { id } = req.params;
  const { id: userId, role, name: userName } = req.user;
  const { mensaje, tipo } = req.body;
  
  if (!mensaje || !mensaje.trim()) {
    return res.status(400).json({ error: 'El mensaje es obligatorio' });
  }
  
  try {
    const [ventas] = await pool.query(`SELECT * FROM ventas_scoring WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    
    // Verificar que el usuario tiene acceso a esta venta
    const tieneAcceso = 
      ROLES_VER_TODO.includes(role) ||
      venta.vendedor_id === userId ||
      venta.supervisor_id === userId ||
      venta.scoring_user_id === userId ||
      ['jefe_scoring', 'scoring'].includes(role);
    
    if (!tieneAcceso) {
      return res.status(403).json({ error: 'No tenés acceso a esta venta' });
    }
    
    // Determinar el tipo de mensaje
    let tipoMensaje = tipo || 'sistema';
    if (ROLES_AUTORIZACION.includes(role)) {
      tipoMensaje = tipo === 'resuelto' ? 'resuelto' : (tipo === 'correccion' ? 'correccion' : 'respuesta_supervisor');
    } else if (role === 'vendedor') {
      // Vendedor puede enviar corrección o respuesta normal
      tipoMensaje = tipo === 'correccion' ? 'correccion' : 'respuesta_vendedor';
    } else if (ROLES_SCORING.includes(role)) {
      tipoMensaje = 'observacion';
    }
    
    // Determinar destinatario
    let destinatarioId = null;
    if (ROLES_AUTORIZACION.includes(role) || role === 'vendedor') {
      // Supervisor o vendedor responde a scoring
      destinatarioId = venta.scoring_user_id;
    } else if (ROLES_SCORING.includes(role)) {
      // Scoring responde a supervisor
      destinatarioId = venta.supervisor_id;
    }
    
    // Crear el mensaje
    const mensajeId = await crearMensajeInterno(pool, id, userId, destinatarioId, mensaje, tipoMensaje);
    
    // Guardar en notas de la venta también (para historial)
    const timestamp = new Date().toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    await crearNota(pool, id, userId, 'mensaje_interno', null, null, `[${timestamp}] ${userName}: ${mensaje}`);
    
    // Si es mensaje de "resuelto" o "correccion", actualizar la venta y notificar a scoring
    if (tipoMensaje === 'resuelto' || tipoMensaje === 'correccion') {
      // Cambiar estado a en_proceso si estaba observada
      if (venta.estado === 'observada') {
        await pool.query(`
          UPDATE ventas_scoring 
          SET estado = 'en_proceso', resuelta_at = NOW()
          WHERE id = ?
        `, [id]);
        
        await crearNota(pool, id, userId, 'cambio_estado', 'observada', 'en_proceso', `Corrección enviada: ${mensaje}`);
      } else {
        await pool.query(`
          UPDATE ventas_scoring 
          SET resuelta_at = NOW()
          WHERE id = ?
        `, [id]);
      }
      
      // Crear alerta para el usuario de scoring
      if (venta.scoring_user_id) {
        await crearAlerta(
          pool, 
          id, 
          venta.scoring_user_id, 
          'observacion_resuelta', 
          `La observación de la venta #${id} fue resuelta por ${userName}: ${mensaje}`
        );
        
        if (io) {
          io.to(`user_${venta.scoring_user_id}`).emit('scoring:alerta', {
            tipo: 'observacion_resuelta',
            ventaId: id,
            mensaje: `Corrección enviada: ${mensaje}`
          });
        }
      }
    } else {
      // Notificar nuevo mensaje
      if (destinatarioId && io) {
        await crearAlerta(pool, id, destinatarioId, 'mensaje_nuevo', `Nuevo mensaje en venta #${id}: ${mensaje.substring(0, 50)}...`);
        
        io.to(`user_${destinatarioId}`).emit('scoring:mensaje_nuevo', {
          ventaId: id,
          mensaje,
          remitente: userName,
          tipo: tipoMensaje
        });
      }
    }
    
    res.json({ 
      ok: true, 
      mensajeId,
      mensaje: 'Mensaje enviado correctamente' 
    });
    
  } catch (error) {
    console.error('Error al enviar mensaje:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 8. OBTENER MENSAJES DE UNA VENTA
// ============================================
router.get('/:id/mensajes', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const { id } = req.params;
  const { id: userId, role } = req.user;
  
  try {
    const [ventas] = await pool.query(`SELECT * FROM ventas_scoring WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    
    // Verificar acceso
    const tieneAcceso = 
      ROLES_VER_TODO.includes(role) ||
      venta.vendedor_id === userId ||
      venta.supervisor_id === userId ||
      venta.scoring_user_id === userId ||
      ['jefe_scoring', 'scoring', 'cobranza'].includes(role);
    
    if (!tieneAcceso) {
      return res.status(403).json({ error: 'No tenés acceso a esta venta' });
    }
    
    const [mensajes] = await pool.query(`
      SELECT 
        sm.*,
        u_rem.name as remitente_nombre,
        u_rem.role as remitente_rol
      FROM scoring_mensajes sm
      LEFT JOIN users u_rem ON sm.remitente_id = u_rem.id
      WHERE sm.venta_id = ?
      ORDER BY sm.created_at ASC
    `, [id]);
    
    // Marcar como leídos los mensajes dirigidos al usuario actual
    await pool.query(`
      UPDATE scoring_mensajes 
      SET leido = TRUE, leido_at = NOW()
      WHERE venta_id = ? AND destinatario_id = ? AND leido = FALSE
    `, [id, userId]);
    
    res.json(mensajes);
    
  } catch (error) {
    console.error('Error al obtener mensajes:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 9. ACTUALIZAR MONTOS (Cobranza)
// ============================================
router.put('/:id/montos', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const { id } = req.params;
  const { id: userId, role } = req.user;
  const { monto_total, monto_seña, notas_cobranza } = req.body;
  
  if (!ROLES_COBRANZA.includes(role) && role !== 'owner') {
    return res.status(403).json({ error: 'No tenés permiso para actualizar montos' });
  }
  
  try {
    const [ventas] = await pool.query(`SELECT * FROM ventas_scoring WHERE id = ?`, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    
    if (!['pendiente_pago', 'seña', 'finalizada'].includes(venta.estado)) {
      return res.status(400).json({ error: 'Solo se pueden actualizar montos en estados de cobranza' });
    }
    
    let updateFields = [];
    let updateParams = [];
    
    if (monto_total !== undefined) {
      updateFields.push('monto_total = ?');
      updateParams.push(monto_total);
    }
    if (monto_seña !== undefined) {
      updateFields.push('monto_seña = ?');
      updateParams.push(monto_seña);
    }
    if (notas_cobranza) {
      const timestamp = new Date().toISOString();
      updateFields.push(`notas_cobranza = CONCAT(IFNULL(notas_cobranza, ''), '\n[', ?, '] ', ?)`);
      updateParams.push(timestamp, notas_cobranza);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }
    
    updateParams.push(id);
    
    await pool.query(`UPDATE ventas_scoring SET ${updateFields.join(', ')} WHERE id = ?`, updateParams);
    
    await crearNota(pool, id, userId, 'actualizacion', null, null, `Montos actualizados: ${JSON.stringify({ monto_total, monto_seña })}`);
    
    res.json({ ok: true, mensaje: 'Montos actualizados correctamente' });
    
  } catch (error) {
    console.error('Error al actualizar montos:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 10. OBTENER MIS ALERTAS
// ============================================
router.get('/alertas/mis-alertas', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const { id: userId } = req.user;
  
  try {
    const [alertas] = await pool.query(`
      SELECT sa.*, vs.lead_id, l.nombre as lead_nombre
      FROM scoring_alertas sa
      LEFT JOIN ventas_scoring vs ON sa.venta_id = vs.id
      LEFT JOIN leads l ON vs.lead_id = l.id
      WHERE sa.user_id = ? AND sa.leida = FALSE
      ORDER BY sa.created_at DESC
      LIMIT 50
    `, [userId]);
    
    res.json(alertas);
    
  } catch (error) {
    console.error('Error al obtener alertas:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 11. MARCAR ALERTA COMO LEÍDA
// ============================================
router.post('/alertas/:alertaId/leer', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const { alertaId } = req.params;
  const { id: userId } = req.user;
  
  try {
    await pool.query(`
      UPDATE scoring_alertas 
      SET leida = TRUE, leida_at = NOW()
      WHERE id = ? AND user_id = ?
    `, [alertaId, userId]);
    
    res.json({ ok: true });
    
  } catch (error) {
    console.error('Error al marcar alerta como leída:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 12. CONTAR MENSAJES NO LEÍDOS
// ============================================
router.get('/mensajes/no-leidos', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const { id: userId } = req.user;
  
  try {
    const [result] = await pool.query(`
      SELECT COUNT(*) as count
      FROM scoring_mensajes
      WHERE destinatario_id = ? AND leido = FALSE
    `, [userId]);
    
    res.json({ count: result[0]?.count || 0 });
    
  } catch (error) {
    console.error('Error al contar mensajes:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 13. ESTADÍSTICAS
// ============================================
router.get('/stats/dashboard', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const { id: userId, role } = req.user;
  const { fecha_desde, fecha_hasta } = req.query;
  
  try {
    let whereClause = '1=1';
    const params = [];
    
    if (!ROLES_VER_TODO.includes(role)) {
      if (role === 'vendedor') {
        whereClause += ' AND vendedor_id = ?';
        params.push(userId);
      } else if (['supervisor', 'gerente'].includes(role)) {
        whereClause += ' AND (vendedor_id = ? OR supervisor_id = ?)';
        params.push(userId, userId);
      }
    }
    
    if (fecha_desde) {
      whereClause += ' AND fecha_venta >= ?';
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      whereClause += ' AND fecha_venta <= ?';
      params.push(fecha_hasta);
    }
    
    const [estadoStats] = await pool.query(`
      SELECT estado, COUNT(*) as cantidad
      FROM ventas_scoring
      WHERE ${whereClause}
      GROUP BY estado
    `, params);
    
    const [tiempoStats] = await pool.query(`
      SELECT 
        AVG(TIMESTAMPDIFF(MINUTE, created_at, autorizado_at)) as avg_tiempo_autorizacion,
        AVG(TIMESTAMPDIFF(MINUTE, autorizado_at, tomada_scoring_at)) as avg_tiempo_tomar,
        AVG(TIMESTAMPDIFF(MINUTE, tomada_scoring_at, scoring_completado_at)) as avg_tiempo_scoring,
        AVG(TIMESTAMPDIFF(MINUTE, scoring_completado_at, cobranza_completada_at)) as avg_tiempo_cobranza
      FROM ventas_scoring
      WHERE ${whereClause}
    `, params);
    
    let topVendedores = [];
    if (ROLES_VER_TODO.includes(role) || ['gerente', 'jefe_scoring'].includes(role)) {
      const [vendedores] = await pool.query(`
        SELECT 
          u.id, u.name,
          COUNT(vs.id) as total_ventas,
          SUM(CASE WHEN vs.estado = 'finalizada' THEN 1 ELSE 0 END) as ventas_finalizadas,
          SUM(CASE WHEN vs.estado = 'rechazada' THEN 1 ELSE 0 END) as ventas_rechazadas
        FROM users u
        LEFT JOIN ventas_scoring vs ON u.id = vs.vendedor_id
        WHERE u.role = 'vendedor'
        GROUP BY u.id
        ORDER BY ventas_finalizadas DESC
        LIMIT 10
      `);
      topVendedores = vendedores;
    }
    
    res.json({
      ok: true,
      estadisticas: {
        por_estado: estadoStats,
        tiempos_promedio: tiempoStats[0],
        top_vendedores: topVendedores
      }
    });
    
  } catch (error) {
    console.error('Error al obtener estadísticas:', error.message);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ============================================
// 14. ELIMINAR VENTA (Solo Owner y Jefe Scoring)
// ============================================
router.delete('/:id', authMiddleware, async (req, res) => {
  const pool = req.app.get('db');
  const io = req.app.get('io');
  const { id } = req.params;
  const { id: userId, role, name: userName } = req.user;
  
  console.log(`🗑️ Intento de eliminar venta ${id} por usuario ${userId} (${role})`);
  
  // Verificar permisos - Solo owner y jefe_scoring pueden eliminar
  if (!ROLES_ELIMINAR.includes(role)) {
    console.log(`❌ Usuario ${userId} sin permisos para eliminar (rol: ${role})`);
    return res.status(403).json({ 
      error: 'No tenés permiso para eliminar ventas',
      detalle: 'Solo el Owner y el Jefe de Scoring pueden eliminar ventas del sistema.'
    });
  }
  
  try {
    // Verificar que la venta existe
    const [ventas] = await pool.query(`
      SELECT vs.*, l.nombre as cliente_nombre 
      FROM ventas_scoring vs
      LEFT JOIN leads l ON vs.lead_id = l.id
      WHERE vs.id = ?
    `, [id]);
    
    if (ventas.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    
    const venta = ventas[0];
    console.log(`📋 Venta encontrada: ID ${id}, Cliente: ${venta.cliente_nombre}, Estado: ${venta.estado}`);
    
    // Iniciar transacción para eliminar todo de forma segura
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 1. Eliminar mensajes asociados
      const [deletedMensajes] = await connection.query(`
        DELETE FROM scoring_mensajes WHERE venta_id = ?
      `, [id]);
      console.log(`🗑️ Mensajes eliminados: ${deletedMensajes.affectedRows}`);
      
      // 2. Eliminar notas/historial asociado
      const [deletedNotas] = await connection.query(`
        DELETE FROM scoring_notas WHERE venta_id = ?
      `, [id]);
      console.log(`🗑️ Notas eliminadas: ${deletedNotas.affectedRows}`);
      
      // 3. Eliminar alertas asociadas
      const [deletedAlertas] = await connection.query(`
        DELETE FROM scoring_alertas WHERE venta_id = ?
      `, [id]);
      console.log(`🗑️ Alertas eliminadas: ${deletedAlertas.affectedRows}`);
      
      // 4. Eliminar la venta
      const [deletedVenta] = await connection.query(`
        DELETE FROM ventas_scoring WHERE id = ?
      `, [id]);
      console.log(`🗑️ Venta eliminada: ${deletedVenta.affectedRows}`);
      
      // Confirmar transacción
      await connection.commit();
      connection.release();
      
      console.log(`✅ Venta ${id} eliminada correctamente por ${userName} (${role})`);
      
      // Notificar por socket si está disponible
      if (io) {
        io.emit('scoring:venta_eliminada', { 
          ventaId: id,
          eliminadoPor: userName,
          timestamp: new Date().toISOString()
        });
      }
      
      res.json({ 
        ok: true, 
        mensaje: 'Venta eliminada correctamente',
        detalles: {
          ventaId: id,
          cliente: venta.cliente_nombre,
          mensajesEliminados: deletedMensajes.affectedRows,
          notasEliminadas: deletedNotas.affectedRows,
          alertasEliminadas: deletedAlertas.affectedRows
        }
      });
      
    } catch (transactionError) {
      // Si algo falla, revertir la transacción
      await connection.rollback();
      connection.release();
      throw transactionError;
    }
    
  } catch (error) {
    console.error('❌ Error al eliminar venta:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: error.message || 'Error interno del servidor',
      sqlError: error.sqlMessage || null
    });
  }
});

module.exports = router;