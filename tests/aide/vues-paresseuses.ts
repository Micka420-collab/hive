// Laisser finir les vues paresseuses AVANT de démonter un banc d'App.
//
// L'App charge ses vues par `React.lazy` : un changement d'écran lance un
// import dynamique. Si le morceau arrive après la dernière fenêtre `act()` du
// cas — un runner chargé suffit —, React le signale sur stderr (« A suspended
// resource finished loading inside a test, but the event was not wrapped in
// act(...) »). Quand ce message part pendant le démontage du fichier, le pool
// ferme son canal alors que le journal console est encore en vol :
// `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was
// pending` — une erreur non gérée qui rougit la suite alors que tous les tests
// sont verts (vu sur la jambe « plusieurs ordres », graine 15838).
//
// Attendre les imports en cours DANS `act()` rend l'arrivée du morceau
// observable par React avant le démontage : plus de message tardif, plus de
// course avec la fermeture du canal.

import { act } from 'react';
import { vi } from 'vitest';

export async function laisserFinirLesVuesParesseuses(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}
