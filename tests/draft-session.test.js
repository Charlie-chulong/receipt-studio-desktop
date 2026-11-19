import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultReceipt, validateReceipt } from '../src/core/model.js';
import { DraftSession } from '../src/draft-session.js';

function design(title = '虚构草稿A') {
  const receipt = createDefaultReceipt();
  receipt.title = title;
  receipt.items = [{ id: 'fictional-item', name: '虚构服务', amount: '100.00' }];
  return receipt;
}
function saved(receipt = design()) {
  return { exists: true, value: { receipt, savedAt: '2026-01-01T00:00:00.000Z' } };
}
function file(value = design('虚构草稿B')) {
  const json = JSON.stringify(value);
  return { name: 'fictional-design.json', size: Buffer.byteLength(json), text: async () => json };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function workspace(record = { exists: false }, validateAssets = async () => {}) {
  const state = { record: structuredClone(record), writes: [] };
  const storage = {
    load: async () => structuredClone(state.record),
    save: async receipt => {
      const savedAt = '2026-01-02T00:00:00.000Z';
      state.record = saved(structuredClone(receipt));
      state.record.value.savedAt = savedAt;
      state.writes.push(structuredClone(state.record.value));
      return savedAt;
    },
  };
  return { session: new DraftSession(storage, validateAssets), storage, state };
}

test('new installation stays unwritten until editing and normal autosave remains usable', async () => {
  const { session, state } = workspace();
  assert.equal(session.blocked, true);
  await assert.rejects(session.save(design()), /尚未恢复/);
  assert.equal(await session.recover(), null);
  assert.equal(session.blocked, false);
  assert.equal(session.hasDraft, false);
  assert.deepEqual(state.record, { exists: false });
  const pending = await session.readImport(file(), 1, () => 1, false);
  assert.equal(pending.needsConfirmation, false);
  const imported = session.acceptImport(pending, 1);
  assert.equal(imported.title, '虚构草稿B');
  assert.equal(state.writes.length, 0);
  await session.save(imported);
  assert.equal(state.record.value.receipt.title, '虚构草稿B');
  assert.equal(session.hasDraft, true);
  assert.throws(() => session.acceptImport(pending, 1), /未替换/);
});

test('saved draft requires confirmation; cancel preserves A and explicit replacement can save B', async () => {
  const original = saved();
  const { session, state } = workspace(original);
  const restored = await session.recover();
  assert.deepEqual(restored.receipt, validateReceipt(original.value.receipt));
  assert.equal(restored.savedAt, original.value.savedAt);
  const canceled = await session.readImport(file(), 7, () => 7, false);
  assert.equal(canceled.needsConfirmation, true);
  assert.deepEqual(state.record, original);
  assert.equal(state.writes.length, 0);
  session.cancelImport();
  assert.throws(() => session.acceptImport(canceled, 7), /未替换/);
  assert.deepEqual(state.record, original);
  const confirmed = await session.readImport(file(), 7, () => 7, false);
  const replacement = session.acceptImport(confirmed, 7);
  assert.deepEqual(state.record, original);
  await session.save(replacement);
  assert.equal(state.record.value.receipt.title, '虚构草稿B');
  assert.equal(state.writes.length, 1);
});

test('an edited but not yet autosaved draft also requires replacement confirmation', async () => {
  const { session, state } = workspace();
  await session.recover();
  const pending = await session.readImport(file(), 2, () => 2, true);
  assert.equal(pending.needsConfirmation, true);
  session.cancelImport();
  assert.deepEqual(state.record, { exists: false });
  assert.equal(state.writes.length, 0);
});

test('edits during file reading reject import before it can replace the current draft', async () => {
  const original = saved();
  const { session, state } = workspace(original);
  await session.recover();
  const text = deferred();
  let revision = 3;
  const pending = session.readImport({ size: 100, text: () => text.promise }, revision, () => revision, true);
  revision += 1;
  text.resolve(JSON.stringify(design('虚构草稿B')));
  await assert.rejects(pending, /读取或确认期间.*未替换/);
  assert.deepEqual(state.record, original);
  assert.equal(state.writes.length, 0);
});

test('edits during asynchronous image validation also invalidate import', async () => {
  const decoding = deferred();
  const started = deferred();
  const original = saved();
  const { session, state } = workspace(original, async receipt => {
    if (receipt.title === '虚构草稿B') {
      started.resolve();
      await decoding.promise;
    }
  });
  await session.recover();
  let revision = 4;
  const pending = session.readImport(file(), revision, () => revision, true);
  await started.promise;
  revision += 1;
  decoding.resolve();
  await assert.rejects(pending, /未替换/);
  assert.deepEqual(state.record, original);
  assert.equal(state.writes.length, 0);
});

test('edits while replacement confirmation is open reject the affirmative action', async () => {
  const original = saved();
  const { session, state } = workspace(original);
  await session.recover();
  const pending = await session.readImport(file(), 9, () => 9, true);
  assert.equal(pending.needsConfirmation, true);
  assert.throws(() => session.acceptImport(pending, 10), /读取或确认期间.*未替换/);
  assert.deepEqual(state.record, original);
  assert.equal(state.writes.length, 0);
});

test('a later file selection supersedes an earlier asynchronous read', async () => {
  const { session } = workspace(saved());
  await session.recover();
  const text = deferred();
  const earlier = session.readImport({ size: 100, text: () => text.promise }, 2, () => 2, false);
  const later = await session.readImport(file(design('虚构草稿C')), 2, () => 2, false);
  text.resolve(JSON.stringify(design('虚构草稿B')));
  await assert.rejects(earlier, /未替换/);
  assert.equal(session.acceptImport(later, 2).title, '虚构草稿C');
});

test('invalid JSON, invalid fees, oversized files and damaged assets leave A untouched', async () => {
  const original = saved();
  const { session, state } = workspace(original, async receipt => {
    if (receipt.logo) throw new Error('图片无法解码');
  });
  await session.recover();
  await assert.rejects(session.readImport({ size: 1, text: async () => '{' }, 1, () => 1, false), SyntaxError);
  await assert.rejects(session.readImport(file({ version: 2 }), 1, () => 1, false), /版本/);
  const badFee = design('虚构草稿B');
  badFee.fees.couponAmount = '100.01';
  await assert.rejects(session.readImport(file(badFee), 1, () => 1, false), /优惠/);
  const badImage = design('虚构草稿B');
  badImage.logo = 'data:image/png;base64,AAAA';
  await assert.rejects(session.readImport(file(badImage), 1, () => 1, false), /图片无法解码/);
  await assert.rejects(session.readImport({ size: 66 * 1024 * 1024 + 1, text: () => assert.fail('must not read oversized file') }, 1, () => 1, false), /66MB/);
  assert.deepEqual(state.record, original);
  assert.equal(state.writes.length, 0);
});

test('damaged restored artwork protects raw current across backup, edits, import and reopening', async () => {
  const broken = design();
  broken.logo = 'data:image/png;base64,AAAA';
  const original = saved(broken);
  original.value.originalMetadata = '原始记录应完整保留';
  const validateAssets = async () => { throw new Error('图片无法解码'); };
  const { session, storage, state } = workspace(original, validateAssets);
  await assert.rejects(session.recover(), /图片无法解码/);
  assert.equal(session.blocked, true);
  await assert.rejects(session.save(design('不应覆盖')), /尚未恢复/);
  await assert.rejects(session.readImport(file(), 1, () => 1, true), /尚未恢复/);
  assert.deepEqual(JSON.parse(await session.recoveryBackup()), original.value);
  assert.equal(session.blocked, true);
  assert.deepEqual(state.record, original);
  assert.equal(state.writes.length, 0);
  const reopened = new DraftSession(storage, validateAssets);
  await assert.rejects(reopened.recover(), /图片无法解码/);
  await assert.rejects(reopened.save(createDefaultReceipt()), /尚未恢复/);
  assert.deepEqual(JSON.parse(await reopened.recoveryBackup()), original.value);
  assert.deepEqual(state.record, original);
  reopened.discardRecovery();
  assert.equal(reopened.blocked, false);
  await reopened.save(createDefaultReceipt());
  assert.deepEqual(state.record.value.receipt, createDefaultReceipt());
  assert.equal(state.writes.length, 1);
});

test('retrying recovery can restore the original draft without writing or discarding it', async () => {
  let decodeFails = true;
  const original = saved();
  const { session, state } = workspace(original, async () => {
    if (decodeFails) throw new Error('素材读取失败');
  });
  await assert.rejects(session.recover(), /素材读取失败/);
  decodeFails = false;
  const restored = await session.recover();
  assert.equal(restored.receipt.title, '虚构草稿A');
  assert.equal(session.blocked, false);
  assert.deepEqual(state.record, original);
  assert.equal(state.writes.length, 0);
});

test('read failures remain protected and backup can retrieve the record without unlocking edits', async () => {
  const original = saved();
  const { session, storage, state } = workspace(original);
  const read = storage.load;
  storage.load = async () => { throw new Error('本机数据库无法读取'); };
  await assert.rejects(session.recover(), /无法读取/);
  await assert.rejects(session.recoveryBackup(), /无法读取/);
  await assert.rejects(session.save(design()), /尚未恢复/);
  storage.load = read;
  assert.deepEqual(JSON.parse(await session.recoveryBackup()), original.value);
  assert.equal(session.blocked, true);
  storage.load = async () => { throw new Error('再次读取失败'); };
  await assert.rejects(session.recover(), /再次读取失败/);
  assert.deepEqual(JSON.parse(await session.recoveryBackup()), original.value);
  assert.deepEqual(state.record, original);
  assert.equal(state.writes.length, 0);
});

test('present but malformed or falsy records are not mistaken for a new installation', async () => {
  for (const value of [null, false, 0, '', undefined, {}, { receipt: { version: 2 } }]) {
    const original = { exists: true, value };
    const { session, state } = workspace(original);
    await assert.rejects(session.recover(), /小票|版本/);
    assert.equal(session.blocked, true);
    await assert.rejects(session.save(createDefaultReceipt()), /尚未恢复/);
    assert.deepEqual(state.record, original);
    assert.equal(state.writes.length, 0);
  }
});

test('repaired raw-record backups can be imported through the normal confirmation flow', async () => {
  const { session } = workspace(saved());
  await session.recover();
  const rawBackup = saved(design('修复后的虚构草稿')).value;
  const pending = await session.readImport(file(rawBackup), 5, () => 5, false);
  assert.equal(pending.needsConfirmation, true);
  assert.equal(session.acceptImport(pending, 5).title, '修复后的虚构草稿');
});

test('autosave errors propagate and do not disable ordinary backup or a subsequent save', async () => {
  const { session, storage, state } = workspace();
  await session.recover();
  const save = storage.save;
  storage.save = async () => { throw new Error('本机空间不足'); };
  await assert.rejects(session.save(design()), /空间不足/);
  assert.equal(session.blocked, false);
  assert.equal(state.writes.length, 0);
  storage.save = save;
  await session.save(design());
  assert.equal(state.record.value.receipt.title, '虚构草稿A');
});
