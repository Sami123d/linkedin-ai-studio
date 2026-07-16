"use client";

import { FileIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteResumeFile,
  getResumeFileSignedUrl,
  saveResumeContent,
  uploadResumeFile,
} from "@/features/knowledge-base/resume/actions";

export function ResumeManager({
  initialContent,
  fileName,
}: {
  initialContent: string;
  fileName: string | null;
}) {
  const [content, setContent] = useState(initialContent);
  const [savingText, setSavingText] = useState(false);
  const [textMessage, setTextMessage] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState(fileName);

  async function handleSaveText() {
    setSavingText(true);
    setTextMessage(null);
    setTextError(null);
    const result = await saveResumeContent({ content });
    setSavingText(false);
    if ("error" in result) {
      setTextError(result.error);
    } else {
      setTextMessage(result.message ?? "Saved.");
    }
  }

  async function handleUpload(formData: FormData) {
    setUploading(true);
    setFileError(null);
    const result = await uploadResumeFile(formData);
    setUploading(false);
    if ("error" in result) {
      setFileError(result.error);
      return;
    }
    const file = formData.get("file");
    setCurrentFileName(file instanceof File ? file.name : currentFileName);
  }

  async function handleDownload() {
    const url = await getResumeFileSignedUrl();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleRemoveFile() {
    if (!confirm("Remove the uploaded resume file?")) return;
    await deleteResumeFile();
    setCurrentFileName(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={12}
          placeholder="Paste your resume/CV text here — this is what the AI will read to know your background."
        />
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={handleSaveText}
            disabled={savingText || content.trim().length === 0}
          >
            {savingText ? "Saving..." : "Save resume text"}
          </Button>
          {textMessage && (
            <span className="text-muted-foreground text-sm">
              {textMessage}
            </span>
          )}
          {textError && (
            <span className="text-destructive text-sm">{textError}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-medium">Resume file (optional)</p>
        <p className="text-muted-foreground text-sm">
          Keep the original PDF/DOCX on file alongside the pasted text above.
        </p>
        {currentFileName ? (
          <div className="flex items-center gap-2 text-sm">
            <FileIcon className="text-muted-foreground size-4" />
            <button
              type="button"
              onClick={handleDownload}
              className="underline underline-offset-4"
            >
              {currentFileName}
            </button>
            <Button size="icon-sm" variant="ghost" onClick={handleRemoveFile}>
              <TrashIcon />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>
        ) : (
          <form
            action={handleUpload}
            className="flex flex-wrap items-center gap-3"
          >
            <input
              type="file"
              name="file"
              accept=".pdf,.doc,.docx,.txt"
              required
              className="text-sm"
            />
            <Button type="submit" size="sm" variant="outline" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </form>
        )}
        {fileError && (
          <span className="text-destructive text-sm">{fileError}</span>
        )}
      </div>
    </div>
  );
}
