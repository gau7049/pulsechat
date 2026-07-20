/** Accessible toggle switch primitive. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Shows a spinner on the thumb instead of just dimming — use while an
   * onChange side effect (e.g. a network call) is still in flight. */
  busy?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-4 py-2 ${disabled && !busy ? 'opacity-50' : ''}`}
    >
      <span>
        <span className="block text-sm font-semibold text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-busy={busy}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-fg-muted/30'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 flex size-5 items-center justify-center rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        >
          {busy && (
            <span className="size-3 animate-spin rounded-full border-2 border-fg-muted/30 border-t-accent" />
          )}
        </span>
      </button>
    </label>
  );
}
