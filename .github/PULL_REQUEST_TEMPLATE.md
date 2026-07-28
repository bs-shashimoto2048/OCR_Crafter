## 関連Issue

Closes #

## 変更概要

<!-- 何をしたPRか、1〜3行で要約してください -->

## 変更理由

<!-- なぜこの変更が必要か。関連Issueに書ききれていない背景があれば補足 -->

## 実装内容

<!-- 主な変更点を箇条書きで -->

## 対象外

<!-- 今回のPRでは対応しなかった範囲（次のIssueへ回した内容等） -->

## UI変更

<!-- 画面・コンポーネントの変更有無。無ければ「なし」 -->

## API・データ構造への影響

<!-- エンドポイント追加/変更、config/settings.yaml、data/projects/配下のファイル形式、
     localStorageキー等への影響。無ければ「なし」 -->

## テスト結果

```
# バックエンド
python -m pytest -q

# フロントエンド
cd frontend && npm test
```

<!-- 実行結果（件数・全件通過したか）を貼り付けてください -->

## Build結果

```
cd frontend && npm run build
```

<!-- 実行結果を貼り付けてください -->

## 回帰確認

<!-- 既存データ・既存プロジェクトとの互換性、他画面への影響をどう確認したか -->

## ドキュメント更新

<!-- 更新したドキュメント（README / docs/README / USER_GUIDE / SCREEN_SPEC / API_REFERENCE /
     CHANGELOG / manual / tutorial / examples / FAQ 等）。更新不要な場合はその理由 -->

## スクリーンショット

<!-- UI変更がある場合は変更前後の画面。無ければ「なし」 -->

## レビュー時の注意点

<!-- レビュアーに特に見てほしい箇所、判断に迷った点等 -->

## チェックリスト

- [ ] 関連Issueがある（`Closes #`を記入済み）
- [ ] Issueの受け入れ条件を満たしている
- [ ] 無関係な変更を含んでいない
- [ ] Backendテスト通過（`python -m pytest -q`）
- [ ] Frontendテスト通過（`cd frontend && npm test`）
- [ ] Frontend Build成功（`cd frontend && npm run build`）
- [ ] 既存データとの互換性を確認した
- [ ] ドキュメント更新済み（不要な場合は理由を明記）
- [ ] CHANGELOG更新要否を確認した
- [ ] 機密情報（パスワード・トークン・APIキー・個人データ等）を含んでいない
- [ ] デバッグコード（一時的なconsole.log・print等）を残していない
