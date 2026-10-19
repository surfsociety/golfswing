// Verlauf in IndexedDB. Gespeichert werden Messwerte und ein Standbild, keine Videos.

const DB_NAME = 'golf-swing';
const STORE = 'swings';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export function put(entry) { return tx('readwrite', s => s.put(entry)); }
export function remove(id) { return tx('readwrite', s => s.delete(id)); }
export async function all() {
  const list = await tx('readonly', s => s.getAll());
  return (list || []).sort((a, b) => b.date.localeCompare(a.date));
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* optional */ }
}
