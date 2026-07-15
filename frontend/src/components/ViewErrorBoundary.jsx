import { Component } from "react";

import Button from "./Button";

// 画面単位のError Boundary。1画面のレンダリング例外でアプリ全体が黒画面になるのを防ぐ。
// App側で key={activeView} を付けて使うことで、画面切替時に自動でエラー状態がリセットされる。
export default class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 調査用にコンソールへ残す（画面には概要のみ表示）
    console.error(`画面「${this.props.viewName || "-"}」の表示中にエラーが発生しました:`, error, info?.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="flex h-[calc(100vh-238px)] min-h-[320px] items-center justify-center">
        <div className="max-w-lg space-y-3 rounded-xl border border-danger/40 bg-danger/10 p-6 text-center">
          <p className="text-sm font-semibold text-red-200">
            {this.props.viewName ? `${this.props.viewName}の` : ""}画面の表示中にエラーが発生しました。
          </p>
          <p className="break-all font-mono text-xs text-red-300/80">{String(this.state.error?.message || this.state.error)}</p>
          <div className="flex justify-center gap-2">
            <Button size="sm" onClick={() => window.location.reload()}>
              再読み込み
            </Button>
            <Button size="sm" variant="secondary" onClick={() => this.props.onBackToDashboard?.()}>
              ダッシュボードへ戻る
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
