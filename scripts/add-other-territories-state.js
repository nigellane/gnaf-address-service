/**
 * Add Other Territories (OT) state to the database
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

async function addOtherTerritoriesState() {
  const db = getDatabase();
  
  try {
    logger.info('Adding Other Territories (OT) state to database...');
    
    // Check if OT already exists
    const existingResult = await db.query(
      'SELECT state_code FROM gnaf.states WHERE state_code = $1',
      ['OT']
    );
    
    if (existingResult.rows.length > 0) {
      logger.info('OT state already exists');
      return;
    }
    
    // Insert OT state
    await db.query(
      `INSERT INTO gnaf.states (state_code, state_name) VALUES ($1, $2)`,
      ['OT', 'Other Territories']
    );
    
    logger.info('✅ Other Territories (OT) state added successfully');
    
    // Show all states
    const allStates = await db.query('SELECT state_code, state_name FROM gnaf.states ORDER BY state_code');
    logger.info('Current states in database:');
    allStates.rows.forEach(row => {
      logger.info(`  ${row.state_code}: ${row.state_name}`);
    });
    
  } catch (error) {
    logger.error('❌ Error adding OT state:', error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  addOtherTerritoriesState()
    .then(() => {
      console.log('\n🔄 Database updated - you can now run the import again');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Failed to add OT state:', error.message);
      process.exit(1);
    });
}

module.exports = { addOtherTerritoriesState };