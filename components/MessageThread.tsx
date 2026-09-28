"use client";

// One immutable thread per booking. Used by customers and providers with
// role-specific quick replies.

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  attachmentMimeType,
  normalizeMessageAttachments,
  type MessageAttachment,
} from "@/lib/messageAttachments";

const supabase = createClient();
const GRAD = "linear-gradient(100deg,#F5C542,#C86FC9 55%,#7B2FF7)";
const PURPLE = "#6D28D9";

type Msg = {
  booking_message_attachments: MessageAttachment[];
  id: number;
  sender_id: string;
  sender_role: "customer" | "provider" | "admin";
  body: string;
  created_at: string;
  read_at: string | null;
};

type RawMsg = Omit<Msg, "booking_message_attachments"> & {
  booking_message_attachments?: MessageAttachment | MessageAttachment[] | null;
};

function withTimeout<T>(request: T, message: string, timeoutMs = 15_000) {
  return new Promise<Awaited<T>>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(request).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (failure) => {
        window.clearTimeout(timer);
        reject(failure);
      },
    );
  });
}

const QUICK: Record<"customer" | "provider", string[]> = {
  customer: [
    "The key is under the mat",
    "Please ring the bell, don't knock",
    "I have a dog — she's friendly",
    "Running late, please wait 10 minutes",
  ],
  provider: [
    "On my way",
    "Running late?",
    "I'm outside",
    "All finished — thank you",
  ],
};

const DIALOG_QUICK: Record<"customer" | "provider", string[]> = {
  customer: ["See you soon!", "Thanks!", "Sounds good!"],
  provider: ["Running late?", "On my way", "I'm outside", "All finished — thank you"],
};

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return today
    ? time
    : `${d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })}, ${time}`;
}

