// 監査ログのBefore/After差分ロジックのテスト
import assert from "node:assert/strict";
import { test } from "node:test";

import { AUDIT_ACTION_LABELS, buildAuditDiff } from "../src/lib/auditDiff.js";

test("buildAuditDiff: 変更キーの検出（changed=true）と全キーの列挙", () => {
  const rows = buildAuditDiff(
    { status: "Draft", version: "0.1", note: "same" },
    { status: "Candidate", version: "0.1", note: "same", added: 1 }
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.status.changed, true);
  assert.equal(byKey.status.before, "Draft");
  assert.equal(byKey.status.after, "Candidate");
  assert.equal(byKey.version.changed, false);
  assert.equal(byKey.added.changed, true);
  assert.equal(byKey.added.before, "");
  assert.equal(rows.length, 4);
});

test("buildAuditDiff: 片側のみ・両方なし・ネスト値のJSON表示", () => {
  assert.deepEqual(buildAuditDiff(null, null), []);
  const onlyAfter = buildAuditDiff(null, { deleted: true });
  assert.equal(onlyAfter[0].key, "deleted");
  assert.equal(onlyAfter[0].after, "true");
  const nested = buildAuditDiff({ policy: { max_cer: 0.1 } }, { policy: { max_cer: 0.05 } });
  assert.equal(nested[0].changed, true);
  assert.ok(nested[0].before.includes("0.1") && nested[0].after.includes("0.05"));
});

test("監査アクションの日本語ラベル（基本13種＋Phase 5の2種=15種）", () => {
  assert.equal(Object.keys(AUDIT_ACTION_LABELS).length, 15);
  assert.equal(AUDIT_ACTION_LABELS.release_promote, "Production昇格");
  assert.equal(AUDIT_ACTION_LABELS.backup_restore, "バックアップ復元");
});
