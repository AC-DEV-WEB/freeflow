# Architecture de FreeFlow

FreeFlow est une application Electron (interface, raccourci, collage) qui pilote un petit serveur de transcription local en Python (faster-whisper). Les deux parlent en HTTP sur `127.0.0.1` uniquement : rien n'écoute sur le réseau. Le même code tourne sous Windows et macOS ; seuls le collage, les icônes de la barre des menus, les autorisations et le paquet final diffèrent (voir [macOS](#macos)).

```
                         Ctrl+Alt+Espace (globalShortcut)  ou  touche maintenue (uiohook-napi)
                                              │
┌──────────────── Electron (main.js) ─────────┴────────────────────────────────────────────┐
│  zone de notification · raccourci · états de la dictée · pipeline · fichiers JSON · logs  │
│                                                                                          │
│   ff:rec-start ─▶ ┌─ pastille (renderer/overlay) ──────────────────────────────────┐      │
│                   │ fenêtre transparente toujours au premier plan, non cliquable     │      │
│                   │ getUserMedia ─▶ AudioContext 16 kHz ─▶ AudioWorklet (PCM16)      │      │
│   ff:audio-done ◀─│ Écoute / Transcription / Mise en forme / Terminé ✓ / Erreur      │      │
│                   └──────────────────────────────────────────────────────────────────┘      │
│        │ PCM16 ─▶ WAV (lib/wav.js)                                                        │
│        ▼                                                                                   │
│   POST http://127.0.0.1:48123/transcribe?lang=auto&hints=mot1,mot2   (lib/sidecar.js)      │
│        │                                                                                   │
│        │     ┌──── moteur Python (stt/stt_server.py, compilé avec PyInstaller) ─────────┐  │
│        └────▶│ http.server · faster-whisper large-v3 · CUDA float16                     │  │
│              │ replis : int8_float16, int8, puis CPU int8 « small » · VAD · beam 5        │  │
│        ◀─────│ {text, language, duration_ms, audio_ms, segments}  · READY sur stdout    │  │
│              └──────────────────────────────────────────────────────────────────────────┘  │
│        ▼                                                                                   │
│   lib/format.js : « euh / hum » retirés, snippets, vocabulaire (lib/vocab.js),              │
│                   espaces fines avant ? ! ; :, majuscules                                   │
│        ▼                                                                                   │
│   presse-papiers sauvegardé ─▶ texte copié ─▶ native/PasteHelper.exe                        │
│   (SendInput Ctrl+V, ou Maj+Inser dans les terminaux, modificateurs relâchés d'abord)       │
│   ─▶ presse-papiers restauré ─▶ history.json (texte, mots, durée, latence)                  │
│        ▼                                                                                   │
│   fenêtre principale (renderer/hub) : état poussé par IPC (ff:state)                        │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Fichiers

```
freeflow/
├── package.json              scripts start / build:native / build:stt / package / release
├── main.js                   processus principal (zone de notification, raccourci, pastille, fenêtre, pipeline, IPC)
├── preload.js                pont contextIsolation (window.freeflow.invoke / on / send, canaux ff:*)
├── lib/
│   ├── sidecar.js            lance / adopte / arrête le moteur, /health (progression), /transcribe
│   ├── format.js             mise en forme (fillers, snippets, vocabulaire, typographie, majuscules)
│   ├── vocab.js              vocabulaire : variantes entendues → mot correct (accents, chiffres, séparateurs ignorés,
│   │                         parties d'un mot entendues séparément : « open router », « vid i q », « M. C. P. »)
│   ├── vocab-file.js         import (CSV, .xlsx, texte, JSON, tableau Markdown, liste collée), export,
│   │                         modèle Excel vide et exemple rempli (feuilles « Mes mots » + « Mode d'emploi »)
│   ├── xlsx.js               écriture .xlsx sans dépendance (zip + styles, colonnes, cellules fusionnées)
│   ├── guess.js              « Deviner » (voix système → modèle sans dictionnaire) et « Dis-le » ; mots courants signalés
│   ├── common-words.json     mots courants français / anglais (wordfreq, CC BY-SA 4.0)
│   ├── wispr.js              reprise du dictionnaire de Wispr Flow (copie de flow.sqlite lue avec node:sqlite)
│   ├── learn.js              corrections repérées entre le texte collé et le champ quelques secondes plus tard
│   ├── meeting.js            réunions : fusion des pistes micro / ordinateur en « Moi / Eux », écho retiré, exports
│   ├── paste.js              Windows : PasteHelper.exe + réglages par application ; macOS : Cmd+V par uiohook-napi
│   ├── wav.js                PCM16 → WAV
│   └── store.js              fichiers JSON écrits de façon atomique
├── renderer/
│   ├── hub/                  fenêtre principale : Accueil, Historique, Dictionnaire, Snippets, Paramètres
│   └── overlay/              pastille + capture du micro (pcm-worklet.js)
├── stt/
│   ├── stt_server.py         moteur faster-whisper (serveur HTTP de la bibliothèque standard)
│   └── build_stt.py          PyInstaller onedir + copie des DLL cuBLAS 12 / cuDNN 9
├── native/
│   ├── PasteHelper.cs        Windows : collage simulé (SendInput), --only-if, --read-focused (UI Automation), --info, --mask
│   └── ax-read.swift         macOS : texte du champ actif (Accessibilité), compilé par GitHub Actions
├── installer/
│   ├── installer.nsh         Windows : règles de l'installateur (fermer FreeFlow avant mise à jour, nettoyage)
│   ├── mac-info.plist        macOS : textes des autorisations (micro), version minimale
│   ├── make-dmg.sh           macOS : signature ad hoc + FreeFlow-Mac.dmg
│   └── mac-smoke-test.sh     macOS : test du paquet (moteur, dictée sur un WAV, Deviner, captures)
├── scripts/selftest.js       tests du dictionnaire (npm test)
├── .github/workflows/mac.yml construit et teste la version Mac sur un Mac de GitHub, joint le dmg à la release
├── assets/                   icônes (make_icon.py : .ico, .icns, icônes « Template » de la barre des menus) et police Figtree
└── docs/                     cette page, le modèle de dictionnaire (dictionnaire-modele.csv) et les captures du README
```

## La barre et son déroulé

La fenêtre de la pastille (`renderer/overlay`) est transparente, toujours au premier plan et ne prend jamais le focus : le texte se colle toujours dans l'application où tu écris. Elle laisse passer les clics (`setIgnoreMouseEvents(true, { forward: true })`) ; la page signale quand la souris passe sur la barre, le déroulé ou une notification (`ff:bar-mouse`) et la fenêtre devient cliquable à ces endroits seulement. Le déroulé agrandit la fenêtre vers le haut et se referme seul au bout de quelques secondes sans la souris. Deuxième raccourci : `panelShortcut` (`Ctrl + Alt + H` par défaut).

## Réunions

La page Réunions de la fenêtre principale enregistre (elle continue fenêtre fermée : `backgroundThrottling: false`) :

- le micro, avec `getUserMedia` (annulation d'écho activée) ;
- le son de l'ordinateur, avec `getDisplayMedia` : le processus principal répond avec `audio: 'loopback'` (`setDisplayMediaRequestHandler`) et la vidéo est arrêtée aussitôt. Lancée depuis la barre, la demande passe par `executeJavaScript(…, true)` qui fournit le geste utilisateur exigé.

Chaque piste passe par un `MediaRecorder` (Opus) dont les morceaux sont écrits au fil de l'eau dans `meetings/<id>/{mic,computer}.webm`. À l'arrêt, `POST /transcribe_meeting` décode les deux pistes, écrit `mix.ogg` (les deux mélangées, pour la réécoute) et renvoie les segments ligne par ligne (NDJSON) ; le verrou du modèle est pris segment par segment, donc une dictée peut passer entre deux. `lib/meeting.js` fusionne : micro = « Moi », ordinateur = « Eux », un segment du micro qui répète un segment de l'ordinateur au même moment (haut-parleurs sans casque) est retiré, les phrases de remplissage inventées par Whisper sur le silence aussi.

## Apprendre des corrections

Après un collage réussi, FreeFlow lit le champ actif (`PasteHelper.exe --read-focused` par UI Automation sous Windows, `ax-read` par l'Accessibilité sur Mac), puis toutes les 2,5 s pendant 45 s tant que la même application reste devant et qu'aucune autre dictée ne commence. `lib/learn.js` compare le texte collé et ce qu'il est devenu (différence mot à mot) : un remplacement de 1 à 4 mots devient une proposition « mot correct ← ce qui avait été écrit ». Ignorés : les ajouts et suppressions, la ponctuation seule, un mot courant remplacé par un autre mot courant (« ses » → « ces »). Les champs mot de passe ne sont jamais lus ; le texte reste en mémoire et n'est jamais écrit sur le disque.

## Le dictionnaire

Chaque entrée est `{ word, sounds[] }` : le mot correct et ce que le modèle écrit à sa place. Deux usages :

1. **Avant la transcription**, les mots (50 au plus, les plus utilisés dans l'historique en dernier) partent dans le prompt de Whisper (`initial_prompt`), ce qui l'aide à les écrire juste.
2. **Après**, `vocab.js` remplace chaque variante entendue par le mot correct (expressions régulières compilées une fois, la plus longue d'abord).

Trouver les variantes :

- **Importer** (`vocab-file.js`) : un fichier ou une liste collée → aperçu (nouveau / complété / déjà là, lignes ignorées) → fusion, sans jamais rien supprimer. Le sens des colonnes est lu dans l'en-tête, sinon deviné (un mot correct a plus souvent des majuscules, des chiffres, pas d'espace) et inversable dans l'aperçu.
- **Dis-le** : une dictée de la fenêtre principale transcrite sans le dictionnaire ; chaque morceau (« Higgsfield. Hicks field, x field ») devient une proposition.
- **Deviner** (`guess.js`) : la voix de l'ordinateur (voix SAPI sous Windows, `say` sous macOS) dit le mot dans une phrase (« J'utilise Kling tous les jours. ») puis seul avec une voix de l'autre langue ; le modèle transcrit sans le dictionnaire ; ce qui diffère du mot devient une proposition. Exemples mesurés sur large-v3 : Kling → « cling », « clean » ; Higgsfield → « inksfield », « higgs field » ; Seedance → « ces danses ».
- Les propositions déjà corrigées par le dictionnaire sont écartées ; un mot courant de la langue de dictée (« clean ») est proposé décoché, car il serait remplacé partout.

## Données sur le disque

| Où | Quoi |
|---|---|
| `%LOCALAPPDATA%\Programs\FreeFlow` | l'application installée |
| `%LOCALAPPDATA%\FreeFlow\models` | le modèle téléchargé au premier lancement (cache Hugging Face) |
| `%APPDATA%\FreeFlow` | `settings.json`, `dictionary.json`, `snippets.json`, `history.json`, `notes.json`, `meetings.json`, `meetings\<id>\` (pistes, `mix.ogg`, `meeting.json`), `logs\freeflow.log` |
| macOS : `~/Library/Application Support/FreeFlow` | les mêmes fichiers, et le modèle dans `models/` |

Le dossier du modèle se change dans `settings.json` (`modelCache`), le modèle dans Paramètres → Moteur local (`model` : `auto`, `small`, `medium`, `large-v3-turbo`, `large-v3`) ; un changement redémarre le moteur.

## Le moteur de transcription

Variables d'environnement reconnues par `stt_server.py` :

| Variable | Rôle | Défaut |
|---|---|---|
| `FREEFLOW_PORT` | port local | `48123` |
| `FREEFLOW_MODEL` | modèle sur GPU | `large-v3` |
| `FREEFLOW_CPU_MODEL` | modèle sur processeur | `small` |
| `FREEFLOW_DEVICE` | forcer `cuda` ou `cpu` | essai GPU puis CPU |
| `FREEFLOW_CPU_THREADS` | threads du mode processeur | nombre de cœurs, 8 au plus |
| `FREEFLOW_TOKEN` | jeton exigé sur les requêtes POST | aucun (lancé à la main) |
| `FREEFLOW_WATCH_STDIN` | `1` : s'arrêter quand l'application disparaît | désactivé |
| `HF_HOME` | cache des modèles | fourni par l'application |

`GET /health` renvoie `phase` (`starting`, `downloading`, `loading`, `ready`, `error`) et, pendant le premier téléchargement, `download: {model, done, total}` en octets. L'application affiche cette progression dans la fenêtre et dans l'info-bulle de l'icône.

Sécurité du moteur : il n'écoute que sur `127.0.0.1` ; l'application lui donne à chaque lancement un jeton secret (`FREEFLOW_TOKEN`) exigé sur `POST /transcribe` et `POST /shutdown` (en-tête `X-FreeFlow-Token`) ; toute requête portant un en-tête `Origin` (une page web) ou un `Host` autre que `127.0.0.1` / `localhost` (DNS rebinding) reçoit 403, et la connexion est fermée après chaque refus. Avec `FREEFLOW_WATCH_STDIN=1`, il s'arrête dès que l'application qui l'a lancé disparaît (son entrée standard se ferme). Un moteur protégé par un autre jeton occupe le port ? L'application prend le port suivant.

Sans carte NVIDIA détectée, le gros modèle n'est jamais téléchargé : FreeFlow charge directement `small` sur le processeur.

## Commandes de vérification

Aucune frappe n'est envoyée et le collage est désactivé pendant ces tests :

```powershell
# pipeline complet sur un fichier WAV : transcription → mise en forme → presse-papiers → historique
.\node_modules\.bin\electron.cmd . --test-pipeline="C:\chemin\vers\test.wav" --exit
# captures de la fenêtre et de la pastille
.\node_modules\.bin\electron.cmd . --screenshots="C:\dossier" --display-name= --wait-ready --exit
# plan du collage simulé, sans rien envoyer
.\native\PasteHelper.exe --dry-run
# « Deviner » sur quelques mots, avec le vrai moteur et les voix du système
.\node_modules\.bin\electron.cmd . --guess-test="Kling,Higgsfield,Seedance" --exit
# tests du dictionnaire (formats de fichiers, fusion, propositions)
npm test
```

`--ui-test=<dossier>` rejoue l'enregistreur de raccourci, l'import d'une liste, la reprise Wispr Flow (aperçu seulement) et « Deviner » dans la fenêtre, avec une capture à chaque étape. Utilise toujours un profil séparé (`--user-data-dir=<dossier>`).

## macOS

| | Windows | macOS |
|---|---|---|
| Raccourci par défaut | `Ctrl + Alt + Espace` | `⌥ Option + Espace` (`Ctrl + Option + Espace` change la source de saisie) |
| Collage | `PasteHelper.exe` (SendInput) | `Cmd + V` par uiohook-napi (CGEventPost), osascript en secours |
| Application au premier plan | `PasteHelper.exe --info` | `lsappinfo` (aucune autorisation) |
| Autorisations | aucune | Micro, et Accessibilité pour le collage et le hook clavier (surveillée toutes les 2,5 s) |
| Moteur | CUDA float16 (large-v3), sinon processeur | processeur (Apple Accelerate), `small` par défaut |
| Icône de notification | `tray*.png` | `trayTemplate.png` (+ @2x), teintée par macOS |
| Paquet | NSIS (`FreeFlow-Setup.exe`), fait sur le PC | `FreeFlow-Mac.dmg`, signé ad hoc, fait par GitHub Actions |

Sans certificat Apple Developer, l'application n'est pas notariée : macOS demande « Ouvrir quand même » au premier lancement, et l'autorisation Accessibilité peut devoir être redonnée après une mise à jour (elle est liée à la signature).

## Limites connues

- Windows : le collage simulé est refusé par les fenêtres lancées en administrateur ; le texte reste dans le presse-papiers.
- En mode « maintenir pour parler », la touche passe aussi à l'application en dessous (hook clavier global) : choisis une combinaison libre.
- La mise en forme suit des règles fixes, sans IA générative : pas de reformulation.
- Windows 10/11 et macOS 12+ sur puce Apple. Pas de version Linux ni Mac Intel.
- « Deviner » dépend des voix installées : une voix française (Hortense sous Windows, Thomas sur Mac) et une voix anglaise donnent les meilleurs résultats.