export default function MessageThread({
  bookingId,
  viewerRole,
  closed = false,
  bare = false,
}: {
  bookingId: string;
  viewerRole: "customer" | "provider";
  closed?: boolean;
  bare?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const loadVersion = useRef(0);
  const sending = useRef(false);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const auth = await withTimeout(
        supabase.auth.getSession(),
        "The conversation took too long to connect. Please try again.",
      );
      if (auth.error) throw auth.error;
      const user = auth.data.session?.user;
      if (!user) {
        setMe(null);
        throw new Error("Please sign in again to use booking messages.");
      }

      const result = await withTimeout(
        supabase
          .from("booking_messages")
          .select("id, sender_id, sender_role, body, created_at, read_at, booking_message_attachments(path, name, mime_type)")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: true }),
        "The conversation took too long to load. Please try again.",
      );
      if (result.error) throw result.error;

      const rawMessages = (result.data ?? []) as unknown as RawMsg[];
      const hydrated = await Promise.all(rawMessages.map(async (message) => ({
        ...message,
        booking_message_attachments: await Promise.all(
          normalizeMessageAttachments(message.booking_message_attachments).map(async (file) => {
            try {
              const signed = await withTimeout(
                supabase.storage.from("booking-attachments").createSignedUrl(file.path, 3600),
                "Attachment preview timed out.",
                8_000,
              );
              return { ...file, signedUrl: signed.data?.signedUrl };
            } catch {
              return file;
            }
          }),
        ),
      })));

      if (version !== loadVersion.current) return false;
      setMe(user.id);
      setMessages(hydrated);
      setLoaded(true);
      setLoadError(null);

      if (
        (bare || !minimized) &&
        rawMessages.some(
          (message) => message.sender_id !== user.id && !message.read_at,
        )
      ) {
        void withTimeout(
          supabase.rpc("mark_messages_read", { p_booking_id: bookingId }),
          "Read receipt timed out.",
          8_000,
        ).catch(() => undefined);
      }
      return true;
    } catch (failure) {
      if (version !== loadVersion.current) return false;
      setLoaded(true);
      setLoadError(
        failure instanceof Error
          ? failure.message
          : "The conversation could not be loaded. Please try again.",
      );
      return false;
    }
  }, [bare, bookingId, minimized]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`booking-messages:${bookingId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "booking_messages",
          filter: `booking_id=eq.${bookingId}`,
        },
        () => void load(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
      });

    // Recovery path for a sleeping tab or a temporarily dropped socket.
    const timer = setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      loadVersion.current += 1;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [bookingId, load]);

  useEffect(() => {
    if (messages.length) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  async function send(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !attachment) || busy || sending.current || closed) return;
    if (!me) {
      setError("The conversation is still connecting. Please try again.");
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    let uploadedPath: string | null = null;
    try {
      if (attachment) {
        const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
        const mimeType = attachmentMimeType(attachment);
        const extension = mimeType ? extensions[mimeType] : null;
        if (!mimeType || !extension || attachment.size <= 0 || attachment.size > 10 * 1024 * 1024) throw new Error("Choose a JPG, PNG or WebP photo up to 10 MB.");
        uploadedPath = `${bookingId}/${me}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await withTimeout(
          supabase.storage.from("booking-attachments").upload(uploadedPath, attachment, { contentType: mimeType, upsert: false }),
          "The file upload took too long. Please try again.",
          30_000,
        );
        if (uploadError) throw uploadError;
      }
      const { data: sendResult, error: sendError } = await withTimeout(
        uploadedPath
          ? supabase.rpc("send_booking_attachment", { p_booking_id: bookingId, p_body: trimmed || "Shared an attachment", p_path: uploadedPath, p_name: attachment!.name.slice(0, 160) })
          : supabase.rpc("send_booking_message", { p_booking_id: bookingId, p_body: trimmed }),
        "Sending took too long. Please try again.",
      );
      if (sendError) throw sendError;
      const moderation = sendResult as {
        blocked?: boolean;
        category?: string;
      } | null;
      if (moderation?.blocked) {
        throw new Error(
          "This message was not sent. It was flagged for hateful, threatening or abusive language and added to the safety review queue. Please rewrite it respectfully.",
        );
      }
      setBody("");
      setAttachment(null);
      if (fileRef.current) fileRef.current.value = "";
      const refreshed = await load();
      if (!refreshed) {
        setError("Message sent, but the conversation could not refresh. Reopen it to see the message.");
      }
    } catch (failure) {
      if (uploadedPath) {
        void supabase.storage.from("booking-attachments").remove([uploadedPath]);
      }
      setError(failure instanceof Error ? failure.message : "The message could not be sent. Please try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const other = viewerRole === "customer" ? "your provider" : "your customer";
  const unread = messages.filter(
    (message) => message.sender_id !== me && !message.read_at,
  ).length;

  return (
    <section style={bare ? bareCard : card}>
      {!bare && (
        <div style={{ ...head, marginBottom: minimized ? 0 : 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={title}>Messages</strong>
            <span style={sub}>
              {minimized
                ? `${messages.length} message${messages.length === 1 ? "" : "s"}`
                : "Stays on the platform — no phone numbers shared"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMinimized((value) => !value)}
            aria-expanded={!minimized}
            style={toggle}
          >
            {minimized
              ? `Open chat${unread > 0 ? ` (${unread})` : ""}`
              : "Minimise"}
          </button>
        </div>
      )}

      {(bare || !minimized) && (
        <>
          <div
            style={bare ? { ...log, maxHeight: "min(52vh, 520px)" } : log}
            aria-live="polite"
          >
            {!loaded ? (
              <p style={muted}>Loading…</p>
            ) : loadError && messages.length === 0 ? (
              <div style={{ textAlign: "center", padding: "14px 0" }}>
                <p style={{ ...muted, padding: 0 }}>{loadError}</p>
                <button type="button" onClick={() => void load()} style={retryButton}>
                  Try loading again
                </button>
              </div>
            ) : messages.length === 0 ? (
              <p style={muted}>
                Nothing yet. Anything {other} should know before the visit?
              </p>
            ) : (
              messages.map((message) => {
                const mine = message.sender_id === me;
                const fromAdmin = message.sender_role === "admin";
                return (
                  <div
                    key={message.id}
                    style={{
                      display: "flex",
                      justifyContent: mine ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        ...bubble,
                        background: fromAdmin
                          ? "#FFF3D6"
                          : bare
                            ? mine
                              ? "var(--ob-purple-soft)"
                              : "var(--ob-surface-soft)"
                            : mine
                              ? "#16202A"
                              : "#F2F3F5",
                        color: fromAdmin
                          ? "#8A5A00"
                          : bare
                            ? mine
                              ? "var(--ob-purple)"
                              : "var(--ob-text)"
                            : mine
                              ? "#fff"
                              : "#16202A",
                        borderBottomRightRadius: mine ? 5 : 16,
                        borderBottomLeftRadius: mine ? 16 : 5,
                      }}
                    >
                      {fromAdmin && <span style={badge}>Opulence Bliss</span>}
                      <span style={{ display: "block" }}>{message.body}</span>
                      {(message.booking_message_attachments ?? []).map((file) => file.signedUrl ? (
                        <a key={file.path} href={file.signedUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: 8, color: "inherit", textDecoration: "underline" }}>
                          {file.mime_type.startsWith("image/") && (
                            // Private, short-lived Storage URLs cannot use the public image optimizer.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={file.signedUrl} alt={file.name} loading="lazy" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 8 }} />
                          )}
                          {file.name}
                        </a>
                      ) : <span key={file.path}>Attachment unavailable. Reopen the conversation to retry.</span> )}
                      <span
                        style={{
                          ...stamp,
                          color:
                            bare && mine
                              ? "var(--ob-purple)"
                              : mine
                                ? "rgba(255,255,255,0.6)"
                                : "#A9AFB7",
                          opacity: bare && mine ? 0.7 : 1,
                        }}
                      >
                        {when(message.created_at)}
                        {mine && message.read_at ? " · read" : ""}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={endRef} />
          </div>

          {closed ? (
            <p style={{ ...muted, marginTop: 12 }}>
              This booking is closed. Contact support if you still need help.
            </p>
          ) : (
            <>
              <div style={chips}>
                {(bare ? DIALOG_QUICK : QUICK)[viewerRole].map((reply) => (
                  <button
                    key={reply}
                    type="button"
                    style={reply === "Running late?" ? lateChip : chip}
                    disabled={busy || !loaded || !me}
                    onClick={() => {
                      if (viewerRole === "provider" && reply === "Running late?") {
                        window.dispatchEvent(
                          new CustomEvent("opulence:report-delay", {
                            detail: { bookingId },
                          }),
                        );
                        return;
                      }
                      void send(reply);
                    }}
                  >
                    {reply}
                  </button>
                ))}
              </div>

              <label style={{ display: "block", margin: "10px 0", fontSize: 13 }}>
                Add a photo (JPG, PNG or WebP, up to 10 MB). Please only share photos related to your booking or the cleaning.
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !loaded || !me}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && (!attachmentMimeType(file) || file.size <= 0 || file.size > 10 * 1024 * 1024)) {
                      setError("Choose a JPG, PNG or WebP photo up to 10 MB."); event.target.value = ""; setAttachment(null); return;
                    }
                    setError(null); setAttachment(file);
                  }} />
              </label>
              {attachment && <button type="button" disabled={busy} onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = ""; }}>Remove {attachment.name}</button>}
              <p style={moderationNotice}>
                <ShieldAlert size={15} aria-hidden="true" /> Messages are checked for hate speech, threats and abusive language.
              </p>
              <div style={composer}>
                <input
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void send(body);
                    }
                  }}
                  placeholder={!loaded || !me ? "Connecting to messages…" : `Message ${other}…`}
                  aria-label="Your message"
                  disabled={busy || !loaded || !me}
                  maxLength={2000}
                  style={input}
                />
                <button
                  type="button"
                  onClick={() => void send(body)}
                  disabled={busy || !loaded || !me || (!body.trim() && !attachment)}
                  style={{
                    ...sendBtn,
                    ...(bare
                      ? { width: 46, height: 46, padding: 0, borderRadius: 999 }
                      : {}),
                    opacity: busy || !loaded || !me || (!body.trim() && !attachment) ? 0.45 : 1,
                  }}
                  aria-label="Send message"
                >
                  {bare ? <Send size={19} /> : "Send"}
                </button>
              </div>
            </>
          )}

          {error && <p style={errStyle}>{error}</p>}
          {loadError && messages.length > 0 && (
            <p style={errStyle}>
              {loadError}{" "}
              <button type="button" onClick={() => void load()} style={inlineRetryButton}>
                Refresh
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "2px solid #EDEFF1",
  borderRadius: 20,
  padding: "18px 20px",
  fontFamily: "'Nunito', system-ui, sans-serif",
};
const bareCard: React.CSSProperties = {
  background: "transparent",
  border: 0,
  padding: 0,
  fontFamily: "'Nunito', system-ui, sans-serif",
};
const head: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
};
const title: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 900,
  color: "#16202A",
  display: "block",
};
const sub: React.CSSProperties = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#A9AFB7",
};
const toggle: React.CSSProperties = {
  flexShrink: 0,
  background: "#F4ECFE",
  border: "1px solid #E2D2FA",
  borderRadius: 999,
  color: PURPLE,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: "7px 11px",
};
const log: React.CSSProperties = {
  display: "grid",
  gap: 8,
  maxHeight: 320,
  overflowY: "auto",
  padding: "4px 2px",
};
const bubble: React.CSSProperties = {
  maxWidth: "82%",
  padding: "10px 14px",
  borderRadius: 16,
  fontSize: 14.5,
  fontWeight: 600,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};
