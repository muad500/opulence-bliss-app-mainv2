"use client";
import { CLEANING_ADDONS, type VisitExtras } from "@/lib/cleaningExtras";
import {
  DEFAULT_CLEANING_BILLING_TERMS,
  type CleaningBillingTerms,
} from "@/lib/cleaningBillingTerms";
import styles from "./CleaningExtrasPicker.module.css";
export default function CleaningExtrasPicker({
  prices = DEFAULT_CLEANING_BILLING_TERMS,
  value,
  onChange,
  visits,
  overrides,
  onOverride,
}: {
  prices?: Pick<CleaningBillingTerms, "addonPrices" | "productsFeePence">;
  value: VisitExtras;
  onChange: (value: VisitExtras) => void;
  visits: number;
  overrides: Record<number, VisitExtras>;
  onOverride: (index: number, value: VisitExtras | null) => void;
}) {
  function fields(choice: VisitExtras, change: (value: VisitExtras) => void) {
    return (
      <>
        {CLEANING_ADDONS.map((item) => (
          <label key={item.id} className={styles.row}>
            <input
              type="checkbox"
              checked={choice.addons.includes(item.id)}
              onChange={(event) =>
                change({
                  ...choice,
                  addons: event.target.checked
                    ? [...choice.addons, item.id]
                    : choice.addons.filter((id) => id !== item.id),
                })
              }
            />
            <span>
              {item.label}
              <small>Up to 1 hour</small>
            </span>
            <strong>£{(prices.addonPrices[item.id] / 100).toFixed(2)}</strong>
          </label>
        ))}
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={choice.bringsProducts}
            onChange={(event) =>
              change({ ...choice, bringsProducts: event.target.checked })
            }
          />
          <span>
            Cleaner brings products
            <small>
              £{(prices.productsFeePence / 100).toFixed(2)} per visit ·
              equipment arranged separately
            </small>
          </span>
          <strong>£{(prices.productsFeePence / 100).toFixed(2)}</strong>
        </label>
      </>
    );
  }
  return (
    <section className={styles.card} aria-label="Cleaning add-ons">
      <h2>Add-ons &amp; products</h2>
      <p>
        Each add-on includes up to one extra hour. Cleaning and add-ons together
        must stay within 8 hours.
      </p>
      {visits > 1 && (
        <p>
          These choices apply to every visit. Adjust individual visits below
          before paying.
        </p>
      )}
      {fields(value, onChange)}
      {visits > 1 && (
        <details className={styles.visits}>
          <summary>Adjust individual visits</summary>
          {Array.from({ length: visits }, (_, index) => (
            <details key={index} className={styles.visit}>
              <summary>
                Visit {index + 1} ·{" "}
                {overrides[index] ? "Custom choices" : "Default choices"}
              </summary>
              {fields(overrides[index] ?? value, (choice) =>
                onOverride(index, choice),
              )}
              {overrides[index] && (
                <button type="button" onClick={() => onOverride(index, null)}>
                  Use default choices
                </button>
              )}
            </details>
          ))}
        </details>
      )}
    </section>
  );
}
