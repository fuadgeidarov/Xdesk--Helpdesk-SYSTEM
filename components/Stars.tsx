"use client";

type Props = {
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
};

export function Stars({ value, onChange, readOnly }: Props) {
  return (
    <div className="stars" aria-label={`Оценка ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? "active" : undefined}
          onClick={() => !readOnly && onChange?.(n)}
          disabled={readOnly}
          aria-label={`${n}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
