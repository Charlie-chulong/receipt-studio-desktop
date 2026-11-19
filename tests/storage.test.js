import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultReceipt } from '../src/core/model.js';

let moduleIndex = 0;

async function storageWithRecords(records, t) {
  const entries = new Map(records);
  const database = {
    close() {},
    transaction() {
      const transaction = {};
      let requests = 0;
      const request = result => {
        const operation = {};
        requests += 1;
        queueMicrotask(() => {
          operation.result = result();
          operation.onsuccess?.();
          requests -= 1;
          if (!requests) queueMicrotask(() => transaction.oncomplete?.());
        });
        return operation;
      };
      transaction.objectStore = () => ({
        get: key => request(() => structuredClone(entries.get(key))),
        count: key => request(() => Number(entries.has(key))),
        put: (value, key) => request(() => { entries.set(key, structuredClone(value)); }),
      });
      return transaction;
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = database;
          request.onsuccess();
        });
        return request;
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  });
  const storage = await import(new URL(`../src/storage.js?test=${moduleIndex++}`, import.meta.url).href);
  return { storage, entries };
}

test('only an absent current key is treated as a new installation', async t => {
  await t.test('absent key', async t => {
    const { storage, entries } = await storageWithRecords([], t);
    assert.deepEqual(await storage.loadDraft(), { exists: false, value: undefined });
    assert.equal(entries.size, 0);
  });
  for (const value of [null, false, 0, '', undefined]) {
    await t.test(`present ${String(value)}`, async t => {
      const { storage, entries } = await storageWithRecords([['current', value]], t);
      assert.deepEqual(await storage.loadDraft(), { exists: true, value });
      assert.equal(entries.has('current'), true);
      assert.deepEqual(entries.get('current'), value);
    });
  }
});

test('normal autosave retains the existing current-record format and completion timestamp', async t => {
  const { storage, entries } = await storageWithRecords([], t);
  const receipt = createDefaultReceipt();
  receipt.title = '虚构自动保存草稿';
  const savedAt = await storage.saveDraft(receipt);
  assert.equal(Number.isNaN(Date.parse(savedAt)), false);
  assert.deepEqual(entries.get('current'), { receipt, savedAt });
  assert.deepEqual(await storage.loadDraft(), { exists: true, value: { receipt, savedAt } });
});
