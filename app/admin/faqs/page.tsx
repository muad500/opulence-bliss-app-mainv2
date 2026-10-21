import { requireAdminPage } from "@/lib/adminSession";
import {
  FAQ_CATEGORIES,
  FAQ_CATEGORY_LABELS,
  type FaqCategory,
  type FaqRow,
} from "@/lib/faqs";
import { createFaq, deleteFaq, updateFaq } from "./actions";
import styles from "./page.module.css";

export default async function AdminFaqsPage() {
  const { supabase, user } = await requireAdminPage();
  const { data, error } = await supabase
    .from("faqs")
    .select("id, category, question, answer, published, sort_order, created_at")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const faqs = (data ?? []) as FaqRow[];

  return (
    <main className={styles.shell}>
      <div className={styles.page}>
        <h1>Frequently asked questions</h1>
        <p className={styles.intro}>
          Add, edit, reorder, publish or hide answers. Cleaning and Property
          maintenance answers also appear on their matching service pages.
        </p>

        {error && (
          <p className={styles.error}>
            The FAQ database update has not been applied yet: {error.message}
          </p>
        )}

        <section className={styles.createCard} aria-labelledby="add-faq">
          <h2 id="add-faq">Add a question</h2>
          <FaqForm action={createFaq} submitLabel="Add FAQ" />
        </section>

        <div className={styles.groups}>
          {FAQ_CATEGORIES.map((category) => {
            const rows = faqs.filter((faq) => faq.category === category);
            return (
              <section className={styles.group} key={category}>
                <div className={styles.groupHeading}>
                  <h2>{FAQ_CATEGORY_LABELS[category]}</h2>
                  <span>
                    {rows.length} {rows.length === 1 ? "question" : "questions"}
                  </span>
                </div>
                {rows.length === 0 ? (
                  <p className={styles.empty}>
                    No questions in this section yet.
                  </p>
                ) : (
                  <div className={styles.list}>
                    {rows.map((faq) => (
                      <FaqForm
                        key={faq.id}
                        faq={faq}
                        action={updateFaq.bind(null, faq.id)}
                        deleteAction={deleteFaq.bind(null, faq.id)}
                        submitLabel="Save changes"
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function FaqForm({
  faq,
  action,
  deleteAction,
  submitLabel,
}: {
  faq?: FaqRow;
  action: (formData: FormData) => void | Promise<void>;
  deleteAction?: () => void | Promise<void>;
  submitLabel: string;
}) {
  return (
    <form action={action} className={styles.form}>
      <div className={styles.row}>
        <label>
          Section
          <select name="category" defaultValue={faq?.category ?? "general"}>
            {FAQ_CATEGORIES.map((category) => (
              <option value={category} key={category}>
                {FAQ_CATEGORY_LABELS[category as FaqCategory]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.order}>
          Order
          <input
            name="sortOrder"
            type="number"
            defaultValue={faq?.sort_order ?? 0}
          />
        </label>
      </div>
      <label>
        Question
        <input
          name="question"
          defaultValue={faq?.question ?? ""}
          maxLength={220}
          required
        />
      </label>
      <label>
        Answer
        <textarea
          name="answer"
          defaultValue={faq?.answer ?? ""}
          rows={4}
          maxLength={5000}
          required
        />
      </label>
      <div className={styles.actions}>
        <label className={styles.publish}>
          <input
            name="published"
            type="checkbox"
            defaultChecked={faq?.published ?? true}
          />
          Published on website
        </label>
        <div className={styles.buttons}>
          {deleteAction && (
            <button
              className={styles.delete}
              formAction={deleteAction}
              type="submit"
            >
              Delete
            </button>
          )}
          <button className={styles.save} type="submit">
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
