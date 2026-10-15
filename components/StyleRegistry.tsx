"use client";

import { useState, type ReactNode } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { createStyleRegistry, StyleRegistry } from "styled-jsx";

/** Collect scoped styles per render so streamed pages arrive fully styled. */
export default function ScopedStyleRegistry({
  children,
}: {
  children: ReactNode;
}) {
  const [registry] = useState(() => createStyleRegistry());

  useServerInsertedHTML(() => {
    const styles = registry.styles();
    registry.flush();
    return <>{styles}</>;
  });

  return <StyleRegistry registry={registry}>{children}</StyleRegistry>;
}
