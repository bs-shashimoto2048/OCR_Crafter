// 管理No（M0001形式・通しナンバー）の共通表示コンポーネント。
// 一覧・モデルカルテ・モデル比較の全画面でフォント（等幅スタック）と見た目を統一する。
// スタイル実体は index.css の .model-id-badge / .model-id-font（サイズ・色・最低幅の定義）。
//
// size:
//   sm = モデル一覧（12px/600・バッジ背景・最低幅48px）
//   md = モデルカルテ・比較表の列見出し（13px/600・バッジ背景）
//   lg = 比較カード・推奨モデルの主表示（16px/700・バッジ背景なし）
// color:
//   比較画面のモデル識別色（ブルー/オレンジ/パープル）を指定すると、バッジ背景なしの
//   色付きテキスト表示になる（識別色が主役のためバッジ装飾と併用しない。フォントは共通）。

const BADGE_CLASSES = {
  sm: "model-id-badge",
  md: "model-id-badge model-id-badge--md",
};

const TEXT_CLASSES = {
  sm: "model-id-font model-id-text--sm",
  md: "model-id-font model-id-text--md",
  lg: "model-id-font model-id-text--lg",
};

export default function ModelIdBadge({ modelId, size = "sm", color = "", title = "", className = "" }) {
  const id = String(modelId || "");
  if (!id) return null;
  // 識別色指定時・lgはバッジ背景なしのテキスト表示（フォントスタックは共通）
  const asText = Boolean(color) || size === "lg";
  const base = asText ? TEXT_CLASSES[size] || TEXT_CLASSES.md : BADGE_CLASSES[size] || BADGE_CLASSES.sm;
  return (
    <span
      className={className ? `${base} ${className}` : base}
      style={color ? { color } : undefined}
      title={title || undefined}
    >
      {id}
    </span>
  );
}
