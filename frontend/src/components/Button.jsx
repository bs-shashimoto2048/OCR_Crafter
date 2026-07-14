import { forwardRef } from "react";

const variants = {
  primary: "bg-accent text-white shadow-[0_6px_18px_rgba(88,166,255,0.32)] hover:bg-[#79b8ff]",
  secondary: "bg-[#3a434d]/88 text-text border border-border/80 backdrop-blur-md hover:bg-[#45505b]/90",
  ghost: "bg-transparent text-muted hover:bg-[#3a434d]/65 hover:text-text",
  danger: "bg-danger text-white shadow-[0_6px_16px_rgba(248,81,73,0.28)] hover:bg-[#ff6a63]",
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
