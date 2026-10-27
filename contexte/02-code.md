# Le code

Electron 44 (Node 24) pour l'interface, un moteur Python (faster-whisper, compilé avec PyInstaller) pour la transcription, deux petits programmes natifs pour coller et pour lire le champ actif. Le projet n'a qu'une seule dépendance npm à l'exécution : `uiohook-napi`.

## La carte

| Où | Quoi |
|---|---|
| [main.js](../main.js) | Le processus principal : réglages, raccourcis, icône, fenêtres, déroulé de la dictée, réunions, notes, IPC, commandes de test (`--…`) |
| [preload.js](../preload.js) | Le pont sécurisé vers les fenêtres : seuls les canaux listés passent |
| [renderer/hub/](../renderer/hub/) | La grande fenêtre : Accueil, Historique, Notes, Réunions, Dictionnaire, Snippets, Paramètres, tutoriel, guide Excel |
| [renderer/hub/guide/](../renderer/hub/guide/) | Les captures du guide Excel, une par langue (`fr-1.png`…), fabriquées par `--guide-shots` |
| [renderer/overlay/](../renderer/overlay/) | La fenêtre transparente du bas : pastille de dictée, barre, déroulé, notification « ajouter au dictionnaire » ; c'est aussi elle qui capte le micro |
| [lib/i18n.js](../lib/i18n.js) | Les quatre langues (la phrase française sert de clé) |
| [lib/vocab.js](../lib/vocab.js) | Le moteur du dictionnaire : variantes, chiffres en lettres, mots coupés, chinois sans espaces |
| [lib/vocab-file.js](../lib/vocab-file.js), [lib/xlsx.js](../lib/xlsx.js) | Lire et écrire Excel, CSV, texte et JSON ; le modèle et l'exemple dans chaque langue |
| [lib/format.js](../lib/format.js) | La mise en forme : mots parasites (« euh »), snippets, dictionnaire, ponctuation, majuscules |
| [lib/guess.js](../lib/guess.js), [lib/learn.js](../lib/learn.js) | Deviner les variantes avec la voix du système ; repérer les mots corrigés après un collage |
| [lib/meeting.js](../lib/meeting.js) | Fusionner les deux pistes d'une réunion en « Moi / Eux », retirer l'écho |
| [lib/paste.js](../lib/paste.js), [native/PasteHelper.cs](../native/PasteHelper.cs), [native/ax-read.swift](../native/ax-read.swift) | Coller (`SendInput` sous Windows, `Cmd + V` sous Mac) et lire le champ actif |
| [lib/sidecar.js](../lib/sidecar.js), [stt/stt_server.py](../stt/stt_server.py) | Lancer et piloter le moteur local (HTTP sur 127.0.0.1, jeton aléatoire à chaque lancement) |
| [installer/](../installer/) | NSIS (page d'accueil, bandeau `sidebar.bmp`), `.dmg` Mac, test du paquet Mac |
| [scripts/selftest.js](../scripts/selftest.js) | Les tests (`npm test`) |

## Le chemin d'une dictée

1. Le raccourci est capté par `globalShortcut`. Pour un raccourci sans touche normale ou le mode « maintenir », c'est `uiohook-napi` qui le capte.
2. `startDictation()` affiche la pastille, et la fenêtre overlay enregistre le micro (AudioWorklet → PCM 16 bits).
3. À l'arrêt, le WAV part vers le moteur `POST /transcribe` avec la langue et les mots du dictionnaire, qui servent d'indice au modèle (`initial_prompt`, 50 mots au plus).
4. `formatText()` nettoie le texte et applique le dictionnaire.
5. Le texte est copié dans le presse-papiers, collé par `PasteHelper.exe --only-if <processus>` (rien n'est tapé si la fenêtre a changé), puis l'ancien presse-papiers est remis 800 ms après.
6. La dictée entre dans l'historique et, si l'option est active, `watchCorrections()` surveille les mots corrigés.

## Les conventions

- **Le code est en anglais, l'interface et la documentation en français.** Les commentaires expliquent le « pourquoi », pas le « quoi ».
- **Les textes** : écris `t('Phrase française')` dans les fenêtres, `tr('…')` dans `main.js`, puis ajoute la phrase dans `DICT` de `lib/i18n.js` avec ses trois traductions. `tn(n, 'un', 'plusieurs')` gère le pluriel. Pour un même mot français qui a deux sens, ajoute un suffixe : `'Enregistrer@save'`. Les messages d'erreur envoyés par `main.js` sont traduits à l'affichage par `toast()`.
- **L'arabe s'écrit de droite à gauche** : dans le CSS, utilise des propriétés logiques (`margin-inline-start`, `text-align: start`), jamais `left` / `right`.
- **Aucune nouvelle dépendance** sans vraie raison : le lecteur Excel, le zip et l'écriture xlsx sont faits maison.
- **La sécurité.** Le moteur refuse toute requête sans jeton, avec un en-tête `Origin` ou venant d'un hôte non local. `ff:open-path` n'ouvre que les dossiers de FreeFlow. Les commandes de test ne sont actives qu'avec un drapeau `--…`.

## Les pièges déjà rencontrés (ne pas les refaire)

- **`SendInput` sous Windows x64** : la structure `INPUT` fait **40 octets**. Avec 32, Windows refuse chaque touche sans erreur visible, et le collage ne marche jamais.
- **`ELECTRON_RUN_AS_NODE=1`** est défini dans certains terminaux (VS Code) : Electron démarre alors comme Node et `app` vaut `undefined`. Retire la variable avant `electron .`.
- **Electron 44** : `clipboard.readText()` et `writeText()` renvoient des promesses, il faut les `await`.
- **Le script `build:native`** a besoin de barres obliques inverses dans les chemins pour `csc.exe`. Après une compilation, vérifie que `PasteHelper.exe --help` liste bien `--only-if` avant tout test.
- **Le son de l'ordinateur pour les réunions** (`getDisplayMedia` avec l'audio en `loopback`) exige un geste de l'utilisateur. Quand la réunion est lancée depuis la barre ou l'icône, `main.js` l'exécute dans la fenêtre avec `executeJavaScript(…, true)`.
- **Le moteur Python** : `multiprocessing.freeze_support()` évite un second démarrage sur Mac, `os._exit(0)` évite une erreur à la fermeture, et un chien de garde sur `stdin` l'arrête si FreeFlow meurt.
- **Ne jamais reconstruire `dist/` ou `release/` pendant qu'une copie de FreeFlow tourne depuis ce dossier.**
- **Les captures d'écran** : passe par `webContents.capturePage()` sur la fenêtre de FreeFlow, jamais par une capture de l'écran entier, qui peut contenir les fenêtres privées de l'utilisateur.
