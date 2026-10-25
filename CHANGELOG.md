# Nouveautés

## 1.2.0

**Le collage automatique marche enfin, une barre toujours là, les réunions et les notes.**

### Corrigé
- **Le collage automatique ne marchait jamais sous Windows** : une erreur dans le petit programme qui simule `Ctrl + V` faisait refuser chaque touche par Windows, le texte restait seulement copié. C'est réparé. Et si tu changes de fenêtre pendant la transcription, FreeFlow ne tape plus rien ailleurs : le texte reste copié.

### La barre et son déroulé
- Une toute petite barre en bas au centre de l'écran, toujours là (désactivable). Au survol : **Dicter**, **Déroulé**, **Ouvrir FreeFlow**.
- Le **déroulé** (`Ctrl + Alt + H`, deuxième raccourci réglable) : copier la dernière dictée, les dictées récentes à recopier, Notes, Réunion, Ouvrir FreeFlow.
- Pendant une dictée, la pastille a deux boutons : **Annuler** et **Terminer**.
- **Lancer au démarrage de l'ordinateur** : FreeFlow démarre discrètement, avec seulement la barre et l'icône.

### Réunions
- Enregistre ton micro et le son de l'ordinateur (Zoom, Meet, Teams…) sur deux pistes, puis transcrit en local avec **qui a dit quoi** (Moi / Eux). Sans casque, l'écho de l'autre personne dans ton micro est retiré.
- Réécoute à partir de n'importe quelle phrase, copie, export Markdown, envoi dans les notes. Pause, reprise, et import d'un enregistrement existant.
- Tu peux dicter pendant qu'une réunion se transcrit.

### Notes
- Un bloc-notes avec dictée intégrée (bouton micro), recherche, copie et export.

### Le dictionnaire apprend de tes corrections
- Tu corriges un mot juste après une dictée (« inksfield » → « Higgsfield ») : FreeFlow le remarque et propose de l'ajouter. Le texte lu reste en mémoire, n'est jamais enregistré, et les champs mot de passe ne sont jamais lus. Désactivable dans Paramètres.
- Dans l'**Historique**, le bouton **Corriger** fait la même chose sur une dictée passée.

## 1.1.0

**FreeFlow arrive sur Mac, et le dictionnaire s'importe d'un coup.**

### Mac
- Version Mac pour les puces Apple (M1 et plus récents, macOS 12+) : `FreeFlow-Mac.dmg`.
- Raccourci `⌥ Option + Espace`, icône dans la barre des menus, collage avec `⌘ V`.
- La page d'accueil guide les deux autorisations à donner (Micro, Accessibilité).

### Dictionnaire
- **Modèle Excel** à télécharger depuis le Dictionnaire : la feuille « Mes mots » (colonne A le mot correct, colonne B ce que la dictée écrit à la place, séparé par des virgules) et la feuille « Mode d'emploi ». Un **exemple rempli** (n8n, Higgsfield, Claude Code…) aussi.
- **Importer des mots** : le fichier Excel, un CSV (Google Sheets, Numbers), un texte ou JSON, ou une liste collée. Un aperçu montre les nouveaux mots, les mots complétés et les lignes ignorées avant d'importer ; rien n'est jamais supprimé.
- **Reprendre son dictionnaire Wispr Flow** en un clic (mots et snippets), sans rien modifier chez Wispr. Les fichiers CSV faits pour Wispr Flow sont reconnus aussi.
- **Dis-le** : tu prononces le mot, FreeFlow note comment le modèle l'écrit.
- **Deviner** : la voix de l'ordinateur prononce le mot et le modèle l'écoute. Un fichier avec seulement tes mots suffit : FreeFlow remplit « ce que le modèle entend » pour toi.
- Les propositions qui sont des mots de tous les jours (« clean » pour *Kling*) arrivent décochées, pour ne pas être remplacées partout.
- **Exporter** le dictionnaire (Excel ou CSV), **prompt** prêt à coller dans ChatGPT ou Claude.
- Les mots composés sont reconnus même coupés : « open router » → OpenRouter, « vid i q » → vidIQ, « M. C. P. » → MCP.
- Avec un grand dictionnaire, les mots que tu utilises le plus sont donnés en priorité au modèle.

### Moteur
- Choix du modèle dans Paramètres : Rapide (small), Équilibré (medium), Précis (large-v3-turbo), Maximum (large-v3).
- Mode processeur plus rapide (utilise jusqu'à 8 cœurs).

### Sécurité
- Le moteur de transcription local n'accepte plus que FreeFlow : une page web ouverte dans ton navigateur ne peut plus l'arrêter ni s'en servir (jeton secret à chaque lancement, requêtes de navigateur et DNS rebinding refusés).
- Le moteur s'arrête de lui-même si FreeFlow plante, au lieu de rester en arrière-plan.
- La fenêtre ne peut ouvrir que les dossiers de FreeFlow, et les commandes de test ne sont plus actives dans la version installée.
- Fichiers importés limités (20 Mo, archives Excel piégées refusées).

## 1.0.0

Première version : dictée vocale 100 % locale pour Windows (Whisper large-v3 sur carte NVIDIA), raccourci global ou « maintenir pour parler », vocabulaire, snippets, historique.
