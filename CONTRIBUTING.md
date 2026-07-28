# Contributing to OCR Crafter

このドキュメントは、OCR Crafterへ変更を加えるすべての人（人間の開発者・Claude Code・Codex・その他AIコーディングエージェント）を対象にした開発ルールです。

プロジェクト固有のコーディング規約（言語・ディレクトリ構成・編集禁止箇所等）は [CLAUDE.md](CLAUDE.md) を参照してください。GitHub Issuesを使った開発フロー全体は [docs/development/GITHUB_ISSUES_WORKFLOW.md](docs/development/GITHUB_ISSUES_WORKFLOW.md)、Issueの書き方は [docs/development/ISSUE_WRITING_GUIDE.md](docs/development/ISSUE_WRITING_GUIDE.md)、AIエージェントへの指示方法は [docs/development/AI_AGENT_WORKFLOW.md](docs/development/AI_AGENT_WORKFLOW.md) にあります。

## 開発開始前

- **まずIssueを作る**。`.github/ISSUE_TEMPLATE/` にあるFeature/Bug/Refactor/Documentation/Investigationのいずれかを使ってください
- **Issue番号なしで機能実装を開始しない**
- **Bugの緊急修正でもIssueを作る**（緊急度が高いほど、後から経緯を追えることが重要です）
- **Issue本文を一次仕様書として扱う**。Pull Requestの説明文だけに仕様を書かない
- **不明点は実装前にIssueへ追記する**。推測で実装を進めない

## ブランチ

推奨命名規則:

```text
feature/<issue-number>-<short-name>
fix/<issue-number>-<short-name>
refactor/<issue-number>-<short-name>
docs/<issue-number>-<short-name>
investigation/<issue-number>-<short-name>
```

例: `feature/142-trocr-engine-capability`

現在の運用は`main`への直接pushが中心ですが、**今後はIssue単位のブランチとPull Requestを使う運用へ移行することを推奨します**。GitHub側のBranch protection（`main`への直接push禁止設定等）は本ドキュメント作成時点では設定されていません（設定するかどうかは別途判断してください）。

## Commit

このリポジトリの既存コミット履歴は、`feat:` / `fix:` / `refactor:` / `docs:` などの接頭辞（Conventional Commits相当）をすでに緩やかな慣習として使っています。これを引き続き踏襲しつつ、**Issue番号を含めることを推奨**します。

```text
feat: add TrOCR training support (#123)
fix: persist inference model selection (#124)
docs: update Tesseract tutorial (#125)
```

Conventional Commitsの厳密な書式（`scope`や`BREAKING CHANGE:`フッター等）やCIによる自動チェックは、本ドキュメント作成時点では導入していません。将来的に必須化する場合は、その旨をこのドキュメントとCIへ追記してください。

## Pull Request

- **1 Issue = 原則1 PR**
- PR本文に `Closes #番号` を必ず記載する（`.github/PULL_REQUEST_TEMPLATE.md` を使用）
- **PRだけで仕様を追加しない**。仕様変更が必要になった場合は、先にIssueを更新する
- レビュー完了後にmergeする
- merge後にIssueがCloseされたことを確認する（GitHubのキーワード連携で自動closeされない場合は手動でcloseする）

## テスト

実際にこのリポジトリで使用しているコマンドは以下のとおりです（汎用的な例ではありません）。

```bash
# バックエンド（.venv を使用。リポジトリルートで実行）
python -m pytest -q

# フロントエンド（node:test。追加の依存インストールは不要）
cd frontend
npm test

# フロントエンドのビルド（バックエンドに独立したビルド工程はない）
cd frontend
npm run build
```

個別のバックエンドテストファイルのみ実行する場合:

```bash
python -m pytest tests/test_delete_model_safety.py -q
```

## ドキュメント

変更内容に応じて、以下の更新要否を確認してください。すべてを毎回更新する必要はありませんが、**確認せず放置しない**でください。

| 変更内容 | 確認するドキュメント |
|---|---|
| プロジェクト概要・トップページの記載に関わる変更 | `readme.md`（リポジトリ直下） |
| ドキュメントの目次・案内に関わる変更 | `docs/README.md` |
| 画面の操作・仕様に関わる変更 | `docs/USER_GUIDE.md`・`docs/16_SCREEN_SPEC.md` |
| APIエンドポイントの追加・変更 | `docs/06_API_REFERENCE.md` |
| 仕様変更・その理由の記録 | `CHANGELOG.md`・`docs/15_CHANGELOG_AI.md` |
| 初めて使う人向けの説明・開発フロー | `docs/manual/` 配下の該当章 |
| 操作手順（学習→評価→推論登録等） | `docs/tutorial/` 配下の該当エンジンのチュートリアル |
| Dataset/Evaluation/Experimentの構造 | `docs/examples/` 配下の該当サンプル |
| よくある質問 | `docs/FAQ.md`（`docs/manual/08_FAQ.md`とは対象読者が異なるため両方確認） |
| 症状別の対処 | `docs/TROUBLESHOOTING.md` |

各文書の役割の全体像は [docs/README.md](docs/README.md) を参照してください。
