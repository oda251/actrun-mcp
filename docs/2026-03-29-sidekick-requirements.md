---
tags:
  - design
  - sidekick
  - agent-orchestration
  - mcp
---
# sidekick — エージェントワークフローオーケストレーター

## 概要

sidekick は Claude Code メインエージェントとワーカーエージェントの間に立つオーケストレーター。
MCP サーバーとしてデーモン動作し、ワークフロー定義に基づいてタスクの委譲・チェーン実行・通知を行う。

## アーキテクチャ

```
CC メインエージェント ←MCP(ツール+Channel)→ sidekick daemon ←CLI→ ワーカーエージェント
```

- **メインエージェント**: ユーザーと対話し、タスクを分解して sidekick に投入する（plan）
- **sidekick**: MCP サーバーとしてツール提供 + Channel で通知。ワーカーの起動・管理を行う
- **ワーカー**: CC サブプロセスとして起動。ワークフロー定義に従い作業を実行する

### 設計原則

- タスクの分解と実行は分離する。メインエージェントは実行しない、ワーカーは対話しない
- メインエージェントの行動指針（hooks）はワーカーに漏洩させない（コンテキスト分離）
- ワークフローの追加はディレクトリとファイルを足すだけ（動的バインド）
- sidekick は CC セッションを跨いでデーモンとして動作する

## MCP インターフェース

### ツール（CC → sidekick）

| ツール | 引数 | 返り値 | 説明 |
|---|---|---|---|
| `workflows` | なし | ワークフロー一覧 | 直接実行可能なワークフローの description と inputs を返す |
| `run` | `type`, `inputs`, `title` | taskId | ワーカーを起動してタスクを開始する |
| `status` | `taskId?` | タスク状態一覧 | 実行中・完了・rejected のタスク一覧を返す |

### Channel 通知（sidekick → CC）

| イベント | 発火条件 | 内容 |
|---|---|---|
| `task.done` | next チェーンが全完了した時 | taskId, title, result |
| `task.rejected` | ワーカーが reject した時 | taskId, title, reason |

## CLI インターフェース（ワーカー → sidekick）

| コマンド | 引数 | 動作 |
|---|---|---|
| `sidekick done` | `--output key=value ...` | next があれば次ステップを起動、なければ CC に通知 |
| `sidekick reject` | `--reason "..."` | CC に通知 |

## ワークフロー定義

### ディレクトリ構造

```
skills/
  dev/
    impl.md       # next: review
    review.md     # internal: true
  research/
    gather.md     # next: write
    write.md      # internal: true
```

### フロントマター仕様

```yaml
---
description: string          # ワークフローの目的（workflows ツールで表示）
inputs:                      # 入力パラメータ
  key1: 説明1                 # 短縮形（type: evidenced がデフォルト）
  key2:                       # 完全形
    description: 説明2
    type: plain               # plain | evidenced
confirm-before-run: bool      # ユーザー承認が必要か（デフォルト: false）
next: string                 # 後続ステップのファイル名（拡張子なし）
internal: bool               # next チェーン専用か（デフォルト: false）
tools: string[]              # ワーカーに許可するツール（省略時: 全許可）
permission-mode: string       # ワーカーの権限モード（省略時: auto）
---
```

### フロントマター各フィールドの責務

| フィールド | デフォルト | 説明 |
|---|---|---|
| `description` | （必須） | ワークフローの目的。メインエージェントが委譲先を判断する材料 |
| `inputs` | （必須） | 呼び出しに必要な入力。各 input は型（plain / evidenced）を持つ。全て埋まらないと呼び出せない |
| `confirm-before-run` | `false` | `true` の場合、メインエージェントがユーザーに承認を求める |
| `next` | なし | 後続ステップ。同一ドメインディレクトリ内のファイル名 |
| `internal` | `false` | `true` のステップは next チェーン専用。直接実行不可 |
| `tools` | 全許可 | ワーカーに許可するツールの一覧 |
| `permission-mode` | `auto` | ワーカーの権限モード |

### input の型

| 型 | 説明 | エビデンス検証 |
|---|---|---|
| `plain` | ファイルパス、単純な値など | なし |
| `evidenced` | 要件、仕様など。citation（出典 + 抜粋）が必須 | あり（excerpt が source に存在するか） |

短縮形（`key: 説明`）は `type: evidenced` として扱われる。

## next チェーンの動作

