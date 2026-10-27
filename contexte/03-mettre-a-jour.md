# Mettre FreeFlow à jour

## Installer l'environnement (Windows)

Il te faut Node.js 22 ou plus, Python 3.11 et, pour la version GPU, une carte NVIDIA.

```powershell
git clone https://github.com/AlanECE/freeflow.git
cd freeflow
npm install
pip install faster-whisper pyinstaller nvidia-cublas-cu12 "nvidia-cudnn-cu12<10"
npm run build:native    # native/PasteHelper.exe (coller, lire le champ actif)
npm run build:stt       # stt/dist/freeflow-stt (le moteur, environ 1,5 Go avec CUDA)
npm start               # lance l'appli en mode développement
```

Dans le terminal de VS Code, lance d'abord `Remove-Item Env:ELECTRON_RUN_AS_NODE`, sinon Electron démarre comme un simple Node.

Pour Mac, c'est GitHub Actions qui construit l'appli ([.github/workflows/mac.yml](../.github/workflows/mac.yml)). Les commandes à la main sont dans le [README](../README.md#construire-depuis-les-sources).

## Vérifier

| Commande | Ce qu'elle vérifie |
|---|---|
| `npm test` | Le dictionnaire, les fichiers Excel et CSV, les propositions, les quatre langues |
| `electron . --test-pipeline=fichier.wav --exit` | Une dictée complète sur un fichier WAV, sans rien coller |
| `electron . --lang-shots=dossier --user-data-dir=profil-test --exit` | Une capture de chaque écran dans chaque langue (à regarder avant toute release) |
| `electron . --guide-shots --user-data-dir=profil-test --exit` | Refait les captures du guide Excel (`renderer/hub/guide/`) après un changement de l'écran Dictionnaire |
| `electron . --tour-test=dossier`, `--bar-test=dossier`, `--ui-test=dossier`, `--screenshots=dossier` | Le tutoriel, la barre, l'enregistreur de raccourci, les écrans principaux |
| `electron . --meeting-test=micro.wav,ordi.wav` | Une réunion complète à partir de deux enregistrements |

Ajoute toujours `--user-data-dir=<dossier temporaire>` : ces commandes ne doivent jamais toucher aux vraies données de l'utilisateur. Ajoute aussi la variable `FREEFLOW_NO_SIDECAR=1` quand le moteur n'est pas utile, la commande va alors beaucoup plus vite.

## Publier une nouvelle version

1. Monte la version dans `package.json`, puis écris la section correspondante en haut de `CHANGELOG.md`, en français simple, côté utilisateur.
2. Lance `npm test` et fais une vraie dictée dans l'appli. Pour tester le collage, colle uniquement dans la fenêtre de FreeFlow.
3. Lance `--lang-shots` et regarde les captures, surtout l'arabe (de droite à gauche) et le chinois.
4. `npm run release` : l'application arrive dans `release/FreeFlow-win32-x64` et l'installateur dans `release/installer/FreeFlow-Setup.exe`.
5. **Scan anti-fuite** : `python scripts/scan_secrets.py release/FreeFlow-win32-x64`. Il ne doit trouver aucun nom, aucun chemin personnel et aucune clé. Dans `FreeFlow.exe`, des suites aléatoires du binaire Electron ressemblent parfois à des clés : vérifie, mais elles ne viennent pas du projet.
6. Installe l'exe sur ta machine et relance l'appli. `FreeFlow-Setup.exe /S` installe en silence, dans le même dossier, mais il faut d'abord quitter FreeFlow : sinon l'installation silencieuse s'arrête avec le code 2.
7. `git push`, puis publie la release : `gh release create vX.Y.Z release/installer/FreeFlow-Setup.exe --title "…" --notes-file notes.md`. Le workflow Mac démarre tout seul, construit `FreeFlow-Mac.dmg` et le joint à la release (compte environ 15 minutes).
8. Vérifie les deux liens permanents, que le README utilise :
   - `https://github.com/AlanECE/freeflow/releases/latest/download/FreeFlow-Setup.exe`
   - `https://github.com/AlanECE/freeflow/releases/latest/download/FreeFlow-Mac.dmg`

L'utilisateur garde ses réglages, son dictionnaire, ses notes et ses réunions d'une version à l'autre : tout est rangé dans son dossier de données, pas dans le dossier d'installation.

## Ajouter un texte ou une langue

- **Ajouter un texte** : écris `t('Ma phrase')` (ou `tr('Ma phrase')` dans `main.js`), puis ajoute dans `DICT` de [lib/i18n.js](../lib/i18n.js) la ligne `'Ma phrase': ['English', 'العربية', '中文']`. `npm test` échoue s'il manque une traduction ou si une variable `{n}` ne se retrouve pas dans les quatre langues.
- **Un texte fixe de la page HTML** est traduit tout seul, à condition qu'il figure dans `DICT`. Pour un paragraphe qui contient du gras ou du code, mets `data-i18n="cle"` sur l'élément et ajoute `'#cle': [html anglais, html arabe, html chinois]`.
- **Ajouter une langue** : ajoute son code dans `LANGS`, `NAMES` et `LOCALES`, une quatrième colonne à chaque entrée de `DICT`, ses exemples dans `EXAMPLES`, son prompt dans `AI_PROMPTS` ([lib/vocab-file.js](../lib/vocab-file.js)) et son option dans la liste « Langue de la dictée ». Refais ensuite `--guide-shots`.
