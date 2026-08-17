---
name: Feature
description: OCR_Crafterの機能追加・既存機能拡張
title: "[Feature] "
labels: []
assignees: []
---

## Summary

<!-- 何を実現するIssueか。ユーザー/システム上の目的を短く記載 -->

## Architecture Traceability

<!-- 関連Epic / ADR / design / prior Issues / existing implementation path -->

- Epic:
- ADR:
- Design:
- Related Issues/PRs:
- Existing path to investigate:

## Scope

<!-- このIssueで変更してよい範囲 -->

- [ ]

## Out of Scope

<!-- 明示的に変更しない範囲。隣接機能を「ついでに」変更しない -->

- 

## Investigation

<!-- 実装前に必ず実コードを確認する項目。結果はIssue本文またはコメントへ追記 -->

- [ ] 既存のProduction path / helper / contractを確認
- [ ] 既存testsと互換性要件を確認
- [ ] API / DB / schema / UI / dependencyへの影響有無を確認
- [ ] 想定と実コードの差異を記録

## Implementation Notes

<!-- 必須設計、避けるべき再実装、error handling、build-once等。未確定事項は推測で埋めない -->

## Required Tests

- [ ] 新規/変更behaviorのfocused tests
- [ ] error / boundary cases
- [ ] 関連regression tests
- [ ] shared behaviorへ影響する場合はfull suite
- [ ] DB-backed変更/検証が関係する場合はclean-environment + checksum確認
- [ ] CIでIssue #8以外の新規failureがないことを確認

## Documentation

<!-- 変更内容に応じてADR/design/workitem/API/screen/dataflow/changelog等を更新 -->

- [ ] 実装状態を事実どおり更新
- [ ] Merge前にCompleted/Merged/未確定commit IDを先書きしない
- [ ] Deferred事項はFuture Workとして記録

## Exit Criteria

- [ ] Scope内の実装完了
- [ ] Required Tests成功
- [ ] PR作成・マージ前レビュー完了
- [ ] Blocker/Majorなし
- [ ] CI結果確認済み
- [ ] 必要なdocs更新済み
- [ ] Squash Merge後、実commit SHAで完了記録
- [ ] Issue Close / main同期 / working tree clean

## Additional Notes

<!-- UI微調整等は作業中に自然言語で追加指示してよい。Scope外へ広がる場合は別Issueへ分離する。 -->
