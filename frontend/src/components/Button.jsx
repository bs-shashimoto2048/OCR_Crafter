import { forwardRef } from "react";

// 操作の重要度で配色を使い分ける（すべて同色にしない）:
// primary=主要操作（既存アクセント維持）/ secondary=通常操作（カード・入力欄と同化しない明るめslate）/
// danger=破壊的操作（赤系。枠線つきでカード背景から浮かせる）
const variants = {
  primary: "bg-accent text-white shadow-[0_6px_18px_rgba(88,166,255,0.32)] hover:bg-[#79b8ff]",
  secondary:
    "border border-slate-500 bg-slate-700/90 text-slate-100 backdrop-blur-md hover:border-slate-400 hover:bg-slate-600/90",
  ghost: "bg-transparent text-muted hover:bg-[#3a434d]/65 hover:text-text",
  danger: "border border-red-600 bg-red-900/40 text-red-200 hover:bg-red-800/60",
};

const sizes = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3.5 text-sm",
  lg: "h-9 px-4 text-sm",
};

const Button = forwardRef(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    className = "",
    type = "button",
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

export default Button;
