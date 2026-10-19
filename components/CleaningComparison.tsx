import {
  CLEANING_COMPARISON,
  COMPARISON_PACKAGES,
} from "@/lib/cleaningComparison";
import styles from "./CleaningComparison.module.css";

export default function CleaningComparison() {
  return (
    <section className={styles.section} aria-labelledby="comparison-title">
      <div className={styles.inner}>
        <p className={styles.eyebrow}>Find your clean</p>
        <h2 id="comparison-title">Comparison at a glance</h2>
        <p id="comparison-key">
          Yes = included · Add-on = optional extra · No = not included.
        </p>
        <p id="comparison-help" className={styles.help}>
          Scroll across to compare all six packages. Add-ons are agreed before
          the visit; safe access and the package descriptions apply.
        </p>
        <div
          className={styles.scroll}
          role="region"
          aria-label="Cleaning package comparison"
          aria-describedby="comparison-help"
          tabIndex={0}
        >
          <table aria-describedby="comparison-key">
            <caption className={styles.srOnly}>
              Cleaning tasks included in each package
            </caption>
            <thead>
              <tr>
                <th scope="col">Task</th>
                {COMPARISON_PACKAGES.map((name) => (
                  <th scope="col" key={name}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CLEANING_COMPARISON.map((row) => (
                <tr key={row.task}>
                  <th scope="row">{row.task}</th>
                  {row.values.map((value, i) => (
                    <td
                      key={COMPARISON_PACKAGES[i]}
                      data-value={
                        value === "Yes"
                          ? "yes"
                          : value === "No"
                            ? "no"
                            : "detail"
                      }
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
