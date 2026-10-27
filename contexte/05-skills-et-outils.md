# Skills et outils à utiliser

FreeFlow a été construit avec Claude Code. Le skill du projet, [`.claude/skills/freeflow`](../.claude/skills/freeflow/SKILL.md), se charge tout seul quand on travaille dans ce dépôt. Les autres skills ci-dessous viennent de l'installation Claude Code du propriétaire. Sur une autre machine, installe ceux dont tu as besoin, ou fais la même chose à la main.

## Pour le code

| Skill / outil | Quand l'utiliser |
|---|---|
| `freeflow` (ce dépôt) | Toujours : les règles, la carte du code, la liste de vérification avant une release |
| **REA** (Reverse Engineer Anything, `morluto/rea`) | Pour étudier comment Wispr Flow fait une fonction avant de la refaire. C'est ainsi qu'ont été conçus la 1.0, le dictionnaire et la barre. REA demande Node 22.23 ou plus récent. |
| `run` | Lancer l'appli et la voir fonctionner après une modification |
| `code-review`, `security-review` | Avant chaque release, surtout quand on touche au collage, à la lecture du champ actif ou au moteur local |
| `simplify` | Nettoyer une modification avant de la valider |
| `skill-creator` | Pour faire évoluer le skill `freeflow` lui-même |
| `gh` (GitHub CLI) | Publier les releases et suivre le workflow Mac (`gh run watch`) |

## Pour l'interface

| Skill | Quand l'utiliser |
|---|---|
| `apple-design`, `better-ui` | Pour dessiner un nouvel écran simple et épuré (espacements, hiérarchie, états) |
| `anthropic-skills:frontend-design` | Pour donner une vraie qualité visuelle à un écran tout en restant dans la [direction artistique](04-direction-artistique.md) |
| `artifact-design` | Pour une page web de présentation (« landing ») de FreeFlow |

## Pour les images et les vidéos

| Skill | Quand l'utiliser |
|---|---|
| `higgsfield-generate` | **Les images** : illustrations, visuels de lancement, captures mises en scène. Utilise GPT Image 2.5 pour tout ce qui contient du texte ou du design d'interface, et Seedance 2.5 pour une courte vidéo. Indique la palette dans le prompt : fond crème `#ffffeb` ou presque blanc `#fcfcfb`, noir `#1a1a1a`, lavande `#f0d7ff`, vert profond `#034f46`, style minimaliste. |
| `higgsfield-brandkit` | Pour poser une charte complète (logo, couleurs, déclinaisons) si FreeFlow doit avoir un site ou des réseaux |
| `miniature-youtube` / `higgsfield-youtube-thumbnail` | Pour la miniature d'une vidéo YouTube sur FreeFlow |
| `motion-simple-epure`, `motion-smooth-apple` | Pour une vidéo de présentation en motion design. Le style « simple épuré » correspond à l'appli. |
| `hyperframes` | Pour monter une vidéo promotionnelle à partir de vraies captures de l'appli |
| `montage-short`, `short-motion-starbucks` | Pour un short vertical (TikTok, Reels) qui présente FreeFlow |

## Les services extérieurs

- **GitHub** `AlanECE/freeflow` : le code, les releases (exe Windows et dmg Mac) et le workflow Mac.
- **Hugging Face** : le modèle Whisper est téléchargé au premier lancement depuis `Systran/faster-whisper-*`. FreeFlow ne fait aucun autre appel réseau.
- **Higgsfield** (images et vidéos) : il faut un compte. Ce service ne sert qu'au marketing, jamais à l'appli.
