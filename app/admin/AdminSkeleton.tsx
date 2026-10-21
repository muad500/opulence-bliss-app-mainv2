import styles from "./AdminSkeleton.module.css";

export default function AdminSkeleton({
  compact = false,
  label = "Loading admin page",
}: {
  compact?: boolean;
  label?: string;
}) {
  return (
    <section
      className={compact ? styles.compact : styles.page}
      role="status"
      aria-label={label}
      aria-busy="true"
      aria-live="polite"
    >
      <span className={styles.srOnly}>{label}</span>
      <div aria-hidden="true">
        {!compact && (
          <>
            <div className={`${styles.block} ${styles.title}`} />
            <div className={`${styles.block} ${styles.subtitle}`} />
            <div className={styles.stats}>
              {[0, 1, 2, 3].map((item) => (
                <div className={styles.card} key={item}>
                  <div className={`${styles.block} ${styles.short}`} />
                  <div className={`${styles.block} ${styles.value}`} />
                </div>
              ))}
            </div>
          </>
        )}
        <div className={styles.list}>
          {[0, 1, 2].map((item) => (
            <div className={styles.row} key={item}>
              <div className={`${styles.block} ${styles.avatar}`} />
              <div className={styles.lines}>
                <div className={`${styles.block} ${styles.short}`} />
                <div className={styles.block} />
              </div>
              <div className={`${styles.block} ${styles.badge}`} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
