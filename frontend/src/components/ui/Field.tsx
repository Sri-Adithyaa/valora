import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

interface FieldShellProps {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  id: string;
  children: ReactNode;
  trailing?: ReactNode;
}

function FieldShell({ label, error, hint, id, children, trailing }: FieldShellProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink-800">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] font-medium text-loss" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  trailing?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, trailing, id, className = "", ...rest },
  ref,
) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} id={fid} trailing={trailing}>
      <input
        ref={ref}
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={`input ${className}`}
        {...rest}
      />
    </FieldShell>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
}

export function SelectField({ label, error, hint, id, className = "", children, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} id={fid}>
      <select
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-error` : hint ? `${fid}-hint` : undefined}
        className={`input appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235f6772%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9 ${className}`}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

/** Form-level error banner (API `message`). */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-loss/25 bg-loss-50 px-3.5 py-2.5 text-sm font-medium text-loss">
      {message}
    </div>
  );
}
