"use client";

/**
 * عرض قراءة المستند — معاينة/توليد + طباعة (ر7/ج · D7 طباعة المتصفح · D9 ترويسة الهوية).
 * يُستخدم من معاينة المصمم ومن «توليد المستند» في عروض الأسعار — نفس الامتدادات
 * (editable=false) فتُصيَّر الكتل الموسومة ثابتة، والجداول بحدود كالمطبوعات.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorContent, useEditor } from "@tiptap/react";

import { apiGet } from "@/components/contrack/api";
import { buildDocTemplateExtensions } from "@/components/contrack/doc-templates/doc-template-nodes";
import { printDoc } from "@/components/contrack/doc-templates/print-doc";
import { isDocLike } from "@/lib/doc-template-core";

export { printDoc };

interface SettingsLite {
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  headerTitle?: string;
  currency?: string;
}

export function DocReadView({ content }: { content: unknown }) {
  const settingsQuery = useQuery<{ settings: SettingsLite }>({
    queryKey: ["settings", "doc-read"],
    queryFn: () => apiGet<{ settings: SettingsLite }>("/api/settings"),
    staleTime: 60_000,
  });
  const s = settingsQuery.data?.settings;

  const editor = useEditor({
    extensions: buildDocTemplateExtensions(),
    content: isDocLike(content) ? (content as object) : { type: "doc", content: [] },
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: { dir: "rtl", class: "doc-prose" },
    },
  });

  return (
    <div className="doc-sheet" dir="rtl">
      {s && (s.companyName || s.headerTitle) && (
        <header className="doc-header">
          <p className="doc-header-name">{s.companyName}</p>
          {s.headerTitle && <p className="doc-header-sub">{s.headerTitle}</p>}
          {(s.companyPhone || s.companyEmail || s.companyAddress) && (
            <p className="doc-header-contact" dir="ltr">
              {[s.companyPhone, s.companyEmail, s.companyAddress].filter(Boolean).join("  ·  ")}
            </p>
          )}
          <hr className="doc-header-rule" />
        </header>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