### outputs の自動解決

1. sidekick がエントリポイントの `next` を辿り、後続ステップの `inputs` を取得する
2. 後続ステップの `inputs` からエントリポイントの `inputs` を引いた差分を outputs とする
3. ワーカー起動時に「完了時にこの output を返せ」と共通フローで伝える
4. ワーカーが `sidekick done --output key=value` で完了する
5. sidekick が前ステップの inputs + outputs を次ステップの inputs として渡す

### 例: dev/impl → dev/review

```
dev/impl の inputs:  { what, where, spec }
dev/review の inputs: { changes }

→ impl の outputs は { changes }（自動解決）
→ ワーカーには「完了時に changes を返せ」と伝える
→ impl 完了後、review に { changes } を渡す
```

## ワーカー起動

sidekick がワーカーを起動する際、以下をプロンプトとして注入する:

### 1. 共通フロー

全ワーカーに共通の実行フロー:

```
1. タスク内容と inputs を確認する
2. 要件不足 → sidekick reject --reason "理由"
3. 実行する（ワークフロー本文に従う）
4. セルフレビュー
5a. OK → sidekick done --output key=value ...
5b. 問題あり → sidekick reject --reason "理由"
```

### 2. ワークフロー本文

該当する `.md` ファイルのフロントマター以降の本文。

### 3. inputs

メインエージェントが `run` ツールで渡した入力値、
または前ステップから引き継いだ値。

### 4. outputs 定義（then がある場合）

「完了時に以下の output を返せ」として、
後続ステップの inputs から逆算した output パラメータ名と説明。

## データモデル

```typescript
type InputEntry =
  | { type: "plain"; value: string }
  | { type: "evidenced"; body: string; citations: Citation[] }

type Citation =
  | { type: "transcript"; excerpt: string }
  | { type: "uri"; source: string; excerpt: string }
  | { type: "command"; command: string; excerpt: string }

interface Task {
  id: string
  type: string           // "dev/impl"
  title: string          // "JWT検証ミドルウェア実装"
  inputs: Record<string, InputEntry>
  status: "running" | "done" | "rejected"
  output?: Record<string, string>
  reason?: string        // reject 時
  next?: string          // "review"
  chainParent?: string   // チェーン元の taskId
  group?: string         // 並列実行グループ
  caller?: string        // 投入元のセッションID
}
```

## 承認制御

メインエージェントは `confirm-before-run: true` のタスクを投入する前に、
ユーザーに一括で提示して承認を得る。

```
[自動実行]
- JWT vs Session 比較（research/gather）

[承認待ち]
- JWT検証ミドルウェア実装（dev/impl）
- 認証APIエンドポイント実装（dev/impl）

承認 / 修正 / 却下
```

`confirm-before-run: false` のタスクは確認なしで即実行する。

## 非機能要件

### IO バリデーション

- `run` 時に inputs が不足していればエラーを返す
- `done` 時に outputs が不足していればエラーを返す（next がある場合）
- `reject` 時に reason が空ならエラーを返す
- 型違反は即座にエラーとし、暗黙の補完はしない

### ワークフロー定義のバリデーション

- フロントマターが不完全なワークフローは読み込まない（無視する）
- 必須フィールド: `description`, `inputs`
- `next` が指す先のファイルが存在しなければエラー
- `next` チェーンに循環があればエラー
- バリデーション違反時はエラー内容を明示する

### lint コマンド

`sidekick lint` で skills/ のバリデーションを実行する。

- フロントマター解釈ロジックはランタイムと lint で共有する
- lint は CI でも使えるよう、exit code でエラーを返す
- 検出項目:
  - フロントマター必須フィールドの欠落
  - next 先の未解決参照
  - next チェーンの循環検出
  - internal: true なのに next から参照されていないステップ（孤立）
  - inputs の key 名重複

## 技術スタック

- TypeScript
- MCP SDK（`@modelcontextprotocol/sdk`）
- stdio transport（CC がサブプロセスとして起動）
- Channel capability（`claude/channel`）で通知

## 拡張ポイント

- **新ドメイン追加**: `skills/` にディレクトリとファイルを足すだけ
- **スケジュール実行**: `schedule` ツールを追加し、cron で `run` を呼ぶ
- **外部承認**: Channel の permission capability で Slack 等に承認を飛ばす
- **タスク永続化**: ファイルベースの状態保存で CC セッション跨ぎ
