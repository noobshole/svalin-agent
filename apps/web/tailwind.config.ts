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
        accent: color("accent"),
        band: color("band"),
        footer: color("footer"),
        pale: color("pale"),
        paleSoft: color("pale-soft"),
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
        sans: ["var(--font-sans)", "Futura", "Century Gothic", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      fontSize: {
        xs: ["0.875rem", "1.25rem"],
        sm: ["1rem", "1.5rem"],
        base: ["1.125rem", "1.75rem"],
        lg: ["1.3125rem", "1.875rem"],
        xl: ["1.5rem", "2rem"],
      },
    },
  },
  plugins: [],
};

export default config;
