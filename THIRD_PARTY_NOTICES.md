# Code tiers porté dans Hive

Hive est publié sous licence MIT (voir [LICENSE](LICENSE)). Les fichiers
ci-dessous contiennent du code **porté** d'autres projets ; leur notice
d'origine est reproduite ici, comme leur licence l'exige, et rappelée en tête
du fichier concerné.

## Paperclip — `src/orchestrator/cron.ts`

Analyse des expressions cron à cinq champs et marche vers l'échéance suivante,
portées de `server/src/services/cron.ts` (https://github.com/paperclipai/paperclip).
Modifications de Hive : lecture dans un fuseau horaire (heure d'été comprise),
règle du OU de cron entre jour du mois et jour de semaine, `7` = dimanche.
Les noms des politiques de routine (`coalesce_if_active`, `skip_if_active`,
`always_enqueue`, `skip_missed`, `enqueue_missed_with_cap`) reprennent ceux de
`packages/shared/src/constants.ts`.

```
MIT License

Copyright (c) 2025 Paperclip AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
