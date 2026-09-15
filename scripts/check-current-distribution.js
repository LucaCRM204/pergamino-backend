// scripts/check-current-distribution.js
const pool = require('../db');
const { getRoundRobinStatus } = require('../utils/assign');

async function checkCurrentDistribution() {
  console.log('\n📊 ESTADO ACTUAL DEL SISTEMA');
  console.log('═'.repeat(70));

  // 1. Estado del Round-Robin
  console.log('\n🔄 ESTADO DEL ROUND-ROBIN:\n');
  const status = await getRoundRobinStatus();
  
  if (!status) {
    console.log('⚠️  No se pudo obtener el estado del round-robin');
    process.exit(1);
  }
  
  console.log(`Total vendedores activos: ${status.totalVendedoresActivos}`);
  console.log(`Índice actual: ${status.indiceActual}`);
  
  if (status.proximoVendedor) {
    console.log(`Próximo vendedor: ${status.proximoVendedor.nombre} (ID: ${status.proximoVendedor.id})`);
    console.log(`Leads totales del próximo: ${status.proximoVendedor.leads_totales}`);
  } else {
    console.log('⚠️  No hay vendedores activos');
  }

  // 2. Distribución completa
  console.log('\n📈 DISTRIBUCIÓN COMPLETA DE TODOS LOS VENDEDORES:\n');
  
  const [distribution] = await pool.execute(`
    SELECT 
      u.id,
      u.name as nombre,
      u.active as activo,
      COUNT(l.id) as total_leads,
      SUM(CASE WHEN l.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as leads_hoy,
      SUM(CASE WHEN l.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as leads_7d,
      SUM(CASE WHEN l.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as leads_30d,
      MAX(l.created_at) as ultimo_lead
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
    WHERE u.role = 'vendedor'
    GROUP BY u.id, u.name, u.active
    ORDER BY u.active DESC, total_leads DESC
  `);

  console.table(distribution);

  // 3. Análisis de equidad en los últimos 7 días
  const activeSellers = distribution.filter(d => d.activo === 1);
  const leads7d = activeSellers.map(d => d.leads_7d);
  
  if (leads7d.length > 0) {
    const avg = leads7d.reduce((a, b) => a + b, 0) / leads7d.length;
    const variance = leads7d.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / leads7d.length;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...leads7d);
    const max = Math.max(...leads7d);

    console.log('\n📊 ANÁLISIS DE EQUIDAD (últimos 7 días):');
    console.log(`   Vendedores activos: ${activeSellers.length}`);
    console.log(`   Promedio de leads: ${avg.toFixed(2)}`);
    console.log(`   Mínimo: ${min} | Máximo: ${max} | Diferencia: ${max - min}`);
    console.log(`   Desviación estándar: ${stdDev.toFixed(2)}`);
    console.log(`   Estado: ${stdDev < 2 ? '✅ Distribución equitativa' : '⚠️  Distribución desbalanceada'}`);
  }

  // 4. Últimos 10 leads asignados
  console.log('\n📋 ÚLTIMOS 10 LEADS ASIGNADOS:\n');
  
  const [recentLeads] = await pool.execute(`
    SELECT 
      l.id,
      l.nombre as cliente,
      l.marca,
      l.assigned_to as vendedor_id,
      u.name as vendedor_nombre,
      l.created_at
    FROM leads l
    LEFT JOIN users u ON u.id = l.assigned_to
    ORDER BY l.created_at DESC
    LIMIT 10
  `);

  console.table(recentLeads);

  console.log('\n' + '═'.repeat(70));
  console.log('✅ Análisis completado\n');

  process.exit();
}

checkCurrentDistribution().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});