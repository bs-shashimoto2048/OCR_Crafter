/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#2b3138",
        card: "#343b44",
        border: "#626d79",
        text: "#e6edf3",
        muted: "#c2ccd8",
        accent: "#58a6ff",
        success: "#3fb950",
        danger: "#f85149",
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        card: "0 14px 28px rgba(20, 24, 28, 0.36)",
        glass: "0 20px 44px rgba(10, 14, 18, 0.38)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
