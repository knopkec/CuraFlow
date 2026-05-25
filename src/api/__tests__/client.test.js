import { describe, expect, it } from 'vitest';

import { resolveRequestRetryable } from '../client';

describe('resolveRequestRetryable', () => {
  it('does not mark non-database failures as retryable', () => {
    expect(resolveRequestRetryable({
      status: 500,
      errorData: {},
      databaseError: false,
    })).toBe(false);
  });

  it('respects explicit non-retryable flags from the server', () => {
    expect(resolveRequestRetryable({
      status: 500,
      errorData: {
        code: 'ER_DBACCESS_DENIED_ERROR',
        retryable: false,
      },
      databaseError: true,
    })).toBe(false);
  });

  it('keeps retrying transient database failures when the server allows it', () => {
    expect(resolveRequestRetryable({
      status: 503,
      errorData: {
        code: 'PROTOCOL_CONNECTION_LOST',
        retryable: true,
      },
      databaseError: true,
    })).toBe(true);
  });

  it('falls back to retrying server-side database failures when no retry hint is present', () => {
    expect(resolveRequestRetryable({
      status: 500,
      errorData: {
        code: 'ER_LOCK_WAIT_TIMEOUT',
      },
      databaseError: true,
    })).toBe(true);
  });
});