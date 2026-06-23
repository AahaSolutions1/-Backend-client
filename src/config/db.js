import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
 
dotenv.config();
 
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cms_db',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
 
// Test connection
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database successfully.');
   
    // Ensure max_allowed_packet is high enough for base64 file uploads (prevent ECONNRESET)
    try {
      await connection.query('SET GLOBAL max_allowed_packet = 167772160');
      console.log('✅ Set GLOBAL max_allowed_packet to 160MB.');
    } catch (err) {
      console.warn('⚠️ Could not set global max_allowed_packet:', err.message);
    }
 
    // Ensure l2_attachments table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS l2_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        change_no VARCHAR(50) NOT NULL,
        field_name VARCHAR(50) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_data LONGTEXT NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (change_no) REFERENCES l2_validation_logs(change_no) ON UPDATE CASCADE ON DELETE CASCADE
      )
    `);
 
    // Ensure improvement_table_data column exists in l1_requests table
    try {
      const [columns] = await connection.query("SHOW COLUMNS FROM l1_requests LIKE 'improvement_table_data'");
      if (columns.length === 0) {
        await connection.query("ALTER TABLE l1_requests ADD COLUMN improvement_table_data LONGTEXT NULL");
        console.log('✅ Added column improvement_table_data to l1_requests table.');
      }
    } catch (err) {
      console.error('⚠️ Error adding improvement_table_data column:', err.message);
    }
 
    // Ensure l1_requests description column is LONGTEXT
    try {
      await connection.query('ALTER TABLE l1_requests MODIFY COLUMN description LONGTEXT NOT NULL');
      console.log('✅ Modified l1_requests description column to LONGTEXT.');
    } catch (err) {
      console.warn('⚠️ Could not modify l1_requests description column:', err.message);
    }
 
    // Ensure notifications table id column is VARCHAR(255)
    try {
      await connection.query('ALTER TABLE notifications MODIFY COLUMN id VARCHAR(255) NOT NULL');
      console.log('✅ Modified notifications id column to VARCHAR(255).');
    } catch (err) {
      console.warn('⚠️ Could not modify notifications id column:', err.message);
    }
 
    // Ensure notifications table recipient_email column exists
    try {
      const [columns] = await connection.query("SHOW COLUMNS FROM notifications LIKE 'recipient_email'");
      if (columns.length === 0) {
        await connection.query("ALTER TABLE notifications ADD COLUMN recipient_email VARCHAR(255) NULL");
        console.log('✅ Added column recipient_email to notifications table.');
      }
    } catch (err) {
      console.warn('⚠️ Could not add recipient_email column to notifications table:', err.message);
    }
 
    // Ensure file columns are TEXT to handle multiple uploads
    try {
      await connection.query('ALTER TABLE l2_validation_logs MODIFY COLUMN weld_test TEXT NOT NULL');
      await connection.query('ALTER TABLE l2_validation_logs MODIFY COLUMN qa_test TEXT NOT NULL');
      await connection.query('ALTER TABLE l1_requests MODIFY COLUMN file_desc TEXT NOT NULL');
      await connection.query('ALTER TABLE l1_requests MODIFY COLUMN file_improvement TEXT NOT NULL');
      await connection.query('ALTER TABLE l1_requests MODIFY COLUMN file_trace_from TEXT NOT NULL');
      await connection.query('ALTER TABLE l1_requests MODIFY COLUMN file_trace_to TEXT NOT NULL');
      await connection.query('ALTER TABLE l1_requests MODIFY COLUMN file_risk TEXT NOT NULL');
      await connection.query('ALTER TABLE l1_requests MODIFY COLUMN file_sop TEXT NOT NULL');
      await connection.query('ALTER TABLE l1_requests MODIFY COLUMN file_effectiveness TEXT NOT NULL');
      await connection.query('ALTER TABLE effectiveness_logs MODIFY COLUMN attachment TEXT NOT NULL');
      console.log('✅ Modified file columns to TEXT for multiple uploads.');
    } catch (err) {
      console.warn('⚠️ Could not modify file columns to TEXT:', err.message);
    }
 
    // Ensure standard departments exist in departments table
    try {
      const depts = [
        'General', 'PED', 'QAD', 'Production', 'Maintenance',
        'PC & L', 'Materials', 'Marketing', 'HR', 'Safety', 'Unit Head'
      ];
      for (const d of depts) {
        await connection.query(
          'INSERT IGNORE INTO departments (name) VALUES (?)',
          [d]
        );
      }
      console.log('✅ Ensured standard departments are seeded in departments table.');
    } catch (err) {
      console.warn('⚠️ Error seeding standard departments:', err.message);
    }
 
    // Ensure standard processes exist in processes table
    try {
      const procs = ['Wind', 'Gold', 'EOL', 'Pott', 'Load'];
      for (const p of procs) {
        await connection.query(
          'INSERT IGNORE INTO processes (name) VALUES (?)',
          [p]
        );
      }
      console.log('✅ Ensured standard processes are seeded in processes table.');
    } catch (err) {
      console.warn('⚠️ Error seeding standard processes:', err.message);
    }
 
    connection.release();
  } catch (error) {
    console.error('❌ Error connecting to MySQL database:', error.message);
  }
})();
 
export default pool;