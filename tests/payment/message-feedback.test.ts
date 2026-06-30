import { describe, it, expect } from 'vitest';
import {
  setMessageFeedback,
  getMessageFeedback,
  createConversation,
  appendConversationMessage,
} from '@/lib/payment/db';

const WALLET = 'FbFbFbFbFbFbFbFbFbFbFbFbFbFbFbFbFbFbFbFbFbFb';
const OTHER = 'OoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOo';

describe('message_feedback persistence', () => {
  it('upserts a feedback row', () => {
    const conv = createConversation({
      id: 'fb-conv-1',
      wallet: WALLET,
      title: 'feedback test',
    });
    appendConversationMessage({
      id: 'fb-msg-1',
      conversationId: conv.id,
      role: 'assistant',
      content: 'test response',
    });

    setMessageFeedback({
      messageId: 'fb-msg-1',
      conversationId: conv.id,
      wallet: WALLET,
      value: 'up',
    });

    const row = getMessageFeedback('fb-msg-1', WALLET);
    expect(row?.value).toBe('up');
    expect(row?.wallet_address).toBe(WALLET);
  });

  it('updates the value on toggle', () => {
    const conv = createConversation({
      id: 'fb-conv-2',
      wallet: WALLET,
      title: 'toggle test',
    });
    setMessageFeedback({
      messageId: 'fb-msg-2',
      conversationId: conv.id,
      wallet: WALLET,
      value: 'up',
    });
    setMessageFeedback({
      messageId: 'fb-msg-2',
      conversationId: conv.id,
      wallet: WALLET,
      value: 'down',
    });

    expect(getMessageFeedback('fb-msg-2', WALLET)?.value).toBe('down');
  });

  it('deletes the row when value is null', () => {
    const conv = createConversation({
      id: 'fb-conv-3',
      wallet: WALLET,
      title: 'clear test',
    });
    setMessageFeedback({
      messageId: 'fb-msg-3',
      conversationId: conv.id,
      wallet: WALLET,
      value: 'down',
    });
    setMessageFeedback({
      messageId: 'fb-msg-3',
      conversationId: conv.id,
      wallet: WALLET,
      value: null,
    });

    expect(getMessageFeedback('fb-msg-3', WALLET)).toBeNull();
  });

  it('scopes by wallet — another wallet cannot read or overwrite', () => {
    const conv = createConversation({
      id: 'fb-conv-4',
      wallet: WALLET,
      title: 'scope test',
    });
    setMessageFeedback({
      messageId: 'fb-msg-4',
      conversationId: conv.id,
      wallet: WALLET,
      value: 'up',
    });

    // A different wallet sees nothing for the same message id.
    expect(getMessageFeedback('fb-msg-4', OTHER)).toBeNull();

    // And clearing from the other wallet leaves the original row alone.
    setMessageFeedback({
      messageId: 'fb-msg-4',
      conversationId: conv.id,
      wallet: OTHER,
      value: null,
    });
    expect(getMessageFeedback('fb-msg-4', WALLET)?.value).toBe('up');
  });

  it('CHECK constraint rejects an invalid value at the DB layer', () => {
    const conv = createConversation({
      id: 'fb-conv-5',
      wallet: WALLET,
      title: 'enum test',
    });
    expect(() =>
      setMessageFeedback({
        messageId: 'fb-msg-5',
        conversationId: conv.id,
        wallet: WALLET,
        // @ts-expect-error — intentionally violates the type contract
        value: 'maybe',
      }),
    ).toThrow();
  });
});
