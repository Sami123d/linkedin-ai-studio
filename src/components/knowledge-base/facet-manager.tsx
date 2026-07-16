"use client";

import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/features/knowledge-base/types";

export type FacetField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "date" | "checkbox" | "url";
  required?: boolean;
  placeholder?: string;
};

/// A generic list-plus-dialog-form CRUD UI shared by the seven multi-row
/// Knowledge Base facets (Projects, Experience, Achievements, Skills,
/// Writing Samples, Goals, Opinions). All seven have the identical shape —
/// a list of rows scoped to the current profile, an add/edit form, and a
/// delete button — so one generic component replaces seven near-identical
/// ones instead of hand-duplicating this per facet. Resume is deliberately
/// NOT part of this: it's a 1:1 singleton with a file-upload flow, not a
/// list, so it gets its own component.
/// Display strings are computed server-side (in the page) and handed over
/// as plain data, not functions — a Server Component can only pass plain,
/// serializable props to a Client Component like this one. `raw` carries
/// the original row for the edit form's default values.
export type FacetItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  content?: string | null;
  raw: Record<string, unknown>;
};

export function FacetManager({
  itemLabel,
  items,
  fields,
  emptyMessage,
  createAction,
  updateAction,
  deleteAction,
}: {
  itemLabel: string;
  items: FacetItem[];
  fields: FacetField[];
  emptyMessage: string;
  createAction: (input: unknown) => Promise<ActionResult>;
  updateAction: (id: string, input: unknown) => Promise<ActionResult>;
  deleteAction: (id: string) => Promise<ActionResult>;
}) {
  const [editing, setEditing] = useState<FacetItem | "new" | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm(`Delete this ${itemLabel.toLowerCase()}?`)) return;
    setPendingDeleteId(id);
    await deleteAction(id);
    setPendingDeleteId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Dialog
          open={editing === "new"}
          onOpenChange={(open) => setEditing(open ? "new" : null)}
        >
          <DialogTrigger render={<Button size="sm" />}>
            <PlusIcon /> Add {itemLabel.toLowerCase()}
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <FacetForm
              itemLabel={itemLabel}
              fields={fields}
              action={createAction}
              onDone={() => setEditing(null)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>{item.title}</CardTitle>
                  {item.subtitle && (
                    <CardDescription>{item.subtitle}</CardDescription>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Dialog
                    open={editing === item}
                    onOpenChange={(open) => setEditing(open ? item : null)}
                  >
                    <DialogTrigger render={<Button size="icon-sm" variant="ghost" />}>
                      <PencilIcon />
                      <span className="sr-only">Edit</span>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <FacetForm
                        itemLabel={itemLabel}
                        fields={fields}
                        defaultValues={item.raw}
                        action={(input) => updateAction(item.id, input)}
                        onDone={() => setEditing(null)}
                      />
                    </DialogContent>
                  </Dialog>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={pendingDeleteId === item.id}
                    onClick={() => handleDelete(item.id)}
                  >
                    <TrashIcon />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </CardHeader>
              {item.content && (
                <CardContent>
                  <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">
                    {item.content}
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/// `YYYY-MM-DD` for a native `<input type="date">`, or `""` if the stored
/// value is absent — `<input>` value props reject `null`/`undefined`.
function toDateInputValue(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function FacetForm({
  itemLabel,
  fields,
  defaultValues,
  action,
  onDone,
}: {
  itemLabel: string;
  fields: FacetField[];
  defaultValues?: Record<string, unknown>;
  action: (input: unknown) => Promise<ActionResult>;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setIsSubmitting(true);

    const input: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === "checkbox") {
        input[field.name] = formData.get(field.name) === "on";
      } else {
        input[field.name] = formData.get(field.name) ?? "";
      }
    }

    const result = await action(input);
    setIsSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {defaultValues ? `Edit ${itemLabel.toLowerCase()}` : `Add ${itemLabel.toLowerCase()}`}
        </DialogTitle>
        <DialogDescription>
          This feeds your AI-generated content later, so the more specific the
          better.
        </DialogDescription>
      </DialogHeader>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        {fields.map((field) => {
          const rawDefault = defaultValues?.[field.name];
          if (field.type === "checkbox") {
            return (
              <label
                key={field.name}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  name={field.name}
                  defaultChecked={Boolean(rawDefault)}
                  className="size-4"
                />
                {field.label}
              </label>
            );
          }

          const defaultValue =
            field.type === "date"
              ? toDateInputValue(rawDefault)
              : ((rawDefault as string | undefined) ?? "");

          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              <Label htmlFor={field.name}>{field.label}</Label>
              {field.type === "textarea" ? (
                <Textarea
                  id={field.name}
                  name={field.name}
                  required={field.required}
                  placeholder={field.placeholder}
                  defaultValue={defaultValue}
                  rows={5}
                />
              ) : (
                <Input
                  id={field.name}
                  name={field.name}
                  type={field.type === "url" ? "url" : field.type}
                  required={field.required}
                  placeholder={field.placeholder}
                  defaultValue={defaultValue}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
