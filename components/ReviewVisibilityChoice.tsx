"use client";

import {
  type ReviewVisibility,
  type ReviewAuthor,
} from "@/lib/reviewVisibility";

export default function ReviewVisibilityChoice({
  rating,
  value,
  onChange,
  idPrefix,
  reviewer = "client",
}: {
  rating: number;
  value: ReviewVisibility;
  onChange: (value: ReviewVisibility) => void;
  idPrefix: string;
  reviewer?: ReviewAuthor;
}) {
  // Every reviewer chooses, whatever the rating.
  if (rating === 0) return null;

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Who can see your review?</legend>
      {(
        [
          ["public", "Public", "Anyone can see this review."],
          [
            "private",
            "Private",
            reviewer === "provider"
              ? "Only this client can see it."
              : "Only your professional can see it.",
          ],
        ] as const
      ).map(([option, title, copy]) => (
        <label
          key={option}
          htmlFor={`${idPrefix}-${option}`}
          style={{
            ...choice,
            borderColor: value === option ? "#6D28D9" : "#E5E7EA",
            background: value === option ? "#F7F1FF" : "#FFFFFF",
          }}
        >
          <input
            id={`${idPrefix}-${option}`}
            type="radio"
            name={`${idPrefix}-visibility`}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            style={{ accentColor: "#6D28D9" }}
          />
          <span>
            <strong style={{ display: "block", color: "#16202A" }}>
              {title}
            </strong>
            <span style={{ color: "#7A828C", fontSize: 12.5 }}>{copy}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const fieldset: React.CSSProperties = {
  border: 0,
  padding: 0,
  margin: "0 0 14px",
  textAlign: "left",
};

const legend: React.CSSProperties = {
  color: "#16202A",
  fontSize: 13.5,
  fontWeight: 800,
  marginBottom: 8,
};

const choice: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
  border: "1.5px solid",
  borderRadius: 11,
  padding: "10px 11px",
  marginBottom: 7,
  cursor: "pointer",
  fontSize: 13.5,
  lineHeight: 1.35,
};

