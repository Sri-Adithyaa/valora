import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "dark" | "secondary" | "ghost" | "danger" | "light";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-money-600 text-white hover:bg-money-700 active:bg-money-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] disabled:bg-money-600/45",
  dark: "bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950 disabled:bg-ink-900/40",
  secondary:
    "border border-ink-200 bg-white text-ink-800 hover:border-ink-300 hover:bg-ink-50 disabled:text-ink-400 disabled:bg-white",
  ghost: "text-ink-700 hover:bg-ink-100 disabled:text-ink-400",
  danger: "bg-loss text-white hover:bg-[#a92e25] disabled:bg-loss/45",
  light: "bg-white text-ink-900 hover:bg-ink-100 disabled:bg-white/60",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-[15px] gap-2",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors select-none ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, block = false, className = "", children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, `${block ? "w-full" : ""} ${className}`)}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
