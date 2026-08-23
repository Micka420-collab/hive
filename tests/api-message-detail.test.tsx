// @vitest-environment happy-dom
//
// ApiError doit porter le `detail` du serveur — sinon un 501 GitHub ou un 401
// « token invalide » n'affiche que le titre court et cache la marche à suivre.

import { describe, expect, it } from 'vitest';
import { messageApi } from '../dashboard/src/api';

describe('messageApi — le détail ne disparaît plus', () => {
  it('assemble erreur + détail quand ils diffèrent', () => {
    const { message, detail } = messageApi(
      {
        error: 'GitHub non connecté',
        detail: 'Définissez HIVE_GITHUB_TOKEN puis relancez.',
      },
      501,
    );
    expect(detail).toContain('HIVE_GITHUB_TOKEN');
    expect(message).toContain('GitHub non connecté');
    expect(message).toContain('HIVE_GITHUB_TOKEN');
  });

  it('ne duplique pas quand erreur et détail sont identiques', () => {
    const { message } = messageApi({ error: 'token invalide', detail: 'token invalide' }, 401);
    expect(message).toBe('token invalide');
  });

  it('préfère message (schéma Fastify) à error générique', () => {
    const { message } = messageApi(
      { error: 'Bad Request', message: 'body/fullName must be string' },
      400,
    );
    expect(message).toContain('fullName');
  });
});
