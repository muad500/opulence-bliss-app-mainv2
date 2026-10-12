import styles from "./LoadingState.module.css";

export default function LoadingState({
  title = "Loading your page",
  detail = "Getting everything ready…",
  compact = false,
}: {
  title?: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <section
      className={`${styles.loading} ${compact ? styles.compact : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={styles.heading}>
        <span className={styles.spinner} aria-hidden="true" />
        <div>
          <strong>{title}</strong>
          <p>{detail}</p>
        </div>
      </div>
      {!compact && (
        <div className={styles.skeleton} aria-hidden="true">
          <div className={styles.line} />
          <div className={styles.shortLine} />
          <div className={styles.cards}>
            <div />
            <div />
          </div>
        </div>
      )}
    </section>
  );
}
