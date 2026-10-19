import assert from "node:assert/strict";
import { test } from "node:test";
import { chatMessageMail } from "./chatMessageMail";

const id = "00000000-0000-4000-8000-000000000001";
test("chat emails identify the sender, preserve text and link to the private chat", () => {
  for (const [role, label, path] of [
    ["provider", "cleaner", "/account/visit/"],
    ["customer", "customer", "/worker/job/"],
  ]) {
    const mail = chatMessageMail(
      {
        sender_role: role,
        body: "Hello <b>there</b>\nSecond line",
        href: path + id,
      },
      "https://www.opulencebliss.com/",
    );
    assert.equal(
      mail.subject,
      `You've received a new message from your ${label}`,
    );
    assert.ok(mail.text.includes("Hello <b>there</b>\nSecond line"));
    assert.ok(mail.text.endsWith(path + id + "#messages"));
  }
});
test("chat mail rejects external links, credentials and unsupported senders", () => {
  const valid = {
    sender_role: "provider",
    body: "Hello",
    href: "/account/visit/" + id,
  };
  for (const href of ["https://example.com", "//example.com", "/staff/login"])
    assert.throws(() =>
      chatMessageMail({ ...valid, href }, "https://www.opulencebliss.com"),
    );
  assert.throws(() =>
    chatMessageMail(
      { ...valid, sender_role: "admin" },
      "https://www.opulencebliss.com",
    ),
  );
  assert.throws(() => chatMessageMail(valid, "http://www.opulencebliss.com"));
  assert.throws(() => chatMessageMail(valid, "https://user:pass@example.com"));
});
