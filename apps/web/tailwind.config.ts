import type { Config } from "tailwindcss";

const color = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: color("background"),
        surface: color("surface"),
        surface2: color("surface-2"),
        foreground: color("foreground"),
        mutedForeground: color("muted-foreground"),
        subtleForeground: color("subtle-foreground"),
        border: color("border"),
        borderStrong: color("border-strong"),
        primary: color("primary"),
        primaryForeground: color("primary-foreground"),
        riskLow: color("risk-low"),
        riskMedium: color("risk-medium"),
        riskHigh: color("risk-high"),
        riskInfo: color("risk-info"),
        exposure1: color("exposure-1"),
        exposure2: color("exposure-2"),
        exposure3: color("exposure-3"),
        exposure4: color("exposure-4"),
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "ui-serif", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
    },
  },
  plugins: [],
};

export default config;
