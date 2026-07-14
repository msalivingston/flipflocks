"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AdminSiteFaqRow } from "../_lib/admin-types";
import {
  AdminAccessState,
  AdminCard,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  isAdminAuthorizationError,
} from "./admin-ui";

type EditorState = {
  answer: string;
  id: string | null;
  isPublished: boolean;
  question: string;
};

const emptyEditor: EditorState = {
  answer: "",
  id: null,
  isPublished: true,
  question: "",
};

export function AdminFaqsManager() {
  const [faqs, setFaqs] = useState<AdminSiteFaqRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadFaqs() {
      setIsLoading(true);
      setError(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (userError || !userData.user) {
        setError("Sign in with a platform admin account to view this area.");
        setIsLoading(false);
        return;
      }

      const { data, error: faqsError } = await supabase
        .from("site_faqs")
        .select(
          "id, question, answer, is_published, sort_order, created_at, updated_at",
        )
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (!isMounted) return;

      if (faqsError) {
        setError(faqsError.message);
        setIsLoading(false);
        return;
      }

      setFaqs((data ?? []) as AdminSiteFaqRow[]);
      setIsLoading(false);
    }

    void loadFaqs();

    return () => {
      isMounted = false;
    };
  }, []);

  const nextSortOrder = useMemo(() => {
    if (faqs.length === 0) return 0;
    return Math.max(...faqs.map((faq) => faq.sort_order)) + 1;
  }, [faqs]);

  function openAddEditor() {
    setFieldError(null);
    setEditor(emptyEditor);
  }

  function openEditEditor(faq: AdminSiteFaqRow) {
    setFieldError(null);
    setEditor({
      answer: faq.answer,
      id: faq.id,
      isPublished: faq.is_published,
      question: faq.question,
    });
  }

  async function saveQuestion() {
    if (!editor) return;

    const question = editor.question.trim();
    const answer = editor.answer.trim();

    if (!question || !answer) {
      setFieldError("Question and answer are required.");
      return;
    }

    setIsSaving(true);
    setFieldError(null);
    setError(null);

    if (editor.id) {
      const { data, error: saveError } = await supabase
        .from("site_faqs")
        .update({
          answer,
          is_published: editor.isPublished,
          question,
        })
        .eq("id", editor.id)
        .select(
          "id, question, answer, is_published, sort_order, created_at, updated_at",
        )
        .single();

      setIsSaving(false);

      if (saveError) {
        setFieldError(saveError.message);
        return;
      }

      setFaqs((current) =>
        current.map((faq) =>
          faq.id === editor.id ? (data as AdminSiteFaqRow) : faq,
        ),
      );
      setEditor(null);
      return;
    }

    const { data, error: saveError } = await supabase
      .from("site_faqs")
      .insert({
        answer,
        is_published: editor.isPublished,
        question,
        sort_order: nextSortOrder,
      })
      .select(
        "id, question, answer, is_published, sort_order, created_at, updated_at",
      )
      .single();

    setIsSaving(false);

    if (saveError) {
      setFieldError(saveError.message);
      return;
    }

    setFaqs((current) => [...current, data as AdminSiteFaqRow]);
    setEditor(null);
  }

  async function deleteFaq(faq: AdminSiteFaqRow) {
    const shouldDelete = window.confirm(
      "Delete this FAQ question? This cannot be undone.",
    );

    if (!shouldDelete) return;

    setError(null);

    const { error: deleteError } = await supabase
      .from("site_faqs")
      .delete()
      .eq("id", faq.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setFaqs((current) => current.filter((item) => item.id !== faq.id));
  }

  async function persistOrder(nextFaqs: AdminSiteFaqRow[]) {
    const reorderedFaqs = nextFaqs.map((faq, index) => ({
      ...faq,
      sort_order: index,
    }));

    setFaqs(reorderedFaqs);
    setError(null);

    const updates = reorderedFaqs.map((faq) =>
      supabase
        .from("site_faqs")
        .update({ sort_order: faq.sort_order })
        .eq("id", faq.id),
    );

    const results = await Promise.all(updates);
    const orderError = results.find((result) => result.error)?.error;

    if (orderError) {
      setError(orderError.message);
    }
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    const draggedIndex = faqs.findIndex((faq) => faq.id === draggedId);
    const targetIndex = faqs.findIndex((faq) => faq.id === targetId);

    if (draggedIndex < 0 || targetIndex < 0) {
      setDraggedId(null);
      return;
    }

    const nextFaqs = [...faqs];
    const [movedFaq] = nextFaqs.splice(draggedIndex, 1);
    nextFaqs.splice(targetIndex, 0, movedFaq);
    setDraggedId(null);

    void persistOrder(nextFaqs);
  }

  return (
    <>
      <AdminPageHeader
        eyebrow="Platform Admin"
        title="FAQ"
        description="Manage the frequently asked questions that appear on the FlockFront website."
        action={
          <button
            className="seller-primary-button"
            type="button"
            onClick={openAddEditor}
          >
            Add Question
          </button>
        }
      />

      <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7">
        {isLoading ? <AdminLoadingState label="Loading FAQs" /> : null}

        {!isLoading && error ? (
          isAdminAuthorizationError(error) ? (
            <AdminAccessState message={error} />
          ) : (
            <AdminErrorState message={error} />
          )
        ) : null}

        {!isLoading && !error ? (
          <AdminCard>
            {faqs.length > 0 ? (
              <div className="grid divide-y divide-stone-200">
                {faqs.map((faq) => (
                  <FaqRow
                    faq={faq}
                    isDragging={draggedId === faq.id}
                    key={faq.id}
                    onDelete={() => deleteFaq(faq)}
                    onDragStart={() => setDraggedId(faq.id)}
                    onDrop={() => handleDrop(faq.id)}
                    onEdit={() => openEditEditor(faq)}
                  />
                ))}
              </div>
            ) : (
              <div className="p-5">
                <p className="text-sm font-semibold text-stone-600">
                  No FAQ questions have been added yet.
                </p>
              </div>
            )}
          </AdminCard>
        ) : null}
      </div>

      {editor ? (
        <FaqEditorDialog
          editor={editor}
          error={fieldError}
          isSaving={isSaving}
          onCancel={() => setEditor(null)}
          onChange={setEditor}
          onSave={saveQuestion}
        />
      ) : null}
    </>
  );
}

