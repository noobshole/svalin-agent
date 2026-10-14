import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    
    "./lib/**/*.{ts,tsx}",
    
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: "hsl(var(--card) / <alpha-value>)",
        cardForeground: "hsl(var(--card-foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        primary: "hsl(var(--primary) / <alpha-value>)",
        primaryForeground: "hsl(var(--primary-foreground) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        mutedForeground: "hsl(var(--muted-foreground) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
      },
      borderRadius: {
        lg: "1rem",
        md: "0.75rem",
        sm: "0.5rem",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(45, 212, 191, 0.16), 0 24px 80px rgba(8, 145, 178, 0.18)",
      },
    },
  },
  plugins: [],
};

export default config;
