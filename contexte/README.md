# Contexte de FreeFlow : commence ici

Ce dossier sert à reprendre FreeFlow sans avoir suivi son histoire : le but de l'appli, ce qui a été décidé et pourquoi, où est le code, comment publier une mise à jour, quelle allure elle doit garder.

**FreeFlow en une phrase.** Une dictée vocale gratuite et 100 % locale pour Windows et Mac : tu appuies sur un raccourci, tu parles, le texte s'écrit là où se trouve ton curseur. C'est l'équivalent libre de Wispr Flow, sans abonnement et sans envoyer la voix sur Internet.

| Fichier | Ce que tu y trouves |
|---|---|
| [01-but-et-histoire.md](01-but-et-histoire.md) | Pourquoi l'appli existe, les versions, les décisions et ce qui a été refusé |
| [02-code.md](02-code.md) | La carte du code, le chemin d'une dictée, les pièges déjà rencontrés |
| [03-mettre-a-jour.md](03-mettre-a-jour.md) | Installer l'environnement, tester, construire, publier une version, ajouter une langue |
| [04-direction-artistique.md](04-direction-artistique.md) | Palette, typographie, composants, ton des textes : simple et épuré |
| [05-skills-et-outils.md](05-skills-et-outils.md) | Les skills Claude Code et les outils à utiliser (Higgsfield pour les images, etc.) |

Les mêmes règles existent sous forme de skill Claude Code : [`.claude/skills/freeflow/SKILL.md`](../.claude/skills/freeflow/SKILL.md). Ouvre le dépôt dans Claude Code et il se charge tout seul dès qu'on parle de FreeFlow.

Pour le détail technique fichier par fichier, lis aussi [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). Pour ce que voit l'utilisateur, lis [README.md](../README.md) et [CHANGELOG.md](../CHANGELOG.md).

## Les 7 règles à ne jamais casser

1. **Tout reste sur l'ordinateur.** Aucune requête réseau avec la voix, le texte ou le dictionnaire. Le seul téléchargement, c'est le modèle Whisper au premier lancement.
2. **FreeFlow fait de la dictée (speech to text), rien d'autre.** Pas de LLM local, pas de « mode commande », pas de réécriture par IA : c'est une décision du propriétaire du projet.
3. **Rien de personnel dans le dépôt ni dans l'installateur** : aucune clé, aucun chemin de ton disque, aucun `.env`. Fais un scan avant chaque release (voir 03).
4. **Aucun test de collage dans une autre fenêtre que celle de FreeFlow.** Un `Ctrl + V` simulé envoyé au mauvais endroit peut fermer un éditeur ou coller du texte dans une conversation.
5. **Chaque texte visible passe par la traduction** (`t('phrase française')`), dans les quatre langues : français, anglais, arabe et chinois.
6. **Les données de l'utilisateur ne sont jamais effacées par une mise à jour** (`%APPDATA%\FreeFlow`, `~/Library/Application Support/FreeFlow`).
7. **Rien n'est publié sans tests** : `npm test`, une dictée réelle, et les captures de contrôle des quatre langues.
