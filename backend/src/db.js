const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zentra_db',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: '-05:00', // Lima UTC-5
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('[DB] Conexión MySQL exitosa');
    conn.release();
  } catch (err) {
    console.error('[DB] Error de conexión:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection };
