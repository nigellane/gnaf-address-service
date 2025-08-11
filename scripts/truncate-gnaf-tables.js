/**
 * Truncate GNAF tables for clean import testing
 * Preserves schema structure and reference data
 */

require('dotenv').config();
const { getDatabase } = require('../dist/config/database');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

async function truncateGnafTables() {
  const db = getDatabase();
  
  try {
    logger.info('Starting GNAF table truncation...');
    
    // Truncate in reverse dependency order to avoid foreign key conflicts
    const truncateQueries = [
      'TRUNCATE TABLE gnaf.addresses RESTART IDENTITY CASCADE',
      'TRUNCATE TABLE gnaf.streets RESTART IDENTITY CASCADE', 
      'TRUNCATE TABLE gnaf.localities RESTART IDENTITY CASCADE'
      // Note: Not truncating gnaf.states as it contains reference data
    ];
    
    for (const query of truncateQueries) {
      logger.info(`Executing: ${query}`);
      await db.query(query);
    }
    
    // Refresh materialized views
    logger.info('Refreshing materialized views...');
    await db.query('REFRESH MATERIALIZED VIEW gnaf.address_statistics');
    
    // Get table counts to confirm
    const results = await db.query(`
      SELECT 
        'addresses' as table_name, COUNT(*) as row_count FROM gnaf.addresses
      UNION ALL
      SELECT 
        'localities' as table_name, COUNT(*) as row_count FROM gnaf.localities  
      UNION ALL
      SELECT 
        'streets' as table_name, COUNT(*) as row_count FROM gnaf.streets
      UNION ALL
      SELECT 
        'states' as table_name, COUNT(*) as row_count FROM gnaf.states
      ORDER BY table_name
    `);
    
    logger.info('Table counts after truncation:');
    results.rows.forEach(row => {
      logger.info(`  ${row.table_name}: ${row.row_count} rows`);
    });
    
    logger.info('✅ GNAF tables truncated successfully');
    
  } catch (error) {
    logger.error('❌ Error truncating tables:', error.message);
    throw error;
  } finally {
    // Don't call db.end() as it's a shared connection pool
    logger.info('Truncation completed');
  }
}

// Run truncation if called directly
if (require.main === module) {
  truncateGnafTables()
    .then(() => {
      console.log('\n🔄 Database is now clean and ready for fresh import');
      console.log('You can now run: node scripts/import-gnaf.js');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Truncation failed:', error.message);
      process.exit(1);
    });
}

module.exports = { truncateGnafTables };