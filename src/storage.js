const DATABASE = 'receipt-studio-offline';
const STORE = 'drafts';
const KEY = 'current';
let databasePromise;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(request.error || new Error('无法打开本机草稿数据库'));
      request.onblocked = () => reject(new Error('草稿数据库被另一窗口占用，请关闭旧窗口后重试'));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

export async function loadDraft() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(KEY);
    let result = null;
    request.onsuccess = () => { result = request.result || null; };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new Error('读取草稿失败'));
    transaction.onerror = () => reject(transaction.error || new Error('读取草稿失败'));
  });
}

export async function saveDraft(receipt) {
  const database = await openDatabase();
  const savedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put({ receipt, savedAt }, KEY);
    transaction.oncomplete = () => resolve(savedAt);
    transaction.onabort = () => reject(transaction.error || new Error('自动保存失败，可能是本机存储空间不足'));
    transaction.onerror = () => reject(transaction.error || new Error('自动保存失败'));
  });
}
