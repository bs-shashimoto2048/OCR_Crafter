/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#1e242b",
        card: "#2b333e",
        border: "#45515f",
        text: "#f2f6fb",
        muted: "#c1cad5",
        accent: "#3b82f6",
        success: "#22c55e",
        danger: "#ef4444",
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        card: "0 10px 30px rgba(0, 0, 0, 0.25)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
