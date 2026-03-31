---
tags:
  - decision
  - sidekick
  - actrun
  - architecture
---
# actrun 統合設計

depends-on:
- [sidekick 設計思想](./2026-03-30-dec-sidekick-design-philosophy.md)
- [Jobs / Steps アーキテクチャ](./2026-03-31-con-jobs-steps-architecture.md)

## 背景

sidekick の jobs/steps アーキテクチャは GHA と同じ構造に行き着いた。[mizchi/actrun](https://github.com/mizchi/actrun) は GHA 互換のローカルランナーで、DAG 解決・コマンド実行・job 間データ伝播が実装済み。これをゼロから再実装するのは無駄。

ただし actrun は MoonBit 製の CLI ツールで、MCP サーバーとして動作する仕組みがない。sidekick の価値（MCP 経由のタスク投入、Intent Gate、エージェント通知、LLM が job 間に判断を挟む）を actrun 単体では提供できない。

## 方針: 2プロジェクト構成

### actrun（既存）

GHA 互換の実行エンジン。変更は最小限:

- `skill:` step タイプの追加（ローカル Node action として実装）
- actrun 本体の MoonBit コードは触らない

### actrun-mcp（新規）

TypeScript 製の MCP サーバー。sidekick の後継:

- MCP サーバーとして常駐し、メインエージェントとワーカーの接続を管理
- ワークフロー投入時に actrun CLI をサブプロセスで呼び、job を実行
- Intent Gate（エビデンス検証）をステップ実行前に適用
- タスクの状態管理、通知、永続化を担う

```
メインエージェント ←MCP→ actrun-mcp (TypeScript)
                              │
                              ├─ actrun CLI (MoonBit) ← job の steps 実行
                              │    ├─ run: step → シェルコマンド
                              │    └─ uses: ./skill-action → Node action
                              │         └─ Claude Agent SDK でワーカー起動
                              │
                              ├─ Intent Gate（エビデンス検証）
                              ├─ タスク永続化（sqlite）
                              └─ 通知（caller-scoped）
```

## actrun への PR

ローカル Node action として `skill-action` を提供する。actrun 本体の変更はゼロ。

```
actions/skill-action/
  action.yml
  index.js        # Claude Agent SDK + sidekick MCP client
  package.json
```

```yaml
# action.yml
name: sidekick-skill
description: Execute a sidekick skill via Claude Agent SDK
inputs:
  skill:
    description: Skill path (e.g. dev/impl)
    required: true
  inputs:
    description: JSON-encoded task inputs
    required: true
  sidekick-url:
    description: sidekick MCP server URL
    default: http://127.0.0.1:4312/mcp
runs:
  using: node20
  main: index.js
```

ワークフロー定義:

```yaml
# .github/workflows/implement.yml
name: Implement feature
on: workflow_call
  inputs:
    what:
      description: What to implement
    where:
      description: Target file

jobs:
  impl:
    runs-on: local
    steps:
      - uses: ./actions/skill-action
        with:
          skill: dev/impl
          inputs: '${{ toJSON(inputs) }}'
      - uses: ./actions/skill-action
        with:
          skill: dev/review
          inputs: '${{ steps.impl.outputs.result }}'

  lint:
    runs-on: local
    steps:
      - run: bun run lint

  test:
    runs-on: local
    steps:
      - run: bun test

  integrate:
    needs: [impl, lint, test]
    runs-on: local
    steps:
      - uses: ./actions/skill-action
        with:
          skill: dev/integrate
          inputs: '${{ toJSON(needs) }}'
```

## actrun-mcp の MCP ツール

| ツール | 説明 |
|---|---|
| workflows | 利用可能なワークフロー一覧（.yml から読み込み） |
| run | ワークフローを投入。Intent Gate → actrun 起動 |
| status | タスク状態の確認 |
| done | ワーカーからの完了報告 |
| reject | ワーカーからの差し戻し |

## sidekick からの移行

| sidekick | actrun-mcp |
|---|---|
| スキル定義 (.md frontmatter + body) | step 定義 (.md) + workflow 定義 (.yml) |
| `next` チェーン | job 内の `steps` 配列 |
| `next: [a, b]` fan-out | 複数 job |
| fan-in（未実装） | `needs` |
| コマンド実行（未実装） | `run:` step（actrun が実行） |
| DAG 解決（設計のみ） | actrun の DAG スケジューラ |
| Intent Gate | そのまま移行 |
| 構造化 inputs | そのまま移行 |
| MCP サーバー | そのまま移行 |
| エビデンス検証 | そのまま移行 |

## actrun 側に求めるもの

actrun 本体への変更は不要。PR で提供するのは:

1. `actions/skill-action/` — ローカル Node action
2. サンプルワークフロー — skill step を使った .yml
3. ドキュメント — skill step の使い方

actrun のローカル Node action サポートが既に実装されているため、これだけで動く。

## 決定事項

**DAG 管理は actrun-mcp が持つ。** actrun は 1 job の steps を実行するだけ。actrun-mcp が `needs` を解決し、job ごとに `actrun workflow.yml --job <name>` を呼ぶ。これにより LLM が job 間に判断を挟めるようになる（全 job を一気に流す actrun の制約を回避）。

## 決定事項（追加）

**ワークフロー配置**: `.claude/workflows/` に `.yml` を置く。actrun-mcp が読み込み、`actrun .claude/workflows/<file>.yml --job <name>` で actrun に渡す。

**inputs/outputs の境界**:
- メインエージェント → actrun-mcp: 構造化 inputs (plain/evidenced) + Intent Gate 検証
- actrun-mcp → actrun: JSON 文字列化して GHA inputs として渡す
- actrun 内 step 間: GHA 標準 outputs（actrun の責務、actrun-mcp は介在しない）
- actrun → actrun-mcp (job 完了): string outputs を返す
- actrun-mcp → actrun (次の job): needs 解決後、JSON 文字列で渡す

## 未決事項

