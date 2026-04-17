/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#0f0f0f",
        surface: "#1c1c1e",
        border: "#2c2c2e",
        primary: "#3b82f6",
        "primary-foreground": "#ffffff",
        muted: "#6b7280",
        "muted-foreground": "#9ca3af",
        accent: "#1e40af",
        destructive: "#ef4444",
        "destructive-foreground": "#ffffff",
        foreground: "#f9fafb",
        "card-bg": "#1c1c1e",
      },
    },
  },
  plugins: [],
};
