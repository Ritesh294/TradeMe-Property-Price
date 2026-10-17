const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const csv = require('fast-csv');

const dataDirectory = path.join(__dirname, '..', 'data');
const databasePath = path.join(dataDirectory, 'property-cache.sqlite');
const legacyCsvPath = path.join(__dirname, '..', 'data.csv');
const migrationId = 'legacy-csv-v1';

let database;
const databaseReady = initializeDatabase();

async function initializeDatabase() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const SQL = await initSqlJs();
  database = fs.existsSync(databasePath)
    ? new SQL.Database(fs.readFileSync(databasePath))
    : new SQL.Database();

  database.run(`
    CREATE TABLE IF NOT EXISTS property_cache (
      listing_id TEXT NOT NULL,
      resolution TEXT NOT NULL,
      price INTEGER NOT NULL,
      address TEXT NOT NULL,
      PRIMARY KEY (listing_id, resolution)
    );
    CREATE TABLE IF NOT EXISTS cache_migrations (
      migration_id TEXT PRIMARY KEY
    );
  `);

  const migration = database.exec(
    `SELECT 1 FROM cache_migrations WHERE migration_id = '${migrationId}'`
  );
  if (migration.length === 0) {
    database.run('BEGIN TRANSACTION');
    try {
      if (fs.existsSync(legacyCsvPath)) {
        await importLegacyCsv();
      }
      database.run('INSERT INTO cache_migrations (migration_id) VALUES (?)', [migrationId]);
      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    }
    persistDatabase();
  }
}

function importLegacyCsv() {
  return new Promise((resolve, reject) => {
    const insert = database.prepare(
      'INSERT OR IGNORE INTO property_cache (listing_id, price, resolution, address) VALUES (?, ?, ?, ?)'
    );
    let rowNumber = 1;
    let settled = false;
    const parser = csv.parseFile(legacyCsvPath, {
      headers: true,
      ignoreEmpty: true,
      trim: true
    });

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      insert.free();
      reject(error);
    };

    parser
      .on('error', fail)
      .on('data', (row) => {
        if (settled) {
          return;
        }
        rowNumber += 1;
        const price = Number(row.PRICE);
        try {
          if (!row.LISTING || !row.RES || !row.ADDRESS || !Number.isSafeInteger(price)) {
            throw new Error(`Invalid cache entry in data.csv at row ${rowNumber}`);
          }
          insert.run([row.LISTING, price, row.RES, row.ADDRESS]);
        } catch (error) {
          parser.destroy(error);
        }
      })
      .on('end', () => {
        if (settled) {
          return;
        }
        settled = true;
        insert.free();
        resolve();
      });
  });
}

function persistDatabase() {
  const temporaryPath = `${databasePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, Buffer.from(database.export()));
  fs.renameSync(temporaryPath, databasePath);
}

async function findExisting(propertyID, resolution) {
  await databaseReady;
  const statement = database.prepare(
    'SELECT price, address FROM property_cache WHERE listing_id = ? AND resolution = ?'
  );
  try {
    statement.bind([propertyID, resolution]);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
}

async function addExisting(propertyID, price, resolution, address) {
  await databaseReady;
  database.run(
    `INSERT INTO property_cache (listing_id, price, resolution, address)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (listing_id, resolution) DO UPDATE SET
       price = excluded.price,
       address = excluded.address`,
    [propertyID, price, resolution, address]
  );
  persistDatabase();
}

module.exports = {
  findExisting,
  addExisting
};