function FaqRow({
  faq,
  isDragging,
  onDelete,
  onDragStart,
  onDrop,
  onEdit,
}: {
  faq: AdminSiteFaqRow;
  isDragging: boolean;
  onDelete: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onEdit: () => void;
}) {
  return (
    <article
      className={`grid gap-4 p-4 transition md:grid-cols-[2.5rem_1fr_auto] md:items-center ${
        isDragging ? "bg-emerald-50/60" : "bg-white"
      }`}
      draggable
      onDragEnd={(event) => {
        event.currentTarget.blur();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragStart={onDragStart}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <button
        aria-label={`Reorder ${faq.question}`}
        className="flex size-10 cursor-grab flex-col items-center justify-center gap-1 rounded-md border border-[#ceddd7] bg-[#f7faf8] p-0 active:cursor-grabbing"
        type="button"
      >
        {Array.from({ length: 3 }).map((_, index) => (
          <span
            aria-hidden="true"
            className="h-0.5 w-4 rounded-full bg-[#55776d]"
            key={index}
          />
        ))}
      </button>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-stone-950">{faq.question}</h2>
          <FaqStatusBadge isPublished={faq.is_published} />
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-600">
          {faq.answer}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 md:justify-end">
        <button
          className="seller-small-button gap-2"
          type="button"
          onClick={onEdit}
        >
          <GlyphImage alt="" src="/glyphs/pencil.png" />
          Edit
        </button>
        <button
          className="seller-small-button gap-2 border-red-200 text-red-700 hover:bg-red-50"
          type="button"
          onClick={onDelete}
        >
          <GlyphImage alt="" src="/glyphs/trashcan.png" />
          Delete
        </button>
      </div>
    </article>
  );
}

function FaqStatusBadge({ isPublished }: { isPublished: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${
        isPublished
          ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
          : "bg-stone-100 text-stone-700 ring-stone-200"
      }`}
    >
      {isPublished ? "Published" : "Hidden"}
    </span>
  );
}

function FaqEditorDialog({
  editor,
  error,
  isSaving,
  onCancel,
  onChange,
  onSave,
}: {
  editor: EditorState;
  error: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (editor: EditorState) => void;
  onSave: () => void;
}) {
  const title = editor.id ? "Edit FAQ Question" : "Add FAQ Question";

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-stone-950/35 p-0 sm:items-center sm:justify-center sm:p-5">
      <section
        aria-labelledby="faq-editor-title"
        aria-modal="true"
        className="max-h-[92vh] w-full overflow-auto rounded-t-lg border border-stone-200 bg-white p-5 shadow-xl sm:max-w-2xl sm:rounded-lg"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="faq-editor-title"
              className="text-lg font-bold text-stone-950"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Keep answers concise and ready for the future public FAQ section.
            </p>
          </div>
          <button
            className="seller-small-button"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Question
            <input
              className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              value={editor.question}
              onChange={(event) =>
                onChange({ ...editor, question: event.target.value })
              }
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Answer
            <textarea
              className="min-h-40 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium leading-6 text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              value={editor.answer}
              onChange={(event) =>
                onChange({ ...editor, answer: event.target.value })
              }
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-700">
            <span>
              Published
              <span className="block text-xs font-medium text-stone-500">
                Hidden questions will stay out of the public FAQ later.
              </span>
            </span>
            <input
              checked={editor.isPublished}
              className="size-5 accent-emerald-800"
              type="checkbox"
              onChange={(event) =>
                onChange({ ...editor, isPublished: event.target.checked })
              }
            />
          </label>

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="seller-small-button"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="seller-primary-button"
            disabled={isSaving}
            type="button"
            onClick={onSave}
          >
            {isSaving
              ? "Saving..."
              : editor.id
                ? "Save Changes"
                : "Save Question"}
          </button>
        </div>
      </section>
    </div>
  );
}

function GlyphImage({ alt, src }: { alt: string; src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} className="size-4 object-contain" src={src} />
  );
}
