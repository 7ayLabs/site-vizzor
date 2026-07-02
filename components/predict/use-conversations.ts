'use client';

/**
 * useConversations — SWR-backed sidebar chat history hook.
 *
 * Replaces the localStorage-only prompts list. Every operation is
 * SIWS-gated server-side; if the user isn't signed in the hook
 * returns an empty list and the create/persist helpers no-op
 * (the API would 401 anyway).
 *
 * The hook exposes both raw SWR state (`isLoading`, `mutate`) and a
 * handful of imperative helpers callers run inside event handlers.
 * Each mutating helper revalidates the list at the end so the
 * sidebar order reflects the latest `updated_at`.
 */

import { useCallback } from 'react';
import useSWR from 'swr';

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

interface ListResponse {
  ok: boolean;
  conversations?: ConversationSummary[];
  reason?: string;
}

interface CreateResponse {
  ok: boolean;
  conversation?: ConversationSummary;
  reason?: string;
}

interface GetResponse {
  ok: boolean;
  conversation?: ConversationSummary;
  messages?: ConversationMessage[];
  reason?: string;
}

/**
 * v0.5.1 — thrown when a conversation still has active workflows.
 * Callers show a confirm modal and re-invoke with `{ force: true }`.
 */
export class WorkflowsBlockingDeleteError extends Error {
  readonly count: number;
  readonly kinds: string[];
  constructor(opts: { count: number; kinds: string[] }) {
    super(`active_workflows:${opts.count}`);
    this.name = 'WorkflowsBlockingDeleteError';
    this.count = opts.count;
    this.kinds = opts.kinds;
  }
}

const jsonFetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  return (await res.json()) as T;
};

export function useConversations(opts: { enabled: boolean }) {
  const { data, isLoading, mutate } = useSWR<ListResponse>(
    opts.enabled ? '/api/conversations' : null,
    jsonFetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const conversations: ConversationSummary[] = data?.ok
    ? (data.conversations ?? [])
    : [];

  const createConversation = useCallback(
    async (firstMessage?: string): Promise<ConversationSummary | null> => {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ firstMessage }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as CreateResponse;
      if (!json.ok || !json.conversation) return null;
      void mutate();
      return json.conversation;
    },
    [mutate],
  );

  const loadConversation = useCallback(
    async (
      id: string,
    ): Promise<{ conversation: ConversationSummary; messages: ConversationMessage[] } | null> => {
      const res = await fetch(`/api/conversations/${id}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return null;
      const json = (await res.json()) as GetResponse;
      if (!json.ok || !json.conversation || !json.messages) return null;
      return { conversation: json.conversation, messages: json.messages };
    },
    [],
  );

  /**
   * v0.5.1 — thrown when a conversation carries active (pending or
   * signed) capability intents and the caller didn't pass
   * `force: true`. The shell catches this to show a confirm modal;
   * the user can then re-call `deleteConversation(id, { force: true })`.
   */
  const deleteConversation = useCallback(
    async (
      id: string,
      opts?: { force?: boolean },
    ): Promise<boolean> => {
      const qs = opts?.force ? '?force=1' : '';
      const res = await fetch(`/api/conversations/${id}${qs}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.status === 409) {
        // Surface the guard through a typed error the shell can
        // pattern-match without parsing a plain string.
        type GuardBody = {
          reason?: string;
          count?: number;
          kinds?: string[];
        };
        let payload: GuardBody | null = null;
        try {
          payload = (await res.json()) as GuardBody;
        } catch {
          /* body might be empty — fall through */
        }
        throw new WorkflowsBlockingDeleteError({
          count: payload?.count ?? 0,
          kinds: payload?.kinds ?? [],
        });
      }
      if (res.ok) void mutate();
      return res.ok;
    },
    [mutate],
  );

  const renameConversation = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ title }),
      });
      if (res.ok) void mutate();
      return res.ok;
    },
    [mutate],
  );

  const persistMessage = useCallback(
    async (
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
    ): Promise<void> => {
      if (!content.trim()) return;
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ role, content }),
      });
      // No revalidation here: the per-message persist runs in a tight
      // loop during streaming, and the list ordering only changes once
      // per turn — we revalidate the list on the assistant-final
      // persist via `bumpRecency` below.
    },
    [],
  );

  const bumpRecency = useCallback((): void => {
    void mutate();
  }, [mutate]);

  return {
    conversations,
    isLoading,
    mutate,
    createConversation,
    loadConversation,
    deleteConversation,
    renameConversation,
    persistMessage,
    bumpRecency,
  };
}
