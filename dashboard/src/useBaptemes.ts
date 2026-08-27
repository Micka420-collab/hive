// Baptêmes constatés (ADR 0010) — une seule sonde pour Ruche / Essaim.
//
// Échec réseau ou 401 : on laisse `null` (noms techniques), on n'affirme
// jamais « Pas encore baptisée » sans liste reçue.

import { useEffect, useState } from 'react';
import { fetchBaptemes } from './api';

/**
 * `null` = pas encore chargé (ou échec) ;
 * map nodeId → `string` baptême / `null` absent constaté.
 */
export function useBaptemes(
  nodeIdsKey: string,
  refreshTick = 0,
): Record<string, string | null> | null {
  const [baptemes, setBaptemes] = useState<Record<string, string | null> | null>(null);

  useEffect(() => {
    let vivant = true;
    fetchBaptemes()
      .then((r) => {
        if (!vivant) return;
        const map: Record<string, string | null> = {};
        for (const id of nodeIdsKey.split(',').filter(Boolean)) map[id] = null;
        for (const b of r.baptemes) map[b.nodeId] = b.nom;
        setBaptemes(map);
      })
      .catch(() => {
        /* silence — garder les noms techniques */
      });
    return () => {
      vivant = false;
    };
  }, [nodeIdsKey, refreshTick]);

  return baptemes;
}

/** Baptême constaté s’il existe, sinon le nom technique. */
export function nomConstate(
  baptemes: Record<string, string | null> | null | undefined,
  nodeId: string,
  technique: string,
): string {
  const b = baptemes?.[nodeId];
  return b || technique;
}
