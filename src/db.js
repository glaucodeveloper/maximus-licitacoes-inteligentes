import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import {SCHEMA_SQL, SEED_SQL} from './schema.js';

const DB_NAME = 'maximus-licitacoes-storage';
const STORE = 'files';
const KEY = 'licitacoes.sqlite';
let SQL = null;
let database = null;
let saveTimer = null;

function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readBytes() {
  const storage = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = storage.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeBytes(bytes) {
  const storage = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = storage.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function initDatabase() {
  if (database) return database;
  SQL ||= await initSqlJs({locateFile: () => sqlWasmUrl});
  const bytes = await readBytes();
  database = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  database.run(SCHEMA_SQL);
  database.run(SEED_SQL);
  await persistDatabase();
  return database;
}

export async function persistDatabase() {
  if (!database) return;
  await writeBytes(database.export());
}

export function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persistDatabase(), 120);
}

export function rows(sql, params = []) {
  if (!database) throw new Error('Banco local não inicializado.');
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    const result = [];
    while (stmt.step()) result.push(stmt.getAsObject());
    return result;
  } finally {
    stmt.free();
  }
}

export function one(sql, params = []) {
  return rows(sql, params)[0] || null;
}

export function run(sql, params = []) {
  if (!database) throw new Error('Banco local não inicializado.');
  database.run(sql, params);
  const id = one('SELECT last_insert_rowid() AS id')?.id || 0;
  schedulePersist();
  return Number(id);
}

export function transaction(callback) {
  database.run('BEGIN');
  try {
    const result = callback();
    database.run('COMMIT');
    schedulePersist();
    return result;
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

export async function exportDatabase() {
  await persistDatabase();
  return new Blob([database.export()], {type: 'application/vnd.sqlite3'});
}

export async function importDatabase(file) {
  SQL ||= await initSqlJs({locateFile: () => sqlWasmUrl});
  const bytes = new Uint8Array(await file.arrayBuffer());
  const candidate = new SQL.Database(bytes);
  candidate.exec('SELECT name FROM sqlite_master LIMIT 1');
  database?.close();
  database = candidate;
  database.run(SCHEMA_SQL);
  await persistDatabase();
}
