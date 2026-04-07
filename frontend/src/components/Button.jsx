import { forwardRef } from "react";

const variants = {
  primary: "bg-accent text-white hover:bg-blue-500",
  secondary: "bg-[#3b4654] text-text border border-border hover:bg-[#465362]",
  ghost: "bg-transparent text-muted hover:bg-[#3b4654] hover:text-text",
  danger: "bg-danger text-white hover:bg-red-500",
};

const sizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

const Button = forwardRef(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    className = "",
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

export default Button;
