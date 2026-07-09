// 実験機能配下の画面共通で表示する開発中案内。
// 対象画面の追加は App.jsx の EXPERIMENTAL_VIEWS に view id を足すだけでよい。
export default function ExperimentalNotice({ className = "" }) {
  return (
    <div
      role="note"
      className={`rounded-xl border border-amber-300/35 bg-amber-400/10 px-4 py-3 ${className}`}
    >
      <p className="text-sm font-semibold text-amber-100">🧪 実験機能</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-100/85">
        この機能は現在試験開発中です。仕様・画面構成・保存形式は今後変更される場合があります。
      </p>
    </div>
  );
}
