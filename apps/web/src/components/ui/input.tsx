import { forwardRef, useId, type InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Field-level validation message; announced to screen readers. */
  error?: string;
  hint?: string;
}

/** Shared labeled text input with error/hint slots wired for a11y. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-xs font-bold text-fg">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={`h-11 rounded-xl border-[1.5px] bg-surface-raised px-3.5 text-sm font-medium text-fg placeholder:text-fg-muted transition-colors ${
          error ? 'border-danger' : 'border-border focus:border-accent'
        } ${className}`}
        {...rest}
      />
      {(error || hint) && (
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          className={`text-xs ${error ? 'text-danger' : 'text-fg-muted'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
});
