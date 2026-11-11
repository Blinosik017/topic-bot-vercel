require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../db');

async function main() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.log('No migration files found.');
    return;
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.query(sql);
    console.log(`Applied: ${file}`);
  }

  console.log('Database schema is up to date.');
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
