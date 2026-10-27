# Le but et l'histoire de FreeFlow

## Le but

Wispr Flow est une excellente dictée vocale, mais elle est payante et envoie la voix dans le cloud. FreeFlow fait la même chose gratuitement (licence MIT), entièrement sur l'ordinateur :

- un raccourci global lance l'écoute, puis le texte transcrit est **collé dans l'application active** (mail, Slack, VS Code, ChatGPT…) ;
- la transcription tourne en local avec **faster-whisper** : sur la carte graphique NVIDIA quand il y en a une (large-v3, moins d'une seconde), sinon sur le processeur ;
- un **dictionnaire** corrige les mots que le modèle écorche (« n huit n » devient « n8n », « x field » devient « Higgsfield »).

FreeFlow s'adresse à des créateurs et des indépendants, pas à des développeurs : l'interface doit rester simple, en phrases courtes, sans jargon.

## Les versions

| Version | Date | Ce qu'elle a apporté |
|---|---|---|
| 1.0.0 | 18/10/2026 | Première version Windows. Le fonctionnement de Wispr Flow a été étudié avec le skill **REA** (Reverse Engineer Anything, dépôt `morluto/rea`) puis reconstruit : pastille animée, raccourci, historique, dictionnaire, snippets, moteur local sur GPU. |
| 1.1.0 | 25/10/2026 | **Version Mac** (puce Apple, construite et testée par GitHub Actions). **Dictionnaire en Excel** : modèle à deux colonnes, exemple rempli, import d'un CSV, d'une liste collée ou du dictionnaire Wispr Flow. Boutons **Deviner** (la voix de l'ordinateur prononce le mot, le modèle l'écoute) et **Dis-le** (on le prononce soi-même). |
| 1.2.0 | 27/10/2026 | **Collage automatique réparé** : il ne marchait jamais, la structure envoyée à `SendInput` faisait 32 octets au lieu de 40. **La barre** en bas de l'écran et son **déroulé** (`Ctrl + Alt + H`). **Réunions** : micro et son de l'ordinateur sur deux pistes, transcription « Moi / Eux ». **Notes**. **Apprentissage des corrections** : un mot corrigé juste après une dictée est proposé au dictionnaire. Lancement au démarrage. **Installateur habillé** (bandeau, choix du dossier). **Tutoriel** au premier lancement. **Quatre langues** (français, anglais, arabe, chinois). **Le fichier Excel expliqué en images**. |

Le détail de chaque version se trouve dans [CHANGELOG.md](../CHANGELOG.md).

## Les décisions, et pourquoi

- **Pas de LLM local ni de « mode commande ».** Ils ont été proposés puis refusés : « nous c'est juste du speech to text ». La mise en forme reste faite par des règles simples ([lib/format.js](../lib/format.js)).
- **Le dictionnaire, c'est deux colonnes** : le mot correct, puis ce que le modèle entend à la place. Un tableur Excel est le format le plus simple pour le grand public. On peut aussi laisser la colonne B vide : FreeFlow devine les variantes.
- **Réunions sans robot dans l'appel.** C'est inspiré de `jankeesvw/omarchy-meeting-recorder` : on enregistre le micro et le son de l'ordinateur à part, puis on transcrit en local. Aucun bot ne rejoint la réunion.
- **L'apprentissage des corrections lit le champ où le texte a été collé** (UI Automation sous Windows, Accessibilité sous Mac), pendant 45 secondes au plus. Le texte lu reste en mémoire et n'est jamais enregistré. Les champs mot de passe ne sont jamais lus.
- **Gratuit, sans compte, sans télémétrie.** Le code est public sur GitHub (`AlanECE/freeflow`) et les releases contiennent l'installateur Windows et le `.dmg` Mac.

## Ce qui reste à faire ou à surveiller

- L'installateur Windows n'existe qu'en français : l'application, elle, est en quatre langues.
- La dictée en arabe et en chinois marche, mais la fonction « Deviner » s'appuie sur les voix françaises et anglaises du système.
- L'appli n'est pas signée (ni certificat Windows, ni notarisation Apple) : SmartScreen et Gatekeeper affichent un avertissement au premier lancement, expliqué dans le README.
- L'exécutable dépasse 900 Mo (moteur CUDA compris), ce qui l'empêche de passer sur VirusTotal par simple envoi de fichier.
