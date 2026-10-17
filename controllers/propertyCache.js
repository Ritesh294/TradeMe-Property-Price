const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const dataDirectory = path.join(__dirname, '..', 'data');
const databasePath = path.join(dataDirectory, 'property-cache.sqlite');

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
  `);
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
