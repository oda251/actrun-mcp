---
tags:
  - consideration
  - decision
  - sidekick
  - workflow-architecture
---
# Jobs / Steps アーキテクチャ

depends-on:
- [sidekick 設計思想](./2026-03-30-dec-sidekick-design-philosophy.md)
- [sidekick 要件定義](./2026-03-29-sidekick-requirements.md)

## 課題

現在の sidekick はワークフローを step の直列チェーン（`next`）で表現している。fan-out（分岐）はできるが、fan-in（収束）を step レベルで解決しようとすると複雑になる:

- 暗黙的 fan-in（同じステップを複数の next が指す）→ 共有 step との区別が不可能
- 明示的 fan-in（`awaits` フィールド）→ step 定義が push と pull の両方を持ち、矛盾管理が困難
- チェーン深さが異なるブランチの合流 → chainParent での判定が破綻

## 方針: GHA 型の job / step 分離

### 構造

```yaml
# skills/dev/implement.yml
description: コードを実装してレビューする
inputs:
  what:
    description: 実装内容
    type: evidenced
  where:
    description: 対象ファイル
    type: plain
confirm-before-run: true

jobs:
  impl:
    steps:
      - skill: dev/impl
      - skill: dev/review
  lint:
    steps:
      - run: bun run lint
  test:
    steps:
      - run: bun test

  integrate:
    needs: [impl, lint, test]
    steps:
      - skill: dev/integrate
```

### 概念

| 概念 | 責務 | 実行 |
|---|---|---|
| **workflow** | メインエージェントに見える単位。inputs, description, confirm-before-run を持つ | メインエージェントが `run` で投入 |
| **job** | 並列実行の単位。`needs` で依存関係を宣言 | sidekick が DAG を解決し、依存が満たされた job から起動 |
| **step** | 直列実行の単位。`skill:` または `run:` | sidekick が順番に実行。前の step の完了後に次を開始 |

### step の種類

| 種類 | 記法 | 実行方法 |
|---|---|---|
| skill | `skill: dev/impl` | ワーカーを起動してスキルを実行 |
| command | `run: bun run lint` | シェルコマンドを直接実行。exit code で成否判定 |

### メインエージェントへの公開

メインエージェントに見えるのは **workflow** のみ。`workflows` ツールが返すのは:

- workflow の description, inputs, confirm-before-run
- job の存在や step の詳細はメインエージェントに見せない

メインエージェントは「何を実行するか」だけを判断し、「どう実行するか」は sidekick + workflow 定義が決める。

### 既存との関係

| 現在 | 移行後 |
|---|---|
| `skills/dev/impl.md` (ワークフロー + step が一体) | `skills/dev/impl.md` は step 定義（inputs + ワーカーへの指示） |
| frontmatter の `next` | job 内の `steps` 配列で順序を表現 |
| frontmatter の `description`, `confirm-before-run` | workflow 定義（`.yml`）に移動 |
| frontmatter の `internal` | 不要（job 内の step は全て内部的） |
| frontmatter の `inputs`, `tools`, `permission-mode` | step .md にそのまま残る |
| fan-out (`next: [a, b]`) | 複数 job で表現 |
| fan-in (未実装) | `needs` で解決 |

### step 定義ファイル（.md）

step 定義は今のスキル .md ファイルと同じ。ワーカーへの作業指示を本文に書く。`description`, `confirm-before-run`, `next` は workflow .yml に移動し、`internal` は不要になる。

```yaml
# skills/dev/impl.md
---
inputs:
  what:
    description: 実装内容
    type: evidenced
  where:
    description: 対象ファイル
    type: plain
tools: [Read, Edit, Write, Bash]
permission-mode: auto
---

（ワーカーへの作業指示）
```

### DAG 解決

sidekick が workflow 投入時に job の依存グラフを構築する:

1. `needs` のない job → 即座に開始
2. `needs` が全て完了した job → 開始
3. いずれかの job が失敗 → 依存する job はスキップ（GHA の `if: always()` に相当する仕組みは後で検討）

## 未決事項

- job 間のデータ受け渡し: 今の output 自動解決をどう拡張するか
- job / step レベルの失敗ハンドリング: step 失敗で job 全体を止めるか、次の step に進むか
- workflow .yml と step .md の配置ルール（同一ディレクトリ？サブディレクトリ？）
- 既存の `next` ベースのワークフローからの移行パス
