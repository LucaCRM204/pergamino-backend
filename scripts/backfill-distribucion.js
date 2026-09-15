/**
 * ============================================
 * BACKFILL DE LA DISTRIBUCION
 * ============================================
 * Corré esto UNA VEZ después de deployar, para llenar la tabla nueva
 * con todos los equipos que ya existen.
 *
 *   node scripts/backfill-distribucion.js
 *
 * Es seguro correrlo las veces que quieras: no duplica nada.
 */

const dist = require('../services/distribucion.service');
const pool = require('../db');

(async () => {
  console.log('\nSincronizando todos los equipos...\n');

  try {
    const cambiados = await dist.sincronizarTodos();
    console.log(`Equipos realineados: ${cambiados}\n`);

    const [resumen] = await pool.query(`
      SELECT d.scope,
             sup.name AS lider,
             SUM(d.activo = 1 AND d.pausado = 0) AS en_reparto,
             ROUND(SUM(CASE WHEN d.activo = 1 AND d.pausado = 0
                            THEN d.peso ELSE 0 END), 2) AS suma
        FROM distribucion_pesos d
        LEFT JOIN users sup
               ON sup.id = CAST(SUBSTRING_INDEX(d.scope, ':', -1) AS UNSIGNED)
       GROUP BY d.scope, sup.name
      HAVING en_reparto > 0
       ORDER BY en_reparto DESC
    `);

    if (!resumen.length) {
      console.log('No se pobló ningún equipo.');
      console.log('Revisá que existan users con role = "vendedor",');
      console.log('active = 1 y reportsTo apuntando a un líder.\n');
      process.exitCode = 1;
      return;
    }

    console.table(resumen);

    const rotos = resumen.filter((r) => Math.abs(Number(r.suma) - 100) > 0.01);
    if (rotos.length) {
      console.error('\nATENCION: estos equipos no suman 100:');
      console.table(rotos);
      process.exitCode = 1;
    } else {
      console.log(`\nListo. Los ${resumen.length} equipos suman 100.\n`);
    }
  } catch (e) {
    console.error('\nFalló el backfill:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
