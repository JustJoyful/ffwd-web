import { useId } from "react";

/**
 * The one-sentence chore. Enter submits, Shift+Enter adds a line. The field wraps and grows, so a long request is
 * never cut off.
 * `hint` is a sentence under the field saying why it cannot be sent yet; the field points to it for screen readers.
 * @param {{ value: string, onChange(v: string): void, onSubmit(v: string): void, locked: boolean, canSubmit?: boolean, hint?: string | null, inputRef?: import("react").Ref<HTMLTextAreaElement>, submitLabel?: string }} props
 */
export default function RequestField({
  value,
  onChange,
  onSubmit,
  locked,
  canSubmit = true,
  hint = null,
  inputRef,
  submitLabel = "Make a plan",
}) {
  const id = useId();
  const go = () => {
    if (!locked && canSubmit && value.trim()) onSubmit(value.trim());
  };
  return (
    <div className="request">
      <label className="sr" htmlFor={id}>
        What should happen to your video?
      </label>
      <textarea
        id={id}
        ref={inputRef}
        className="ask ask--field"
        rows={2}
        value={value}
        readOnly={locked}
        aria-readonly={locked || undefined}
        aria-describedby={
          hint ? `${id}-hint` : locked ? undefined : `${id}-tip`
        }
        placeholder="For example: cut the first 3 seconds"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            go();
          }
        }}
      />
      {!locked && (
        <p className="step__hint request__tip" id={`${id}-tip`}>
          Works best with clear requests like &lsquo;cut the first 3
          seconds&rsquo; or &lsquo;make it 720p&rsquo;. Vague requests may need
          rewording.
        </p>
      )}
      {hint && (
        <p className="step__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {!locked && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={!canSubmit || !value.trim()}
          onClick={go}
        >
          {submitLabel}
        </button>
      )}
    </div>
  );
}
