import { describe, expect, it } from 'vitest';
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
});
