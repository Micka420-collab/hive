import { describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import { EDITION_PAR_DEFAUT, editionDepuisEnv, secretWebhookExige } from '../src/shared/edition.js';

describe('édition Community / Cloud', () => {
  it('le défaut est community — une faute de frappe ne bascule pas en cloud', () => {
    expect(editionDepuisEnv({})).toBe(EDITION_PAR_DEFAUT);
    expect(editionDepuisEnv({ HIVE_EDITION: 'nuage' })).toBe('community');
    expect(editionDepuisEnv({ HIVE_EDITION: 'CLOUD' })).toBe('community');
    expect(editionDepuisEnv({ HIVE_EDITION: 'cloud' })).toBe('cloud');
  });

  it('Cloud hors simulation EXIGE un secret de webhook ; Community non', () => {
    expect(secretWebhookExige('cloud', false)).toBe(true);
    expect(secretWebhookExige('cloud', true)).toBe(false);
    expect(secretWebhookExige('community', false)).toBe(false);
  });

  it('une Queen cloud SANS secret refuse de démarrer', async () => {
    const avant = process.env.HIVE_WEBHOOK_SECRET;
    delete process.env.HIVE_WEBHOOK_SECRET;
    try {
      await expect(
        createServer({
          port: 0,
          host: '127.0.0.1',
          token: 'jeton-cloud-assez-long-xx',
          corsOrigins: ['http://localhost:5173'],
          dbPath: ':memory:',
          simulation: false,
          edition: 'cloud',
        }),
      ).rejects.toThrow(/HIVE_WEBHOOK_SECRET/);
    } finally {
      if (avant === undefined) delete process.env.HIVE_WEBHOOK_SECRET;
      else process.env.HIVE_WEBHOOK_SECRET = avant;
    }
  });
});
