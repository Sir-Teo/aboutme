// A tiny promise wrapper over IndexedDB — the playground's local persistence
// layer. Everything stays on the user's device: embedding caches, long-term
// memories, conversation threads. No dependency; one database, a few stores.

const DB_NAME = 'teo-playground'
const DB_VERSION = 1

// Stores are declared up front so the upgrade path stays stable as features land.
export type StoreName = 'kv' | 'vectors' | 'memories' | 'threads'
const STORES: StoreName[] = ['kv', 'vectors', 'memories', 'threads']

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is unavailable'))
            return
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
            const db = request.result
            for (const store of STORES) {
                if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    })
    return dbPromise
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return openDB().then(
        db =>
            new Promise<T>((resolve, reject) => {
                const transaction = db.transaction(store, mode)
                const request = run(transaction.objectStore(store))
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
            })
    )
}

export function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
    return tx<T | undefined>(store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>)
}

export function idbSet<T>(store: StoreName, key: string, value: T): Promise<void> {
    return tx(store, 'readwrite', s => s.put(value as any, key)).then(() => undefined)
}

export function idbDelete(store: StoreName, key: string): Promise<void> {
    return tx(store, 'readwrite', s => s.delete(key)).then(() => undefined)
}

export function idbClear(store: StoreName): Promise<void> {
    return tx(store, 'readwrite', s => s.clear()).then(() => undefined)
}

export function idbKeys(store: StoreName): Promise<string[]> {
    return tx<IDBValidKey[]>(store, 'readonly', s => s.getAllKeys() as IDBRequest<IDBValidKey[]>).then(keys =>
        keys.map(String)
    )
}

export function idbValues<T>(store: StoreName): Promise<T[]> {
    return tx<T[]>(store, 'readonly', s => s.getAll() as IDBRequest<T[]>)
}
