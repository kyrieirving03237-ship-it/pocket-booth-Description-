# MacでPocket BoothをCloudflareへ公開する

GitHubへのソース反映は完了しています。ここでは**既存デモを残したまま、別名のCloudflare Workerを新規公開**します。

既存デモ： https://pocket-booth.b7684wyb9p.chatgpt.site/

## 1. ソースをMacにダウンロードする

1. Safariで以下を開きます。
   https://github.com/kyrieirving03237-ship-it/pocket-booth-Description-
2. 緑色の「Code」を押します。
3. 「Download ZIP」を押します。
4. Finderの「ダウンロード」を開き、ZIPをダブルクリックして展開します。フォルダ内に`dist`、`package.json`、`package-lock.json`、`wrangler.portfolio.jsonc`があることを確認します。

前にダウンロードしたZIPではなく、今回更新したリポジトリから取り直してください。

## 2. ターミナルを開く

1. キーボードの **⌘ + スペース** を押します。
2. 「ターミナル」と入力し、Returnを押します。
3. 次の2つを1行ずつ入力し、その都度Returnを押します。

```sh
node -v
```

```sh
npm -v
```

Nodeが`v22`以上で、npmもバージョン番号が出れば次へ進めます。

「command not found」と出た場合は、 https://nodejs.org/ を開き、**LTS（推奨版）のmacOSインストーラー**をインストールしてください。その後ターミナルを閉じて開き直し、上の2つをもう一度実行します。

## 3. アプリのフォルダへ移動する

1. ターミナルに `cd ` と入力します。`cd`の後ろに半角スペースを1つ入れ、まだReturnは押しません。
2. Finderから、手順1で展開したアプリのフォルダを、ターミナルの画面へドラッグします。
3. フォルダの場所が入力されたらReturnを押します。
4. 確認のため次を実行します。

```sh
ls
```

`dist`、`package.json`、`package-lock.json`、`wrangler.portfolio.jsonc`が表示されれば正しい場所です。`docs`や`dist`の中ではなく、それらを含む一番外側のアプリフォルダを使います。

## 4. 公開ツールをインストールする

次をコピーして実行します。

```sh
npm ci
```

完了して入力できる状態に戻るまで待ちます。これはMac内に開発・公開ツールを入れる操作です。まだ公開はされません。

## 5. MacからCloudflareにログインする

```sh
npx wrangler login --use-keyring
```

1. ブラウザが開いたら、目的のCloudflareアカウントでログインします。
2. アカウントは今回確認したご本人のアカウントを選びます。
3. 許可画面でWorkersの読み取り・書き込みを含む権限を許可します。「閲覧のみ」に絞らないでください。任意権限の編集画面がある場合は、Workersの作成・更新に必要な権限が外れていないか確認します。
4. 許可後、ターミナルに戻ります。

これはChatGPTの接続を再認証する操作ではなく、Mac上のWranglerを認証する操作です。APIトークンをチャットに貼る必要はありません。

## 6. ログイン先を確認する

```sh
npx wrangler whoami
```

表示されたアカウントに以下が含まれることを確認します。

```text
5918b8658076bae89861ac6fb3db19dc
```

違うアカウントしか表示されない場合は、そのままデプロイせず、ログインしたアカウントを確認してください。配布設定もこのAccount IDへ固定しています。

## 7. 公開せずに内容を確認する

```sh
npx wrangler deploy --dry-run --config wrangler.portfolio.jsonc
```

エラーなく終了すれば、設定とファイルの準備ができています。`--dry-run`なのでまだ公開しません。

こちらではWrangler **4.153.0** / Node **24.19.0**で、18個の静的ファイルを読み込むdry-runが成功しています。

## 8. 新しい公開先へデプロイする

```sh
npx wrangler deploy --config wrangler.portfolio.jsonc
```

この設定の公開名は以下です。

```text
pocket-booth-portfolio-20261027
```

調査時点のCloudflare Worker一覧には、この名前は存在しませんでした。既存の`jikanbo`、`ai-brawl-*`、`noctiluca-city`やSitesのデモとは別名です。もし同名の既存Workerを上書きする確認が出た場合は、進めずにその表示を教えてください。

成功するとターミナルに`https://...workers.dev`というURLが表示されます。そのURLをSafariで開きます。

## 9. 動作を確認する

1. 「新しい曲」を作る。
2. 「＋」から「デモビートで試す」を選ぶ。
3. 再生する。
4. 録音する場合はマイクを許可し、短く声を録って再生する。

新しいURLは既存デモとは別の保存場所です。前の曲が自動で移ることはありません。移したい場合は既存デモのメニューからバックアップを保存し、新しいURLで復元します。既存デモのデータを消す必要はありません。

## 10. 新しいURLを送る

成功時に表示された`https://...workers.dev`のURLを送ってください。公開を確認してから、そのURL向けのQRコードと紹介素材を更新できます。今のQRは既存の公開デモへつながるままなので、引き続き使用できます。

## エラーが出たとき

コマンド全体を何度も繰り返さず、止まった手順番号と、エラー文を送ってください。

- `node: command not found` → 手順2のNode.js導入を確認。
- `npm ci`で`package-lock.json`がない → GitHubから最新ZIPを取り直し、フォルダの場所を確認。
- `Authentication error` / `Missing scope` → `wrangler whoami`でアカウントと権限を確認。ChatGPTではなくMac側のWrangler認証を確認する。
- 同名Workerの上書き確認 → 進めない。別名の新規公開先を選ぶ。

不要な削除、強制push、既存デモの上書きは、この手順に含まれていません。
