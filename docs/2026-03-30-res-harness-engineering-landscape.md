---
tags:
  - research
  - harness-engineering
  - multi-agent
  - guardrails
  - citation
  - sidekick
---
# ハーネスエンジニアリング競合調査

sidekick（Claude Code 上の宣言的マルチエージェントオーケストレーター）の類似・競合プロダクトを、ハーネスエンジニアリングの4つの軸で調査した。

sidekick の核心的価値:
1. **エビデンス付きタスク委譲** -- ハルシネーション抑制のため citation（出典+抜粋）を構造化して添付
2. **段階的開示** -- ワーカーに見せる情報をアーキテクチャレベルで制御
3. **宣言的ワークフロー** -- frontmatter でタスク種別・入出力・チェーンを定義。コード変更なし

---

## A. LLM ハーネス/ガードレール系

LLM の入出力を構造的に制約・検証するツール群。sidekick のエビデンス検証とは異なり、主に**出力スキーマの強制**と**コンテンツ安全性**にフォーカスする。

### A-1. Guardrails AI

- URL: [https://github.com/guardrails-ai/guardrails](https://github.com/guardrails-ai/guardrails)
- LLM 出力に対する Pydantic ベースのバリデーションパイプライン。60+ のプリビルトバリデータ（PII検出、毒性、ハルシネーション等）を組み合わせ、失敗時は自動リトライでLLMにエラーコンテキストを返す（[ToolHalla 2026記事](https://toolhalla.ai/blog/ai-agent-guardrails-io-validation-2026)）
- **sidekick との類似**: 出力の検証という点で共通。sidekick は citation の存在・妥当性を検証、Guardrails AI はスキーマ適合性を検証
- **差分**: Guardrails AI は単一 LLM 呼び出しの出力品質に特化。エージェント間のタスク委譲やエビデンスの流通は扱わない
- **示唆**: ハルシネーション検出バリデータを citation 検証に応用できる可能性。バリデータのパイプライン設計（合成可能な検証ステップ）は参考になる

### A-2. NeMo Guardrails

- URL: [https://github.com/NVIDIA-NeMo/Guardrails](https://github.com/NVIDIA-NeMo/Guardrails)
- NVIDIA 製。Colang という DSL で対話フロー（input/output/execution rails）を定義し、LLM の対話を制御する（[arXiv:2310.10501](https://arxiv.org/abs/2310.10501)）
- **sidekick との類似**: 宣言的な定義言語で振る舞いを制御する点。Colang は対話フロー、sidekick は frontmatter でワークフロー
- **差分**: NeMo は対話の安全性（トピック制限、アクション制御）に特化。マルチエージェント協調やエビデンス付与は範囲外
- **示唆**: Colang の「レール」概念（入力レール→処理→出力レール）は、sidekick のワークフロー各ステップにガードレールを追加する際の設計参考になる

### A-3. Guidance (Microsoft)

- URL: [https://github.com/guidance-ai/guidance](https://github.com/guidance-ai/guidance)
- デコーダレベルで制約を注入し、トークンごとにマスクをかけて出力を制御する。JSON/Python/HTML/SQL 等の構造を強制可能。llguidance エンジンは Rust 製で 50μs/token の高速処理（[Microsoft Research](https://www.microsoft.com/en-us/research/project/guidance-control-lm-output/)）。OpenAI の Structured Outputs の基盤技術として採用された（[llguidance GitHub](https://github.com/guidance-ai/llguidance)）
- **sidekick との類似**: LLM の出力を構造的に制約するという目的は共通
- **差分**: Guidance はトークン生成時の制約（コンパイル時制約）。sidekick は生成後のタスク単位での検証と委譲の制御
- **示唆**: sidekick がローカルモデルを使う場合、Guidance の制約付きデコーディングで citation 構造の出力を強制できる可能性がある

### A-4. LMQL

- URL: [https://lmql.ai/](https://lmql.ai/)
- LLM とのインタラクションをクエリ言語として記述。`where` 句で制約を宣言し、トークンマスクで生成中に強制する。ネストクエリ、デコーディングアルゴリズム選択（argmax/beam search等）をサポート（[arXiv:2212.06094](https://arxiv.org/abs/2212.06094)）
- **sidekick との類似**: 宣言的な制約定義
- **差分**: 単一 LLM 呼び出しのプログラマブル制御。マルチエージェント・ワークフロー層は持たない
- **示唆**: LMQL の where 句スタイルの制約宣言は、frontmatter の制約表現を拡張する際の参考になる

### A-5. Outlines

- URL: [https://github.com/dottxt-ai/outlines](https://github.com/dottxt-ai/outlines)
- JSON Schema/正規表現/CFG を FSM（有限状態機械）にコンパイルし、生成中に無効トークンをマスクする制約付きデコーディングライブラリ（[Outlines ガイド](https://zenvanriel.com/ai-engineer-blog/outlines-structured-generation/)）
- **sidekick との差分**: 生成レイヤーの制約。sidekick はアプリケーションレイヤーのワークフロー制御
- **示唆**: citation オブジェクトの JSON Schema を定義し Outlines で構造強制するアプローチは、ローカルモデル利用時に有効

### A-6. Instructor

- URL: [https://python.useinstructor.com/](https://python.useinstructor.com/)
- Pydantic モデルで LLM の出力型を定義し、バリデーション失敗時に自動リトライする。15+ プロバイダ対応。月間 300 万+ DL（[Instructor公式](https://useinstructor.com/)）。2025年にセマンティックバリデーション（自然言語基準での検証）を追加（[Instructor ブログ](https://python.useinstructor.com/blog/2025/05/20/understanding-semantic-validation-with-structured-outputs/)）
- **sidekick との類似**: 出力の型安全性。Instructor は Pydantic、sidekick は frontmatter の inputs/outputs
- **差分**: Instructor は1回の LLM 呼び出しの構造化。ワークフローチェーンやエビデンス伝播は範囲外
- **示唆**: セマンティックバリデーション（「この citation は主張を裏付けているか？」をLLMで検証）は sidekick の citation 検証に直接応用可能

### A-7. BAML (Boundary Markup Language)

- URL: [https://github.com/BoundaryML/baml](https://github.com/BoundaryML/baml)
- `.baml` ファイルで LLM 関数のインターフェースを定義し、Python/TS/Ruby/Go 等のクライアントコードを自動生成する DSL。Schema-Aligned Parsing (SAP) で API なしモデルでも構造化出力を実現（[BoundaryML 公式](https://boundaryml.com/)）
- **sidekick との類似**: 宣言的定義ファイルからの実行。`.baml` は LLM 関数定義、sidekick の SKILL.md はワークフロー定義
- **差分**: BAML は LLM 呼び出し単位の型安全。マルチエージェント・タスク委譲は範囲外
- **示唆**: `.baml` のプロンプトをコードから分離するアプローチと、テスト/プレイグラウンド機能は、sidekick のスキル定義の品質保証に参考になる

### A カテゴリまとめ

| ツール | 制約レイヤー | 宣言的 | エビデンス | マルチエージェント |
|---|---|---|---|---|
| Guardrails AI | 生成後バリデーション | Pydantic | -- | -- |
| NeMo Guardrails | 対話フロー制御 | Colang DSL | -- | -- |
| Guidance | デコーダレベル | テンプレート | -- | -- |
| LMQL | デコーダレベル | クエリ言語 | -- | -- |
| Outlines | デコーダレベル | JSON Schema/CFG | -- | -- |
| Instructor | 生成後+リトライ | Pydantic | -- | -- |
| BAML | 型定義+SAP | .baml DSL | -- | -- |
| **sidekick** | **タスク委譲時** | **frontmatter** | **citation 構造** | **ワーカー分離** |

**ギャップ**: 既存ツールはすべて「1回の LLM 呼び出し」の出力品質に集中している。エージェント間でエビデンスを構造化して流通させる仕組みを持つツールは確認されなかった。これが sidekick の差別化ポイントの1つ。

---

## B. エージェントオーケストレーション系

マルチエージェントのタスク分解・チェーン・並列実行を行うフレームワーク群。

### B-1. LangGraph

- URL: [https://github.com/langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)
- ワークフローを DAG（有向非巡回グラフ）として定義し、ノード間の状態遷移で制御する。条件分岐、ループ、ヒューマンインザループをサポート（[o-mega 比較記事](https://o-mega.ai/articles/langgraph-vs-crewai-vs-autogen-top-10-agent-frameworks-2026)）
- **sidekick との類似**: ワークフローの構造的定義。LangGraph はグラフ、sidekick は frontmatter チェーン
- **差分**: LangGraph は Python コードでグラフを構築（命令的）。sidekick は frontmatter の `next:` で宣言的にチェーン定義。LangGraph はコンテキスト分離の概念が薄い（共有 state を前提）。sidekick はワーカーへの情報開示を意図的に制限する
- **示唆**: LangGraph の条件分岐（conditional edges）は、sidekick のチェーンに分岐ロジックを追加する際の参考になる。ただし sidekick の「コード変更なしでワークフロー追加」という設計目標とは方向性が異なる

### B-2. CrewAI

- URL: [https://github.com/crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)
- ロールベースのマルチエージェント。エージェントに役割・目標・ツールを定義し、タスクを割り当てる。20行以下で定義可能な簡潔さが特徴。RAG によるメモリサポート（[DataCamp 比較](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)）
- **sidekick との類似**: タスクベースの委譲、エージェントごとの役割定義
- **差分**: CrewAI はエージェントが自律的にコミュニケーション（情報統制なし）。sidekick はメインエージェントがワーカーの入出力を完全に制御し、ワーカー間の直接通信はない。CrewAI は Python コードで定義
- **示唆**: CrewAI のロール定義の簡潔さは参考になる。ただし sidekick の段階的開示原則（ワーカーには必要最小限の情報のみ渡す）は CrewAI にはない独自の強み

### B-3. AutoGen (Microsoft)

- URL: [https://github.com/microsoft/autogen](https://github.com/microsoft/autogen)
- 会話駆動型のマルチエージェント。エージェント間の自然言語対話でタスクを遂行する。動的なロール適応、コード実行、ヒューマン参加をサポート（[Medium 比較](https://topuzas.medium.com/the-great-ai-agent-showdown-of-2026-openai-autogen-crewai-or-langgraph-7b27a176b2a1)）
- **sidekick との類似**: マルチエージェントによるタスク分解
- **差分**: AutoGen は自由な対話ベース（情報統制なし）。sidekick は構造化されたタスク入出力。AutoGen はエージェント間の推論過程が可視化される（チャット履歴）が、エビデンスの構造化はない
- **示唆**: AutoGen のピアレビューエージェント（互いの出力を検証）は、sidekick のレビューステップ（`next: review`）と共通の設計思想

### B-4. OpenAI Swarm / Agents SDK

- URL: [https://github.com/openai/swarm](https://github.com/openai/swarm)（教育目的、プロダクション非推奨）
- 軽量なエージェント協調フレームワーク。関数呼び出しベースでタスクを分解。Agents SDK として本番向けにも展開中（[OpenAI](https://github.com/openai/swarm)）
- **sidekick との類似**: エージェント間のハンドオフ
- **差分**: Swarm はエージェント間の直接ハンドオフ（コンテキスト分離なし）。sidekick はオーケストレーター経由の間接委譲でコンテキストを統制
- **示唆**: Swarm のシンプルなハンドオフモデルは教育的だが、プロダクション要件（エビデンス、監査）には不十分。sidekick のアプローチがより堅牢

### B-5. Agency Swarm

- URL: [https://github.com/VRSEN/agency-swarm](https://github.com/VRSEN/agency-swarm)
- OpenAI Agents SDK を拡張し、カスタマイズ可能なエージェントロール（CEO、VA、Developer 等）を定義。プロンプトの完全な制御、LiteLLM 経由のマルチプロバイダ対応（[Agency Swarm GitHub](https://github.com/VRSEN/agency-swarm)）
- **sidekick との類似**: エージェントのプロンプトを完全制御する設計思想
- **差分**: Agency Swarm は OpenAI API 中心。sidekick は Claude Code のサブエージェントに特化し、ワークフロー定義をファイルシステム上で管理
- **示唆**: Agency Swarm の「エージェントのプロンプトを開発者が完全に制御する」思想は sidekick と一致。ただし Agency Swarm はエビデンス構造を持たない

### B カテゴリまとめ

| フレームワーク | 定義方式 | コンテキスト分離 | エビデンス構造 | ワークフロー追加 |
|---|---|---|---|---|
| LangGraph | Python グラフ | -- | -- | コード変更要 |
| CrewAI | Python ロール定義 | -- | RAG メモリ | コード変更要 |
| AutoGen | Python 会話定義 | -- | チャット履歴 | コード変更要 |
| OpenAI Swarm | Python 関数 | -- | -- | コード変更要 |
| Agency Swarm | Python ロール定義 | プロンプト制御 | -- | コード変更要 |
| **sidekick** | **frontmatter MD** | **アーキテクチャレベル** | **citation 構造** | **ファイル追加のみ** |

**ギャップ**: 全フレームワークがワークフロー定義に Python コードを要求する。sidekick の「Markdown ファイルを追加するだけでワークフローが増える」という宣言的アプローチは独自。また、コンテキスト分離をアーキテクチャの原則として組み込んでいるのは sidekick のみ。

---

## C. エビデンス/引用ベースの LLM システム

LLM の出力に出典を付与し、検証可能にする研究・プロダクト。

### C-1. Attribution/Citation 研究の全体像

2025年の包括的サーベイ（[Schreieder et al., arXiv:2508.15396](https://arxiv.org/html/2508.15396v1)）によると:
- 研究の 75% が「cite evidence」、62% が「attribute」、13% が「quote evidence」を目的とする
- 引用粒度はドキュメントレベル（43%）、パラグラフレベル（40%）が主流
- 検証手法は NLI ベースのメトリクス（主張が引用元から推論可能か）が最も採用されている
- **57% の引用が事後合理化（post-rationalization）**であり、引用の正確性と忠実性は別問題（[arXiv:2412.18004](https://arxiv.org/pdf/2412.18004)）

**sidekick との関連**: sidekick の citation 構造（出典+抜粋の構造化添付）は、この研究分野の「attributed generation」に該当する。ただし sidekick はエージェント間通信での citation であり、ユーザー向け最終出力の citation とは用途が異なる

### C-2. RAG with Citation（実用システム）

RAG システムにおける引用付き生成は広く実装されている:
- **ALCE フレームワーク**（Gao et al., 2023）: attribution、correctness、言語品質を評価する標準ベンチマーク。12件の研究で再利用（[サーベイ](https://arxiv.org/html/2508.15396v1)）
- **RAGentA**（SIGIR 2025 LiveRAG Challenge）: マルチエージェント RAG で attributed QA を実現（[arXiv:2506.16988](https://arxiv.org/html/2506.16988)）
- **FACTS Grounding**（Google DeepMind）: LLM の事実性と根拠付けを評価するベンチマーク。F1 スコアは最大 58.9%（[DeepMind](https://deepmind.google/blog/facts-grounding-a-new-benchmark-for-evaluating-the-factuality-of-large-language-models/)）

**sidekick との差分**: RAG の citation は「検索した文書への参照」。sidekick の citation は「前段ワーカーの出力から引用したエビデンス」。情報の出所が外部文書か先行タスクかという違い

### C-3. Self-RAG / In-Generation Attribution

- **Self-RAG**（Asai et al.）: 生成中に動的に検索を挟み、自己反省トークンで引用の妥当性を検証する
- **AGREE**: 生成中にリアルタイムで attribution を行う

**sidekick への示唆**: Self-RAG の「生成中の自己検証」メカニズムを、sidekick のワーカー実行中の citation 品質チェックに応用できる可能性がある

### C-4. Citation-Grounded Code Comprehension

- コード理解タスクで引用ベースの根拠付けを行う研究（[arXiv:2512.12117](https://www.arxiv.org/pdf/2512.12117)）
- **sidekick との関連**: sidekick のワーカーが実装タスクで「このファイルのこの行を根拠に変更した」と citation を付ける構造と直接関連

### C カテゴリまとめ

sidekick の citation 構造は学術研究の attributed generation と方向性が一致するが、**エージェント間通信のプロトコルとして citation を使う**という応用は新規性がある。既存研究は「LLM → ユーザー」の引用に集中しており、「エージェント → エージェント」のエビデンス伝播は未開拓領域。

---

## D. Claude Code エコシステム

Claude Code 上でマルチエージェントを実現するアプローチ群。

### D-1. Claude Code 公式機能

**サブエージェント**: 単一セッション内で軽量ワーカーを起動。結果のみ親に返り、ワーカー間の直接通信はない（[Claude Code Docs](https://code.claude.com/docs/en/agent-teams)）

**Agent Teams**（2026年2月〜、実験的）: 複数の Claude Code インスタンスが共有タスクリスト・メールボックスで協調。チームリードがタスクを分解し、チームメイトが自己割り当て。リード ↔ チームメイト、チームメイト ↔ チームメイト の直接通信が可能（[Claude Code Docs](https://code.claude.com/docs/en/agent-teams)）

**sidekick との差分**:
- Agent Teams はチームメイト間の自由なコミュニケーションを推奨。sidekick はオーケストレーター経由の統制された委譲
- Agent Teams はコンテキスト分離が弱い（CLAUDE.md やプロジェクト設定が暗黙的に継承される）。sidekick はワーカーにワークフロー定義のみをプロンプト注入し、親の設定漏洩を防ぐ
- Agent Teams にエビデンス構造はない。タスク結果はサマリとして返るのみ

**示唆**: Agent Teams は sidekick の上位互換ではなく、設計思想が異なる。Agent Teams は「協調的探索」に強く、sidekick は「統制された実行」に強い。用途に応じて使い分け可能

### D-2. Claude Squad

- URL: [https://github.com/smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad)
- tmux + git worktree で複数の Claude Code インスタンスを並列管理するターミナルアプリ。各タスクが独立ブランチ・独立ターミナルで実行される（[Claude Squad GitHub](https://github.com/smtg-ai/claude-squad)）
- **sidekick との差分**: Claude Squad はインフラ層（セッション管理、ブランチ分離）。ワークフロー定義、タスク入出力の構造化、エビデンス添付は提供しない。sidekick はアプリケーション層（何をどう実行するか）
- **示唆**: Claude Squad の git worktree 分離は、sidekick のワーカーが互いのファイル変更で干渉しないためのインフラとして補完的に使える

### D-3. Ruflo (旧 Claude Code Flow)

- URL: [https://github.com/ruvnet/ruflo](https://github.com/ruvnet/ruflo)
- Claude Code 上の包括的オーケストレーションプラットフォーム。54+ の専門エージェント、自己学習、ベクトルメモリ、RAG 統合。v3.5 で 259 MCP ツール、60+ エージェント（[Ruflo GitHub](https://github.com/ruvnet/ruflo)）
- **sidekick との差分**: Ruflo は「多機能プラットフォーム」アプローチ。sidekick は「最小限の宣言的定義」アプローチ。Ruflo にはドリフト防止、自動ルーティングなどがあるが、エビデンス構造やコンテキスト分離の明示的な設計はない
- **示唆**: Ruflo のドリフト防止（エージェントがタスクから逸脱するのを検知）は、sidekick のワーカー品質保証に応用可能。ただし Ruflo の複雑さは sidekick の設計哲学（宣言的・最小限）とは対極

### D-4. wshobson/agents

- URL: [https://github.com/wshobson/agents](https://github.com/wshobson/agents)
- 85 の専門エージェント、15 のオーケストレーター、47 のスキル、44 のツールを 63 プラグインに整理。Anthropic の Agent Skills 仕様に準拠（[wshobson/agents GitHub](https://github.com/wshobson/agents)）
- **sidekick との差分**: wshobson/agents はスキル・エージェントの「カタログ」。sidekick はスキルの「実行制御」。wshobson/agents はプログレッシブディスクロージャを謳うが、エージェント間のエビデンス伝播は提供しない
- **示唆**: プラグイン分類体系（27カテゴリ）は sidekick のスキル整理の参考になる

### D-5. その他のツール

- **Amux** ([https://github.com/mixpeek/amux](https://github.com/mixpeek/amux)): ブラウザ/モバイルから Claude Code エージェントを並列実行。インフラ層
- **Initech** ([https://github.com/nmelo/initech](https://github.com/nmelo/initech)): PTY ベースのターミナルマルチプレクサ。活動検知、IPC メッセージング
- **Auto-Claude** ([https://github.com/AndyMik90/Auto-Claude](https://github.com/AndyMik90/Auto-Claude)): カンバン UI でタスク完了まで自律実行。SDLC 全体をカバー
- **TSK** ([https://github.com/dtormoen/tsk](https://github.com/dtormoen/tsk)): Docker サンドボックスで AI エージェントタスクを並列実行し、git ブランチで結果を返す

**共通の差分**: いずれもエビデンス構造化やコンテキスト分離をアーキテクチャ原則として持たない

### D カテゴリまとめ

| ツール | レイヤー | ワークフロー定義 | コンテキスト分離 | エビデンス |
|---|---|---|---|---|
| CC Agent Teams | ランタイム | 自然言語 | 弱（設定継承） | -- |
| Claude Squad | インフラ | -- | git worktree | -- |
| Ruflo | プラットフォーム | MCP ツール | -- | -- |
| wshobson/agents | カタログ | スキル仕様 | -- | -- |
| **sidekick** | **アプリケーション** | **frontmatter MD** | **設計原則** | **citation 構造** |

---

## 総合分析

### sidekick の独自性

調査した約20のツール・フレームワーク・研究のいずれも、以下の3つを**同時に**提供していない:

1. **エージェント間エビデンス伝播**: 既存の citation 研究は LLM→ユーザーの出力に集中。エージェント→エージェントのエビデンス付きタスク委譲は未開拓（C カテゴリ分析より）
2. **アーキテクチャレベルのコンテキスト分離**: オーケストレーション系は共有 state やフリーな対話を前提とする。ワーカーへの情報開示を意図的に制限するのは sidekick のみ（B カテゴリ分析より）
3. **ファイル追加のみのワークフロー拡張**: 全オーケストレーション系が Python コードの変更を要求する（B カテゴリ分析より）

### sidekick に取り入れるべきアイデア

| アイデア | 出典ツール | 適用方法 |
|---|---|---|
| セマンティックバリデーション | Instructor | citation が主張を裏付けるか LLM で検証するステップを追加 |
| 条件分岐チェーン | LangGraph | frontmatter に `next-if:` のような条件付きチェーンを追加 |
| バリデータパイプライン | Guardrails AI | スキルの出力検証を合成可能なバリデータとして定義 |
| ドリフト防止 | Ruflo | ワーカーがタスクから逸脱していないか検知する仕組み |
| NLI ベース citation 検証 | ALCE / 学術研究 | citation の妥当性を NLI モデルで自動検証 |
| `.baml` 式テスト | BAML | スキル定義のテスト・プレイグラウンド機能 |

### sidekick の差別化を強化すべきポイント

1. **citation プロトコルの形式化**: 現在の citation 構造を、検証可能なスキーマとして公開する。ALCE のような評価フレームワークとの互換性を持たせる
2. **段階的開示の説明可能性**: なぜその情報をワーカーに渡したか/渡さなかったかをログに残す。これは競合にない独自機能になる
3. **ゼロコード拡張の訴求**: 「Markdown を足すだけ」という UX は全競合に対する明確な差別化。ドキュメントとデモで強調すべき
