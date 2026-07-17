"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  runKnowledgeBaseSync,
  testRetrieval,
  type SyncActionResult,
  type TestRetrievalResult,
} from "@/features/rag/actions";

export function RagSyncPanel({ initialChunkCount }: { initialChunkCount: number }) {
  const [chunkCount, setChunkCount] = useState(initialChunkCount);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncActionResult | null>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<TestRetrievalResult | null>(
    null,
  );

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    const result = await runKnowledgeBaseSync();
    setSyncing(false);
    setSyncResult(result);
    if ("success" in result) {
      setChunkCount(
        (prev) =>
          prev + result.result.created - result.result.deleted,
      );
    }
  }

  async function handleSearch() {
    setSearching(true);
    setSearchResult(null);
    const result = await testRetrieval(query);
    setSearching(false);
    setSearchResult(result);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Sync to RAG index</CardTitle>
          <CardDescription>
            Re-embeds anything new or changed across your Knowledge Base since
            the last sync, and removes entries whose source was deleted. Run
            this after editing any facet — it doesn&apos;t happen automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync now"}
            </Button>
            <span className="text-muted-foreground text-sm">
              {chunkCount} chunk{chunkCount === 1 ? "" : "s"} indexed
            </span>
          </div>
          {syncResult && "error" in syncResult && (
            <p className="text-destructive text-sm">{syncResult.error}</p>
          )}
          {syncResult && "success" in syncResult && (
            <p className="text-muted-foreground text-sm">
              {syncResult.result.created} created, {syncResult.result.updated}{" "}
              updated, {syncResult.result.deleted} removed
              {syncResult.result.failed > 0 &&
                `, ${syncResult.result.failed} failed`}
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test retrieval</CardTitle>
          <CardDescription>
            Type a topic and see which Knowledge Base chunks would be pulled
            in as context for it — this is what the Planning Agent will use
            later.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rag-query">Query</Label>
            <div className="flex gap-2">
              <Input
                id="rag-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. AI agents replacing SaaS"
              />
              <Button
                size="sm"
                onClick={handleSearch}
                disabled={searching || query.trim().length === 0}
              >
                {searching ? "Searching..." : "Search"}
              </Button>
            </div>
          </div>

          {searchResult && "error" in searchResult && (
            <p className="text-destructive text-sm">{searchResult.error}</p>
          )}
          {searchResult && "success" in searchResult && (
            <div className="grid gap-2">
              {searchResult.chunks.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No chunks found — sync your Knowledge Base first.
                </p>
              ) : (
                searchResult.chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="rounded-lg border p-3 text-sm"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant="secondary">{chunk.sourceType}</Badge>
                      <span className="text-muted-foreground text-xs">
                        similarity {chunk.similarity.toFixed(3)}
                      </span>
                    </div>
                    <p className="text-muted-foreground line-clamp-2">
                      {chunk.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
