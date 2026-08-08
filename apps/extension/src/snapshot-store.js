import { CONTEXT_VAULT_STORES, openContextVaultDatabase } from "./db-schema.js";
import {
  BACKUP_LEASE_ID,
  DEFAULT_SCHEDULE_SETTINGS,
  SCHEDULE_RUNTIME_ID,
  SCHEDULE_SETTINGS_ID,
  SCHEDULE_TEST_RUNTIME_ID,
  createScheduleRuntime,
  createScheduleTestRuntime,
  normalizeScheduleSettings,
} from "./scheduler-core.js";

const SNAPSHOTS = CONTEXT_VAULT_STORES.snapshots;
const SCHEDULER = CONTEXT_VAULT_STORES.scheduler;
const RUNS = CONTEXT_VAULT_STORES.schedulerRuns;
const OBJECTS = CONTEXT_VAULT_STORES.contentObjects;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地数据库操作失败"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("本地数据库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本地数据库事务已取消"));
  });
}

export function createIndexedDbSnapshotStore() {
  return {
    async getSettings() {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readonly");
        const value = await requestResult(tx.objectStore(SCHEDULER).get(SCHEDULE_SETTINGS_ID));
        return normalizeScheduleSettings(value ?? DEFAULT_SCHEDULE_SETTINGS);
      } finally { db.close(); }
    },
    async saveSettings(settings) {
      const value = normalizeScheduleSettings({ ...settings, updatedAt: new Date().toISOString() });
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readwrite");
        tx.objectStore(SCHEDULER).put(value);
        await transactionDone(tx);
        return value;
      } finally { db.close(); }
    },
    async getRuntime() {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readonly");
        return createScheduleRuntime(await requestResult(tx.objectStore(SCHEDULER).get(SCHEDULE_RUNTIME_ID)) ?? {});
      } finally { db.close(); }
    },
    async saveRuntime(runtime) {
      const value = createScheduleRuntime({ ...runtime, updatedAt: new Date().toISOString() });
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readwrite");
        tx.objectStore(SCHEDULER).put(value);
        await transactionDone(tx);
        return value;
      } finally { db.close(); }
    },
    async getTestRuntime() {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readonly");
        return createScheduleTestRuntime(await requestResult(tx.objectStore(SCHEDULER).get(SCHEDULE_TEST_RUNTIME_ID)) ?? {});
      } finally { db.close(); }
    },
    async saveTestRuntime(runtime) {
      const value = createScheduleTestRuntime({ ...runtime, updatedAt: new Date().toISOString() });
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readwrite");
        tx.objectStore(SCHEDULER).put(value);
        await transactionDone(tx);
        return value;
      } finally { db.close(); }
    },
    async acquireLease(owner, ttlMs = 10 * 60_000, now = Date.now()) {
      const token = `${owner}:${crypto.randomUUID?.() ?? `${now}-${Math.random().toString(16).slice(2)}`}`;
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readwrite");
        const store = tx.objectStore(SCHEDULER);
        const acquired = await new Promise((resolve, reject) => {
          const request = store.get(BACKUP_LEASE_ID);
          request.onerror = () => reject(request.error ?? new Error("无法读取备份执行锁"));
          request.onsuccess = () => {
            const current = request.result;
            if (current && Number(current.expiresAt ?? 0) > Number(now) && current.owner !== owner) {
              resolve(false);
              return;
            }
            store.put({ id: BACKUP_LEASE_ID, owner, token, acquiredAt: new Date(now).toISOString(), expiresAt: Number(now) + ttlMs });
            resolve(true);
          };
        });
        await transactionDone(tx);
        return acquired ? { owner, token, expiresAt: Number(now) + ttlMs } : null;
      } finally { db.close(); }
    },
    async renewLease(lease, ttlMs = 10 * 60_000, now = Date.now()) {
      if (!lease?.token) return false;
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readwrite");
        const store = tx.objectStore(SCHEDULER);
        const renewed = await new Promise((resolve, reject) => {
          const request = store.get(BACKUP_LEASE_ID);
          request.onerror = () => reject(request.error ?? new Error("无法读取备份执行锁"));
          request.onsuccess = () => {
            const current = request.result;
            if (!current || current.token !== lease.token) return resolve(false);
            store.put({ ...current, expiresAt: Number(now) + ttlMs, renewedAt: new Date(now).toISOString() });
            resolve(true);
          };
        });
        await transactionDone(tx);
        return renewed;
      } finally { db.close(); }
    },
    async releaseLease(lease) {
      if (!lease?.token) return false;
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SCHEDULER, "readwrite");
        const store = tx.objectStore(SCHEDULER);
        const released = await new Promise((resolve, reject) => {
          const request = store.get(BACKUP_LEASE_ID);
          request.onerror = () => reject(request.error ?? new Error("无法读取备份执行锁"));
          request.onsuccess = () => {
            if (request.result?.token !== lease.token) return resolve(false);
            store.delete(BACKUP_LEASE_ID);
            resolve(true);
          };
        });
        await transactionDone(tx);
        return released;
      } finally { db.close(); }
    },
    async saveSnapshot(snapshot) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SNAPSHOTS, "readwrite");
        tx.objectStore(SNAPSHOTS).put(snapshot);
        await transactionDone(tx);
        return snapshot;
      } finally { db.close(); }
    },
    async getSnapshot(id) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SNAPSHOTS, "readonly");
        return (await requestResult(tx.objectStore(SNAPSHOTS).get(id))) ?? null;
      } finally { db.close(); }
    },
    async listSnapshots({ jobId = null, accountKey = null } = {}) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SNAPSHOTS, "readonly");
        let rows;
        if (jobId) rows = await requestResult(tx.objectStore(SNAPSHOTS).index("jobId").getAll(IDBKeyRange.only(jobId)));
        else if (accountKey) rows = await requestResult(tx.objectStore(SNAPSHOTS).index("accountKey").getAll(IDBKeyRange.only(accountKey)));
        else rows = await requestResult(tx.objectStore(SNAPSHOTS).getAll());
        if (jobId && accountKey) rows = rows.filter((row) => row.accountKey === accountKey);
        return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      } finally { db.close(); }
    },
    async deleteSnapshot(id) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(SNAPSHOTS, "readwrite");
        tx.objectStore(SNAPSHOTS).delete(id);
        await transactionDone(tx);
      } finally { db.close(); }
    },
    async recordRun(run) {
      const value = { ...run, id: run.id || `run-${Date.now()}-${Math.random().toString(16).slice(2)}` };
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(RUNS, "readwrite");
        tx.objectStore(RUNS).put(value);
        await transactionDone(tx);
        return value;
      } finally { db.close(); }
    },
    async listRuns(limit = 20) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(RUNS, "readonly");
        const rows = await requestResult(tx.objectStore(RUNS).getAll());
        return rows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, limit);
      } finally { db.close(); }
    },
    async listContentObjectMetadata() {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(OBJECTS, "readonly");
        const metadata = [];
        await new Promise((resolve, reject) => {
          const request = tx.objectStore(OBJECTS).openCursor();
          request.onerror = () => reject(request.error ?? new Error("无法遍历内容对象"));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { resolve(); return; }
            const { payload: _payload, ...row } = cursor.value ?? {};
            metadata.push(row);
            cursor.continue();
          };
        });
        return metadata;
      } finally { db.close(); }
    },
    async deleteContentObject(key) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(OBJECTS, "readwrite");
        tx.objectStore(OBJECTS).delete(key);
        await transactionDone(tx);
      } finally { db.close(); }
    },
  };
}
