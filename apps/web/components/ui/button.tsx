import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90",
        variant === "ghost" &&
          "border border-border bg-white/5 text-foreground hover:bg-white/10",
        className,
      )}
      type={type}
      {...props}
    />
  );
}
