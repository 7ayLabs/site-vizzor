'use client';

/**
 * ChatBubble — a single message in the thread.
 *
 * Layout is intentionally chat-app-flat: no avatars, no gradients,
 * just the role label + body. User messages right-align with a tinted
 * surface; assistant messages left-align flush. Body is rendered as
 * <pre> with `mono tabular` to preserve the Vizzor receipt format's
 * column alignment + emoji.
 */

import type { useChat } from '@ai-sdk/react';

type Message = ReturnType<typeof useChat>['messages'][number];

export function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const text = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => ('text' in p ? p.text : ''))
    .join('');

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
        {isUser ? 'you' : 'vizzor'}
      </span>
      <pre
        className={`
          mono tabular text-[12.5px] leading-relaxed
          whitespace-pre-wrap break-words
          max-w-[42rem] px-3 py-2
          border border-[var(--border)]
          ${
            isUser
              ? 'bg-[var(--surface-2)] text-[var(--fg)]'
              : 'bg-[var(--surface)] text-[var(--fg)]'
          }
        `}
      >
        {text || (isUser ? '' : '…')}
      </pre>
    </div>
  );
}
