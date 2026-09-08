# 朝夕ボード（cog-workboard）改善依頼プロンプト

## これは何か
社内向けタスク管理ツール「朝夕ボード」。GitHub Pages + Firebase Realtime Database + Firebase Authenticationで動く、ビルド不要の素のHTML/JS/CSS（フレームワーク・バンドラなし）。

- 公開URL: https://error-405-forbidden.github.io/cog-workboard/
- リポジトリ: https://github.com/error-405-forbidden/cog-workboard（mainブランチ直下がそのままGitHub Pagesで配信される）

## ファイル構成
- `index.html` — メインツール。Google認証（許可メールアドレスのみ）でログインし、タスクボード（5列カンバン＋日付ピッカーの日次ビュー）とサイトメモ（案件ごとの申し送り事項タイムライン）を使える。
- `notes.html` — 上記のうち「サイトメモ」と、新設した「外注さん」（外注スタッフのプロフィール管理）だけを切り出した共有用ページ。ログイン画面なし（Firebase匿名認証を自動実行してからDBに接続）。リンクを知っている人なら誰でも閲覧・編集・コメント（ログ）ができる想定。
- `robots.txt` — サイト全体を`Disallow: /`（検索インデックス対策）。

## データ構造（Firebase Realtime Database）
Firestore風のAPI（`collection().add/get/onSnapshot`、`doc().update/delete`）を、Realtime Database用の自作シムでラップして両ファイルから使っている（index.html内に実装、notes.htmlは直接`rtdb.ref(...)`を使用しておりシムなし＝ここが不統一）。

- `tasks` — タスクボードのタスク。ログイン必須（許可アドレスのみread/write）。
- `siteNotes` — 旧サイトメモ（サイト単位のネスト構造）。現在は読み書きされていない残骸データ。
- `siteMemos` — 現行サイトメモ（1件=1ドキュメントのフラット時系列）。`{projectTag,text,date,author,createdAt}`。read/writeとも`auth != null`（匿名可）。
- `siteMemoComments` — サイトメモへの返信コメント。`{memoId,text,author,createdAt}`。同上。
- `staffProfiles` — 外注さん1人=1ドキュメント。`{name,profile,currentWork,nextRequestDate,updatedAt}`。同上。
- `staffNotes` — 外注さんごとのやり取りログ。`{staffId,text,author,createdAt}`。同上。

## 経緯・現状の粗さ（改善してほしい観点の例）
このツールは会話しながら機能追加を重ねてきたため、以下のような粗さが残っている：

1. **index.htmlとnotes.htmlでロジックが重複・乖離している。**
   - notes.htmlにだけ「編集」「コメント（ログ）」機能があり、index.html側のサイトメモにはまだ移植されていない。
   - notes.html内でも、サイトメモ（`renderHistory`まわり）と外注さん（`renderStaff`まわり）で、ほぼ同じ「編集フォーム」「削除の2回クリック確認」「コメント/ログスレッド」パターンをコピペで3回近く書いており、共通化されていない。
2. **notes.htmlはFirestore風シムを使わず`rtdb.ref()`を直接呼んでいる**（index.htmlは自作シム経由）。統一されていない。
3. **CSSがstyleタグ内にベタ書き**（クラスは整理されているが、コンポーネント化されていない）。一部インラインstyle属性も混在。
4. 削除確認は「もう一度クリックで確定」という自前パターン（`window.confirm`が使えない環境向けに元々作った名残。notes.html/index.htmlは通常のブラウザで動くので本来は`confirm()`も使えるが、UIの統一感のためこの自前パターンを踏襲している）。
5. テスト・型チェックの類は一切なし。手動でのpush→GitHub Pagesビルド確認→ブラウザ確認、というフローのみ。
6. Firebase Security Rulesは`siteMemos`/`siteMemoComments`/`staffProfiles`/`staffNotes`が「匿名認証さえしていれば誰でもread/write可能」という緩い設計（リンクの秘匿性に依存）。`tasks`/`siteNotes`のみメールアドレス許可制。

## お願いしたいこと
上記を踏まえて、**既存の見た目・挙動・データ構造（Firebaseのフィールド名など）は変えずに**、コードの品質・保守性を改善してほしい。具体的には：

- index.html / notes.html 間、および notes.html 内の重複ロジック（編集フォーム／削除確認／コメント・ログスレッド）の共通化
- 可能であれば notes.html も Firestore風シム経由に統一
- バグがあれば指摘・修正（特に、ライブ更新中に編集フォームが開いている場合の競合、削除確認タイマーの掃除漏れなど）
- 大きな構造変更（フレームワーク導入、ビルドツール導入など）は提案のみに留め、勝手に実行しない（ビルド不要・GitHub Pagesにそのまま置ける状態を維持したいため）

不明点があれば実装前に確認してください。
