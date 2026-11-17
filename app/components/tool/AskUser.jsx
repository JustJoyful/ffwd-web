import { useEffect, useId, useRef, useState } from "react";

/**
 * The model's one clarifying question, with suggested answers and a free-text field. Replaces the plan until answered.
 * @param {{ question: string, suggestions?: string[], onAnswer(text: string): void }} props
 */
export default function AskUser({ question, suggestions = [], onAnswer }) {
  const id = useId();
  const [text, setText] = useState("");
  const box = useRef(null);
  // the question replaces the plan: the person answers with the keyboard where they are
  useEffect(() => box.current?.focus(), []);
  const send = (t) => t.trim() && onAnswer(t.trim());
  return (
    <div className="questions">
      <p className="ask" id={`${id}-q`}>
        {question}
      </p>
      {suggestions.length > 0 && (
        <ul className="suggest" aria-label="Suggested answers">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => send(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="request">
        <input
          className="ask ask--field"
          ref={box}
          type="text"
          placeholder="Type your answer"
          aria-labelledby={`${id}-q`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={!text.trim()}
          onClick={() => send(text)}
        >
          Answer
        </button>
      </div>
    </div>
  );
}
