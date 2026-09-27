export type MessageAttachment = {
  path: string;
  name: string;
  mime_type: string;
  signedUrl?: string;
};

// PostgREST returns a one-to-one relation as an object and a one-to-many
// relation as an array. message_id is the attachment table's primary key, so
// this relation is one-to-one even though older generated types described it
// as an array.
export function normalizeMessageAttachments(
  value: MessageAttachment | MessageAttachment[] | null | undefined,
): MessageAttachment[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function attachmentMimeType(file: Pick<File, "name" | "type">) {
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return file.type;
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  return ({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  } as Record<string, string>)[extension ?? ""] ?? null;
}
