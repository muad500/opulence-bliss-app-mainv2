import {
  CLEANING_SERVICE_RULES,
  cleaningPackageScope,
  hasCleaningServiceRules,
} from "@/lib/cleaningScope";
import styles from "./CleaningPackageScope.module.css";

export default function CleaningPackageScope({
  packageName,
  expanded = false,
}: {
  packageName: string;
  expanded?: boolean;
}) {
  if (!hasCleaningServiceRules(packageName)) return null;
  const scope = cleaningPackageScope(packageName);
  return (
    <section
      className={styles.scope}
      aria-label="Cleaning scope and preparation"
    >
      {scope && (
        <details open={expanded}>
          <summary>Essential Clean: full breakdown</summary>
          <div className={styles.body}>
            <p>{scope.purpose}</p>
            <p>
              <strong>Indicative time:</strong> {scope.timing}
            </p>
            <h4>Job functions</h4>
            <ul>
              {scope.tasks.map((task) => (
                <li key={task.area}>
                  <strong>{task.area}:</strong> {task.work}
                </li>
              ))}
            </ul>
            <h4>Not included — available as add-ons</h4>
            <ul>
              {scope.addOns.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </details>
      )}
      <details>
        <summary>Standard exclusions — every cleaning service</summary>
        <div className={styles.body}>
          <p>{CLEANING_SERVICE_RULES.exclusionsIntro}</p>
          <ul>
            {CLEANING_SERVICE_RULES.exclusions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </details>
      <details>
        <summary>How to prepare for your clean</summary>
        <div className={styles.body}>
          <ul>
            {CLEANING_SERVICE_RULES.preparation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </details>
      <details>
        <summary>Before and after every job</summary>
        <div className={styles.body}>
          <ul>
            {CLEANING_SERVICE_RULES.everyJob.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}
