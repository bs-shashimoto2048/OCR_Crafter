# バックアップ・復元ガイド（v1.0.0）

OCR Crafterのバックアップ機能（`services/backup_manager.py`）の利用手順です。障害タイプ別の復旧フローは [25_DISASTER_RECOVERY.md](25_DISASTER_RECOVERY.md) を参照してください。

## 1. バックアップ種別

| 種別 | 対象データ | 対象外データ | 用途 |
|---|---|---|---|
| `metadata_only` | ラベル（annotations）・実験/リリース/Benchmark記録・前処理設定/スナップショットmeta・モデルメタJSON | 画像（raw/interim/processed）・モデル実体・outputs | 日次の軽量バックアップ（作業記録の保全） |
| `full` | プロジェクトディレクトリ全体 | （なし） | 週次の完全バックアップ（全損対策） |

## 2. 推奨頻度

```text
metadata_only：毎日
full：毎週
```

- スケジュール実行はOSのタスクスケジューラ等で `POST /api/backups` を呼び出して構成します（アプリ内蔵のスケジューラはありません）。構成例: [24_DEPLOYMENT_GUIDE.md](24_DEPLOYMENT_GUIDE.md)

## 3. 保存先とファイル

- 保存先: `data/backups/`
- ファイル名: `<BK-0001>_<project_id>_<mode>_<日時>.zip`（BK-0001形式で採番）＋ `index.json`（一覧・採番）
- 各ZIPに `backup_manifest.json`（**Manifest v2**）を同梱: Backup ID / 作成日時 / App Version / Schema Version / Project ID / モード / **File List（path・size・SHA-256）** / 必須・任意コンポーネント

## 4. 作成方法

- **画面**: 「運用 > システム状態」の「バックアップ」カード → プロジェクトとモードを選び作成
- **API**: `POST /api/backups`（`{project_id, mode}`）
- 作成は監査ログ `backup_create` へ記録されます（operator以上）
- **完了確認**: 一覧にBK-IDが追加され、ZIPが `data/backups/` に存在する

## 5. 一覧確認・検証

- **一覧**: システム状態画面のバックアップカード / `GET /api/backups`（新しい順・project_id絞り込み可）
- **検証（復元せずに整合性チェック）**: `GET /api/backups/{backup_id}/verify`
  - Manifestの**全ファイルSHA-256**を照合し `{valid, mismatches, manifest_summary}` を返します
  - 旧形式（v1・File Listなし）は検証不能（`valid: null`）として扱われ、推測で合格になりません
- リリース前・月次点検での検証実行を推奨します（[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)）

## 6. 復元手順

1. **復元前に現状のバックアップを取得**（誤操作時に戻れるようにするため）
2. 「運用 > システム状態」のバックアップカードから対象BK-IDを選び「復元」
   - API: `POST /api/backups/{backup_id}/restore`（`{new_project_id?}`）
3. **復元は既定で新しいProject IDへ**行われます（`<元ID>_restored_<n>` を自動採番）。**既存プロジェクトは上書きされません**（明示指定IDが既存と衝突する場合もエラー）
4. 復元前に全ファイルのSHA-256が検証され、不一致・欠落があれば**復元を開始しません**（error_code=BACKUP_VALIDATION_FAILED）
5. 復元後にも書き込んだファイルが再検証されます（不一致時は復元先プロジェクトを削除してエラー=**部分復元を残しません**）

### 復元後の確認

- 復元先プロジェクトを開き、画像枚数・ラベル・モデル一覧・実験/リリース記録を確認
- 問題なければ、必要に応じて旧プロジェクトと置き換える運用判断を行う（自動置換はされません）

## 7. 失敗時の対応

| 症状 | 対処 |
|---|---|
| 検証で `valid: false`（SHA-256不一致） | そのバックアップからの復元は中止し、別の世代を検証。保存先ディスクの健全性を確認 |
| 復元が BACKUP_VALIDATION_FAILED | 同上（復元は開始されていないため既存データは無事） |
| 復元後検証エラー | 復元先は自動削除済み。別世代で再試行し、ディスク空き容量を確認 |
| 失敗の記録 | 監査ログ `restore_failed` に記録されます |

## 8. 削除・世代管理・容量

- バックアップZIPの削除機能はUI/APIにありません。**世代管理はファイル操作（`data/backups/` 内のZIP削除）で行います**。削除したZIPは `index.json` 上は残りますが復元対象から外れます
- fullバックアップはプロジェクトサイズと同等の容量を消費します。データ使用量カード（システム状態画面）と `/health/details` のディスク空きを確認しながら世代数を決めてください（目安: full 4世代＋metadata 30世代から調整）
- **制約（明記）**:
  - 復元は常に新Project IDへ行われ、既存プロジェクトへの上書き復元はできません
  - `data/backups/` 自体のバックアップ（別媒体への退避）はOS側の運用で行ってください
  - Manifest v1（旧形式）は整合性検証ができません
