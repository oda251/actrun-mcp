---
tags:
  - consideration
  - decision
  - sidekick
  - agent-orchestration
---
# sidekick inputs における参照渡し

depends-on:
- [sidekick 設計思想](./2026-03-30-dec-sidekick-design-philosophy.md)
- [sidekick 要件定義](./2026-03-29-sidekick-requirements.md)

## 課題

sidekick の inputs は現在 `Record<string, string>` で、メインエージェントが値を文字列として直接埋め込む。しかしメインエージェントがワーカーに伝えたいのは、多くの場合「情報そのもの」ではなく「情報の在処」である。

- ユーザーとの対話で得た要件 → 会話履歴の該当箇所
- 実装対象のコード → ファイルパス
- 設計方針 → ドキュメントへの参照

これらを文字列に全展開すると:

1. **ワーカーのコンテキストを不必要に消費する** — ワーカーが実際に必要とする部分は一部かもしれない
2. **情報のソースが曖昧になる** — ワーカーが原典を確認できない
3. **メインエージェントの要約品質に依存する** — 展開時に情報が欠落・歪曲するリスク

## 方針: input を「本文 + 引用」で構造化する

各 input の値を、本文（メインエージェントの説明）と引用（エビデンスへのリンクと抜粋）で構成する。

```typescript
interface InputValue {
  body: string;                   // エージェントが伝えたいこと
  citations?: Citation[];         // エビデンスとなるソースへの参照
}

type Citation =
  | { type: "transcript"; excerpt: string }              // sidekick が保持する transcript_path で解決
  | { type: "uri"; source: string; excerpt: string }     // エージェントが URI を直接指定
```

**`transcript` 型**: エージェントは transcript のファイルパスを知らない。sidekick が `SessionStart` hook で受け取った `transcript_path` を使って解決する。エージェントは excerpt（抜粋）だけ渡せばよい。

**`uri` 型**: ファイルパス、URL など、エージェントがソースの場所を知っている場合に使う。

### 例

```json
{
  "what": {
    "body": "セッションベースの認証を JWT に移行する。移行中も既存セッションを維持すること",
    "citations": [
      {
        "type": "transcript",
        "excerpt": "移行中も既存ユーザーのセッションを切りたくない"
      },
      {
        "type": "uri",
        "source": "src/auth/session.ts:15-40",
        "excerpt": "app.use(session({ store: new RedisStore(...) }))"
      }
    ]
  },
  "where": {
    "body": "src/auth/ 配下の認証ミドルウェア",
    "citations": [
      {
        "type": "uri",
        "source": "src/auth/middleware.ts",
        "excerpt": ""
      }
    ]
  }
}
```

### ワーカーの振る舞い

- **本文だけで作業に取りかかれる** — 引用がなくても動作する
- **引用の原典を辿れる** — `uri` ならファイル Read / WebFetch、`transcript` なら sidekick が注入したパスの JSONL を読む
- **sidekick は `transcript` 型のパス解決のみ行う** — `uri` 型はワーカーがそのまま使う

### 会話履歴の参照

メインエージェントの会話履歴は JSONL ファイルとしてディスク上に存在する（`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`）。他プロセスから読み取り可能。

sidekick は起動時に `SessionStart` hook 経由で `transcript_path` を受け取り、保持する。ワーカーへのプロンプト生成時にこのパスを注入する。

```
SessionStart hook
  → stdin JSON に transcript_path が含まれる
  → hook が sidekick の API を呼び、パスを登録する
  → sidekick がワーカー起動時にプロンプトに注入する
```

## 未決事項

- JSONL のフォーマットは非公式。Claude Code のバージョンアップで構造が変わるリスクがある
- outputs にも引用付き構造を使うべきか（チェーンで次ステップに渡す場合）
