// OCR学習画面の状態導出・ログ解析の共通ロジック（UI非依存の純関数）。
//
// バックエンドのジョブ状態は queued/running/completed/failed/stopped。
// UIでは意味が明確な7状態（idle/preparing/training/stopping/completed/failed/cancelled）へ写像する。
// running でもログに iteration 行が現れるまでは「学習準備中」（データ確認・traineddata展開等）として扱う。

export const UI_TRAINING_STATES = [
  "idle",
  "preparing",
  "training",
  "stopping",
  "completed",
  "failed",
  "cancelled",
];

export const UI_TRAINING_STATE_LABELS = {
  idle: "未開始",
  preparing: "学習準備中",
  training: "学習中",
  stopping: "停止処理中",
  completed: "完了",
  failed: "失敗",
  cancelled: "停止済み",
  unknown: "状態不明",
};

export function deriveUiTrainingState(jobStatus, { hasIterationLog = false, stopRequested = false } = {}) {
  if (stopRequested) {
    return "stopping";
  }
  switch (jobStatus) {
    case "queued":
      return "preparing";
    case "running":
      return hasIterationLog ? "training" : "preparing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "cancelled";
    default:
      // 予期しない状態は idle へ偽装せず「状態不明」として表示する（未指定・idle のみ未開始）
      return !jobStatus || jobStatus === "idle" ? "idle" : "unknown";
  }
}

// ログ行頭の [YYYY/MM/DD hh:mm:ss] をエポックms（ローカル時刻）へ。無ければ null
export function parseLogTimestamp(line) {
  const match = String(line || "").match(/\[(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})\]/);
  if (!match) {
    return null;
  }
  const [, y, m, d, hh, mm, ss] = match;
  const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  const value = parsed.getTime();
  return Number.isFinite(value) ? value : null;
}

// ログ行頭の時刻表示（hh:mm:ss）。無ければ null
export function extractLogTimeLabel(line) {
  const match = String(line || "").match(/\[\d{4}\/\d{2}\/\d{2} (\d{2}:\d{2}:\d{2})\]/);
  return match ? match[1] : null;
}

// 学習ログから進捗情報を抽出する。
// - Tesseract: "At iteration a/b/c" の b（累積学習iteration）を現在値とする
// - PaddleOCR: "epoch: [cur/total]" を現在値・最大値とする
// 戻り値: { iteration, maxFromLog, bcer, checkpoint, samples: [{timeMs, iteration}] }
export function parseTrainingProgress(lines) {
  let iteration = null;
  let maxFromLog = null;
  let bcer = null;
  let checkpoint = null;
  const samples = [];
  for (const raw of lines || []) {
    const line = String(raw || "");
    const timeMs = parseLogTimestamp(line);

    const tess = line.match(/At iteration\s+\d+\/(\d+)\/\d+/i);
    if (tess) {
      iteration = Number(tess[1]);
      if (timeMs !== null) {
        samples.push({ timeMs, iteration });
      }
    }

    const paddle = line.match(/epoch:\s*\[(\d+)\/(\d+)\]/i);
    if (paddle) {
      iteration = Number(paddle[1]);
      maxFromLog = Number(paddle[2]);
      if (timeMs !== null) {
        samples.push({ timeMs, iteration });
      }
    }

    const bcerMatch = line.match(/BCER train=([\d.]+)%/i);
    if (bcerMatch) {
      bcer = Number(bcerMatch[1]);
    }

    const ckpt = line.match(/([^\\/\s]+\.checkpoint)/i);
    if (ckpt) {
      checkpoint = ckpt[1];
    }
  }
  return { iteration, maxFromLog, bcer, checkpoint, samples };
}

// 進捗率（0〜100）。どちらかが不明なら null（不確かな進捗を出さない）
export function computeProgressPercent(iteration, maxIterations) {
  if (iteration === null || iteration === undefined || maxIterations === null || maxIterations === undefined) {
    return null; // Number(null)=0 による「進捗0%」の偽装を防ぐ
  }
  const current = Number(iteration);
  const max = Number(maxIterations);
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0 || current < 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (current / max) * 100));
}

// iteration の進行速度（ログ時刻ベース）から残り秒数を推定。根拠が無ければ null
export function computeEtaSeconds(samples, maxIterations) {
  const max = Number(maxIterations);
  const valid = (samples || []).filter(
    (s) => Number.isFinite(s?.timeMs) && Number.isFinite(s?.iteration)
  );
  if (!Number.isFinite(max) || max <= 0 || valid.length < 2) {
    return null;
  }
  const first = valid[0];
  const last = valid[valid.length - 1];
  const iterDelta = last.iteration - first.iteration;
  const timeDeltaSec = (last.timeMs - first.timeMs) / 1000;
  if (iterDelta <= 0 || timeDeltaSec <= 0) {
    return null;
  }
  const remaining = Math.max(0, max - last.iteration);
  return Math.round(remaining / (iterDelta / timeDeltaSec));
}

