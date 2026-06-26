import { describe, it, expect } from 'vitest';
import {
  createConversation,
  getConversationForWallet,
  listConversationsForWallet,
  appendConversationMessage,
  listMessagesForConversation,
  deleteConversationForWallet,
} from '@/lib/payment/db';

const WALLET_A = 'AaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const WALLET_B = 'BbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';

describe('conversation ownership boundary', () => {
  it('getConversationForWallet returns the row for the owner', () => {
    const conv = createConversation({
      id: 'conv-1',
      wallet: WALLET_A,
      title: 'Owner-only thread',
    });
    const fetched = getConversationForWallet(conv.id, WALLET_A);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe('conv-1');
    expect(fetched?.title).toBe('Owner-only thread');
  });

  it('getConversationForWallet returns null for a non-owner', () => {
    createConversation({ id: 'conv-2', wallet: WALLET_A, title: 'Private' });
    // The query is `WHERE id = ? AND wallet_address = ?` — a non-owner
    // wallet must get null, NOT the row. Matches the route's 404 posture
    // (no existence disclosure to non-owners).
    const fetched = getConversationForWallet('conv-2', WALLET_B);
    expect(fetched).toBeNull();
  });

  it('listConversationsForWallet scopes by wallet', () => {
    createConversation({ id: 'a1', wallet: WALLET_A, title: 'A thread' });
    createConversation({ id: 'b1', wallet: WALLET_B, title: 'B thread' });

    const aList = listConversationsForWallet(WALLET_A);
    expect(aList.map((r) => r.id)).toEqual(['a1']);

    const bList = listConversationsForWallet(WALLET_B);
    expect(bList.map((r) => r.id)).toEqual(['b1']);
  });

  it('listMessagesForConversation does not enforce ownership at the SQL layer — the route MUST gate first', () => {
    // Intentionally documents that listMessagesForConversation by id
    // alone returns rows for any caller. The route is the authz boundary
    // — it calls getConversationForWallet FIRST and only invokes
    // listMessagesForConversation if that succeeds. This test pins the
    // contract so a future refactor that calls listMessagesForConversation
    // directly without a prior ownership check is caught in review.
    const conv = createConversation({
      id: 'conv-msg',
      wallet: WALLET_A,
      title: 'Has messages',
    });
    appendConversationMessage({
      id: 'msg-1',
      conversationId: conv.id,
      role: 'user',
      content: 'hello',
    });
    const messages = listMessagesForConversation(conv.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('hello');
  });

  it('deleteConversationForWallet refuses to delete another wallet’s row', () => {
    createConversation({ id: 'conv-3', wallet: WALLET_A, title: 'Mine' });
    const deletedByOther = deleteConversationForWallet('conv-3', WALLET_B);
    expect(deletedByOther).toBe(false);
    // Row still exists for the owner.
    const stillThere = getConversationForWallet('conv-3', WALLET_A);
    expect(stillThere).not.toBeNull();
  });
});
