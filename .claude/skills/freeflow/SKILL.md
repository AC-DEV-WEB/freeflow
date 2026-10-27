---
name: freeflow
description: Reprendre, modifier ou publier FreeFlow, la dictée vocale gratuite et 100 % locale (clone libre de Wispr Flow) pour Windows et Mac, construite en Electron + faster-whisper. Utiliser dès qu'on travaille dans ce dépôt, qu'on ajoute une fonction, corrige un bug, traduit un texte, change l'interface, refait les captures du guide, construit l'installateur ou publie une release FreeFlow sur GitHub.
---

# FreeFlow

Avant toute modification, lis `contexte/README.md` puis le fichier du dossier `contexte/` qui correspond à la tâche :

- **01-but-et-histoire.md** : le but, les versions, les décisions (pas de LLM local, pas de mode commande : « c'est juste du speech to text »).
- **02-code.md** : la carte du code, le chemin d'une dictée, les conventions, les pièges déjà rencontrés.
- **03-mettre-a-jour.md** : l'environnement, les commandes de test, la procédure de release, comment ajouter un texte ou une langue.
- **04-direction-artistique.md** : la palette, la typographie, les composants, le ton (simple et épuré, tutoiement, phrases courtes).
- **05-skills-et-outils.md** : quels skills utiliser (REA pour étudier Wispr Flow, `higgsfield-generate` pour les images, `motion-simple-epure` pour les vidéos…).

## Règles

1. Tout reste local : aucun appel réseau avec la voix, le texte ou le dictionnaire.
2. Pas de LLM ni de « mode commande » : FreeFlow fait de la dictée, point.
3. Chaque texte visible passe par `t()` (fenêtres) ou `tr()` (`main.js`), et ses traductions anglaise, arabe et chinoise vont dans `lib/i18n.js`. Dans le CSS, des propriétés logiques (`inline-start`/`end`), jamais `left`/`right` : l'arabe se lit de droite à gauche.
4. Aucun test de collage hors de la fenêtre de FreeFlow (`PasteHelper.exe --only-if electron`). Aucune capture de l'écran entier : seulement `webContents.capturePage()`.
5. Les commandes de test se lancent toujours avec `--user-data-dir=<dossier temporaire>` pour ne pas toucher aux données réelles. Avant `electron .`, retire `ELECTRON_RUN_AS_NODE`.
6. Rien de personnel dans le dépôt ni dans l'installateur. Avant chaque release : `python scripts/scan_secrets.py release/FreeFlow-win32-x64`.
7. Une mise à jour ne supprime jamais les données de l'utilisateur.

## Avant de dire « c'est fini »

- `npm test` passe.
- `electron . --lang-shots=<dossier> --user-data-dir=<temp> --exit` est lancé et les captures ont été regardées : français, anglais, arabe de droite à gauche, chinois.
- Si l'écran Dictionnaire a changé : `--guide-shots` est relancé.
- `CHANGELOG.md` est complété, côté utilisateur et en français simple.
- Pour une release : la procédure de `contexte/03-mettre-a-jour.md` est suivie (version, `npm run release`, scan, installation, `gh release create`, le dmg Mac joint par le workflow, les liens `releases/latest/download/` vérifiés).
