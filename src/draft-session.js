import { validateReceipt } from './core/model.js';
import { calculateReceipt } from './core/money.js';

const MAX_DESIGN = 66 * 1024 * 1024;

function receiptFromDesign(value) {
  // Recovery backups retain the original IndexedDB record, including savedAt.
  const isBackup = value && typeof value === 'object' && !Array.isArray(value)
    && !Object.hasOwn(value, 'version') && Object.hasOwn(value, 'receipt') && Object.hasOwn(value, 'savedAt');
  return validateReceipt(isBackup ? value.receipt : value);
}

export class DraftSession {
  #storage;
  #validateAssets;
  #blocked = true;
  #hasDraft = false;
  #recoveryRecord;
  #importGeneration = 0;

  constructor(storage, validateAssets) {
    this.#storage = storage;
    this.#validateAssets = validateAssets;
  }

  get blocked() { return this.#blocked; }
  get hasDraft() { return this.#hasDraft; }

  async recover() {
    this.#blocked = true;
    this.cancelImport();
    const stored = await this.#storage.load();
    this.#recoveryRecord = stored;
    if (!stored.exists) {
      this.#hasDraft = false;
      this.#blocked = false;
      this.#recoveryRecord = undefined;
      return null;
    }
    const normalized = validateReceipt(stored.value?.receipt);
    calculateReceipt(normalized);
    await this.#validateAssets(normalized);
    this.#hasDraft = true;
    this.#blocked = false;
    this.#recoveryRecord = undefined;
    return { receipt: normalized, savedAt: stored.value.savedAt };
  }

  discardRecovery() {
    if (!this.#blocked) throw new Error('当前没有待处理的恢复失败草稿');
    this.cancelImport();
    this.#hasDraft = false;
    this.#blocked = false;
    this.#recoveryRecord = undefined;
  }

  async recoveryBackup() {
    if (!this.#blocked) throw new Error('当前没有待处理的恢复失败草稿');
    const stored = this.#recoveryRecord ?? await this.#storage.load();
    this.#recoveryRecord = stored;
    if (!stored.exists) throw new Error('未找到原始草稿，请先重试恢复');
    const json = JSON.stringify(stored.value, null, 2);
    if (json === undefined) throw new Error('原始草稿无法转换为 JSON，原存储仍保留');
    return json;
  }

  async save(receipt) {
    this.#requireEditable();
    const savedAt = await this.#storage.save(receipt);
    this.#hasDraft = true;
    return savedAt;
  }

  async readImport(file, revision, getRevision, hasEdits) {
    this.#requireEditable();
    const pending = { generation: ++this.#importGeneration, revision };
    if (file.size > MAX_DESIGN) throw new Error('设计文件超过 66MB 上限');
    const normalized = receiptFromDesign(JSON.parse(await file.text()));
    calculateReceipt(normalized);
    await this.#validateAssets(normalized);
    this.#requireCurrentImport(pending, getRevision());
    return { ...pending, receipt: normalized, needsConfirmation: this.#hasDraft || hasEdits };
  }

  acceptImport(pending, revision) {
    this.#requireCurrentImport(pending, revision);
    this.cancelImport();
    return pending.receipt;
  }

  cancelImport() { this.#importGeneration += 1; }

  #requireEditable() {
    if (this.#blocked) throw new Error('本机草稿尚未恢复，请先恢复或明确放弃原草稿');
  }

  #requireCurrentImport(pending, revision) {
    this.#requireEditable();
    if (pending.generation !== this.#importGeneration || pending.revision !== revision) {
      throw new Error('读取或确认期间当前设计发生变化，未替换；请重新选择文件');
    }
  }
}
