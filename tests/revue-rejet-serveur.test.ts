// @vitest-environment happy-dom
//
// Une revue optimiste refusée par le serveur ne doit jamais rester affichée
// comme une décision enregistrée.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postReview: vi.fn(),
}));

import { ApiError, postReview } from '../dashboard/src/api';
import {
  countUnsyncedReviews,
  getReview,
  hydrateReviews,
  setReview,
} from '../dashboard/src/views/shared';

const erreurs: Array<{ taskId: string; definitive: boolean }> = [];

function ecouter(event: Event): void {
  erreurs.push((event as CustomEvent<{ taskId: string; definitive: boolean }>).detail);
}

async function drainer(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  erreurs.length = 0;
  vi.mocked(postReview).mockReset();
  window.addEventListener('hive:review-sync-error', ecouter);
});

afterEach(() => {
  window.removeEventListener('hive:review-sync-error', ecouter);
  localStorage.clear();
});

describe('revue refusée par le serveur', () => {
  it('restaure le verdict serveur sur un échec définitif', async () => {
    hydrateReviews({ 't-definitive': 'approved' });
    vi.mocked(postReview).mockRejectedValue(new ApiError('tâche inconnue', 404));

    setReview('t-definitive', 'rejected');
    expect(getReview('t-definitive')).toBe('rejected');
    await drainer();

    expect(getReview('t-definitive')).toBe('approved');
    expect(countUnsyncedReviews()).toBe(0);
    expect(erreurs).toContainEqual(
      expect.objectContaining({ taskId: 't-definitive', definitive: true }),
    );
  });

  it('conserve le verdict dans la file sur une panne transitoire', async () => {
    hydrateReviews({});
    vi.mocked(postReview).mockRejectedValue(new Error('réseau coupé'));

    setReview('t-transitoire', 'approved');
    await drainer();

    expect(getReview('t-transitoire')).toBe('approved');
    expect(countUnsyncedReviews()).toBe(1);
    expect(erreurs).toContainEqual(
      expect.objectContaining({ taskId: 't-transitoire', definitive: false }),
    );
  });
});