// 秒数 → 「1時間12分」「18分42秒」「42秒」。null は "--"
export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(Number(totalSeconds)) || totalSeconds < 0) {
    return "--";
  }
  const sec = Math.round(Number(totalSeconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}時間${minutes}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

// ログ行の分類（詳細ログの色分け・フィルタ用）
export function classifyLogLine(line) {
  const text = String(line || "").toLowerCase();
  if (/(failed|error|exception|失敗|例外|エラー)/.test(text)) {
    return "error";
  }
  if (/(warning|警告|missing|0件)/.test(text)) {
    return "warn";
  }
  if (/(completed|success|完了|登録しました)/.test(text)) {
    return "success";
  }
  return "info";
}

// 重要イベント判定パターン（生のコマンド全文・ファイル列挙は含めない）
const IMPORTANT_PATTERNS = [
  /at iteration\s+\d/i, // iteration到達（BCER・checkpoint保存を含む行）
  /bcer|bwer|\bcer\b/i, // 評価値
  /checkpoint/i,
  /traineddata/i,
  /lstmtraining/i, // 学習コマンド起動
  /train\/eval|train\/val|分割/i,
  /extracting|展開/i,
  /データ(セット)?作成|dataset/i,
  /モデル(を)?登録|registered/i,
  /学習ステータス|開始要求|学習設定/,
  /completed|failed|stopped|完了|失敗|停止|エラー|error|警告|warning/i,
];

export function isImportantLogLine(line) {
  const text = String(line || "");
  if (!text.trim()) {
    return false;
  }
  return IMPORTANT_PATTERNS.some((pattern) => pattern.test(text));
}

// 重要イベントの抽出: [{ time, text }]（time はログに時刻があれば hh:mm:ss）
export function extractImportantEvents(lines) {
  const events = [];
  for (const raw of lines || []) {
    const line = String(raw || "");
    if (!isImportantLogLine(line)) {
      continue;
    }
    const time = extractLogTimeLabel(line);
    // 行頭のタイムスタンプは列として出すため本文から除去
    const text = line.replace(/^\[\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\]\s*/, "").trim();
    if (text) {
      events.push({ time, text });
    }
  }
  return events;
}

// Windowsパス等を除去して短くする（重要イベント表示用。全文は詳細ログで確認できる）
function stripPaths(text) {
  return String(text || "")
    .replace(/[A-Za-z]:[\\/][^\s,]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// 生ログ1行を利用者向けの短い日本語イベントへ整形する。
// 戻り値: { kind: 種別（短い日本語）, details: 表示行の配列（2〜3行まで） }
export function summarizeEventText(text, maxIterations = null) {
  const line = String(text || "");

  // Tesseract: At iteration a/b/c, mean rms=..., BCER train=..., (New best BCER = V wrote best model:...)
  const iter = line.match(/At iteration\s+\d+\/(\d+)\/\d+/i);
  if (iter) {
    const current = Number(iter[1]);
    const bcerTrain = line.match(/BCER train=([\d.]+)%/i);
    const bcerEval = line.match(/BCER eval=([\d.]+)%/i);
    const newBest = line.match(/New best BCER\s*=\s*([\d.]+)/i);
    const wroteCheckpoint = /checkpoint/i.test(line);
    const details = [
      `iteration ${current.toLocaleString()}${maxIterations ? ` / ${Number(maxIterations).toLocaleString()}` : ""}`,
    ];
    if (bcerTrain) details.push(`BCER train: ${bcerTrain[1]}%`);
    if (bcerEval) details.push(`BCER eval: ${bcerEval[1]}%`);
    if (newBest && details.length < 3) details.push(`最良BCER: ${newBest[1]}%${wroteCheckpoint ? "（checkpoint保存）" : ""}`);
    return { kind: newBest ? "最良モデル更新" : "学習進捗", details: details.slice(0, 3) };
  }

  // Tesseract: 2 Percent improvement time=127, best error was 4.069 @ 1044
  const improve = line.match(/Percent improvement time=(\d+).*best error was ([\d.]+)\s*@\s*(\d+)/i);
  if (improve) {
    return {
      kind: "評価改善",
      details: [`最良誤差: ${improve[2]}%`, `処理時間: ${improve[1]}秒`, `iteration: ${Number(improve[3]).toLocaleString()}`],
    };
  }

  // PaddleOCR: epoch: [n/m] ...
  const epoch = line.match(/epoch:\s*\[(\d+)\/(\d+)\]/i);
  if (epoch) {
    return { kind: "学習進捗", details: [`epoch ${epoch[1]} / ${epoch[2]}`] };
  }

  if (/Extracting|展開/i.test(line) && /traineddata|components/i.test(line)) {
    return { kind: "ベースモデル展開", details: [] };
  }
  if (/lstmtraining/i.test(line)) {
    return { kind: "学習コマンド起動", details: ["lstmtraining を開始しました"] };
  }
  if (/traineddata/i.test(line) && /(生成|作成|combine|wrote)/i.test(line)) {
    return { kind: "traineddata生成", details: [] };
  }
  if (/(completed|完了)/i.test(line)) {
    return { kind: "完了", details: [stripPaths(line)].filter(Boolean).slice(0, 2) };
  }
  if (/(stopped|停止)/i.test(line)) {
    return { kind: "停止", details: [stripPaths(line)].filter(Boolean).slice(0, 2) };
  }
  if (/(failed|error|失敗|エラー|例外)/i.test(line)) {
    return { kind: "エラー", details: [stripPaths(line)].filter(Boolean).slice(0, 3) };
  }
  if (/学習ステータス/.test(line)) {
    return { kind: "ステータス変更", details: [line.replace(/^学習ステータス:\s*/, "")] };
  }

  // その他の重要行: パスを除去し120文字までに短縮
  const cleaned = stripPaths(line);
  return { kind: "イベント", details: cleaned ? [cleaned.slice(0, 120)] : [] };
}

// 縦型タイムライン用: 重要イベントを整形して返す [{ time, kind, details, level }]
export function summarizeImportantEvents(lines, maxIterations = null) {
  return extractImportantEvents(lines).map(({ time, text }) => ({
    time,
    level: classifyLogLine(text),
    ...summarizeEventText(text, maxIterations),
  }));
}