const badge: React.CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  marginBottom: 3,
  opacity: 0.75,
};
const stamp: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  marginTop: 4,
};
const muted: React.CSSProperties = {
  color: "#A9AFB7",
  fontSize: 14,
  fontWeight: 600,
  margin: 0,
  textAlign: "center",
  padding: "14px 0",
};
const chips: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  margin: "12px 0 10px",
  paddingTop: 12,
  borderTop: "1px solid #F1F2F4",
};
const chip: React.CSSProperties = {
  background: "#F8F5FF",
  border: "1.5px solid #E8DCFA",
  borderRadius: 999,
  padding: "7px 13px",
  fontFamily: "inherit",
  fontSize: 12.5,
  fontWeight: 800,
  color: PURPLE,
  cursor: "pointer",
};
const lateChip: React.CSSProperties = {
  ...chip,
  background: "#FFF3CD",
  borderColor: "#F2B84B",
  color: "#8A5A00",
  boxShadow: "0 3px 10px rgba(242,184,75,0.16)",
};
const composer: React.CSSProperties = { display: "flex", gap: 8 };
const moderationNotice: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  margin: "8px 0 9px",
  color: "#6B7280",
  fontSize: 12,
  fontWeight: 700,
};
const input: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "2px solid #EDEFF1",
  borderRadius: 999,
  padding: "11px 16px",
  fontFamily: "inherit",
  fontSize: 15,
  fontWeight: 600,
  color: "#16202A",
};
const sendBtn: React.CSSProperties = {
  background: GRAD,
  color: "#fff",
  border: "none",
  borderRadius: 999,
  padding: "11px 20px",
  fontFamily: "inherit",
  fontSize: 14.5,
  fontWeight: 900,
  cursor: "pointer",
};
const errStyle: React.CSSProperties = {
  background: "#FFE6EA",
  color: "#B0384F",
  padding: "10px 13px",
  borderRadius: 11,
  fontSize: 13.5,
  fontWeight: 700,
  margin: "10px 0 0",
};
const retryButton: React.CSSProperties = {
  marginTop: 10,
  border: "1px solid #E2D2FA",
  borderRadius: 999,
  background: "#F8F5FF",
  color: PURPLE,
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: 800,
  padding: "7px 13px",
};
const inlineRetryButton: React.CSSProperties = {
  border: 0,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: 900,
  padding: 0,
  textDecoration: "underline",
};
