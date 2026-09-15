// scripts/test-distribution.js
const pool = require('../db');
const { getAssignedVendorByBrand, resetRoundRobinIndex } = require('../utils/assign');

async function testDistribution() {
  console.log('\n🧪 TEST DE DISTRIBUCIÓN EQUITATIVA');
  console.log('═'.repeat(70));
  console.log('Simulando 20 leads entrando al sistema...\n');

  // Resetear para empezar limpio
  resetRoundRobinIndex();

  // Simular 20 leads entrando
  const assignments = [];
  const marcas = ['vw', 'fiat', 'peugeot', 'renault'];

  for (let i = 1; i <= 20; i++) {
    const marca = marcas[Math.floor(Math.random() * marcas.length)];
    const vendorId = await getAssignedVendorByBrand(marca);
    
    assignments.push({ 
      leadNum: i, 
      marca, 
      vendorId 
    });

    // Pequeña pausa visual
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Resumen por vendedor
  console.log('\n' + '═'.repeat(70));
  console.log('\n📊 RESUMEN DE ASIGNACIONES DEL TEST:\n');

  const summary = {};
  assignments.forEach(a => {
    const key = `Vendedor ${a.vendorId}`;
    summary[key] = (summary[key] || 0) + 1;
  });

  console.table(summary);

  // Verificar distribución real en BD
  console.log('\n📊 DISTRIBUCIÓN REAL EN LA BASE DE DATOS:\n');
  
  const [realDistribution] = await pool.execute(`
    SELECT 
      u.id,
      u.name as nombre,
      u.active as activo,
      COUNT(l.id) as total_leads,
      SUM(CASE WHEN l.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) as leads_hoy,
      SUM(CASE WHEN l.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as leads_7d
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
    WHERE u.role = 'vendedor' AND u.active = 1
    GROUP BY u.id, u.name, u.active
    ORDER BY total_leads DESC
  `);

  console.table(realDistribution);

  // Calcular desviación estándar para ver equidad
  const leadCounts = Object.values(summary);
  const avg = leadCounts.reduce((a, b) => a + b, 0) / leadCounts.length;
  const variance = leadCounts.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / leadCounts.length;
  const stdDev = Math.sqrt(variance);

  console.log('\n📈 ANÁLISIS DE EQUIDAD:');
  console.log(`   Promedio de leads por vendedor: ${avg.toFixed(2)}`);
  console.log(`   Desviación estándar: ${stdDev.toFixed(2)}`);
  console.log(`   ${stdDev < 1 ? '✅ Distribución MUY equitativa' : stdDev < 2 ? '✅ Distribución equitativa' : '⚠️  Distribución desbalanceada'}`);

  console.log('\n' + '═'.repeat(70));
  console.log('✅ Test completado\n');

  process.exit();
}

testDistribution().catch(err => {
  console.error('❌ Error en el test:', err);
  process.exit(1);
});