import { useId } from "react";

/**
 * The one-sentence chore. Enter submits, Shift+Enter adds a line. The field wraps and grows, so a long request is
 * never cut off.
 * @param {{ value: string, onChange(v: string): void, onSubmit(v: string): void, locked: boolean, canSubmit?: boolean, inputRef?: import("react").Ref<HTMLTextAreaElement>, submitLabel?: string }} props
 */
export default function RequestField({
  value,
  onChange,
  onSubmit,
  locked,
  canSubmit = true,
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
