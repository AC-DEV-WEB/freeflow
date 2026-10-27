# Direction artistique : simple et épuré

FreeFlow doit avoir l'air calme, clair et soigné, dans la lignée de Wispr Flow : beaucoup d'espace, peu de couleurs, de grandes cartes arrondies, pas de dégradés criards ni d'effets gratuits. Chaque écran porte une seule idée. Si un ajout rend l'écran chargé, il va dans une fenêtre secondaire (modale, guide, déroulé).

## La palette

Les couleurs sont définies dans [renderer/hub/hub.css](../renderer/hub/hub.css) (`:root`). Utilise ces variables, jamais une couleur en dur.

| Variable | Couleur | Rôle |
|---|---|---|
| `--text` | `#1a1a1a` | Texte, boutons principaux, barre et déroulé (fond sombre) |
| `--bg` | `#fcfcfb` | Fond de la fenêtre, presque blanc |
| `--cream` | `#ffffeb` | Cartes mises en avant (carte Excel), texte sur fond sombre, touches de clavier |
| `--lavender` | `#f0d7ff` | Variantes du dictionnaire, tuile « mots aujourd'hui », en-tête du tableur |
| `--green` | `#034f46` | Vert profond : succès, carte « vitesse », icône Excel, « Après » |
| `--purple` | `#a550a7` | Accent : étapes numérotées, points du tutoriel, éléments pointés dans les captures |
| `--orange` | `#ffa946` | Rare : avertissement doux |
| `--red` | `#f87171` | Enregistrement en cours (point qui clignote), erreurs |
| `--grey-1/2/3` | `#ebe9ec` / `#dfdfdf` / `#71716e` | Bordures, survols, textes secondaires |

## Typographie

- **Figtree** (fichiers dans `assets/fonts`, aucune police chargée depuis Internet), en graisses 600 à 800 pour les titres et les boutons.
- **En arabe**, le texte se replie sur Segoe UI ou Tahoma ; **en chinois**, sur Microsoft YaHei UI ou PingFang SC. C'est déjà réglé dans le CSS.
- Les titres de page font environ 28 px, ceux des cartes 16 à 20 px, les aides 12,5 à 13,5 px en gris.

## Les composants

- **Les cartes** : fond blanc, bordure gris clair, coins de 16 px, beaucoup de marge intérieure.
- **Les boutons** : coins de 10 px. Le bouton principal est noir avec un texte crème, les autres sont blancs. Un seul bouton principal par carte.
- **Les pastilles** (variantes, « Nouveau », « Moi / Eux ») : bien arrondies, fond lavande ou vert très clair.
- **Les icônes** : traits fins (1,7 à 2 px), coins arrondis, sans remplissage, en 24 px dessinés à la main dans le HTML.
- **La barre et le déroulé** : sombres (`#1a1a1a`), texte crème, petits et discrets. La barre ne s'agrandit qu'au survol.
- **Les animations** : courtes (200 à 260 ms), un léger glissement ou fondu. Rien qui clignote, sauf le point rouge d'enregistrement.
- **Le logo** : une onde sonore en barres verticales dans un carré sombre arrondi. Les icônes de la barre des tâches, l'icône Mac et les images de l'installateur (bandeau de gauche, en-tête) sont générées par [assets/make_icon.py](../assets/make_icon.py).

## Le ton des textes

- **Tutoiement, phrases courtes, verbes d'action** : « Dis-le », « Importer mon fichier », « Revoir le tutoriel ».
- **Aucun jargon** : « ce que le modèle entend » plutôt que « variante phonétique », « ton micro » plutôt que « périphérique d'entrée ».
- **Toujours dire la conséquence** : « rien n'est jamais supprimé », « le texte lu reste en mémoire et n'est jamais enregistré ».
- **La typographie française** : guillemets « », espace fine insécable avant `: ; ? !`, apostrophe typographique ’.

## Les images et les captures

- Les captures d'aide (le guide Excel) sont **de vraies captures de FreeFlow**, faites par `--guide-shots` dans chacune des quatre langues, avec l'élément à cliquer entouré de violet.
- Pour une illustration, une miniature YouTube ou un visuel de lancement, génère l'image avec Higgsfield (voir [05-skills-et-outils.md](05-skills-et-outils.md)) en gardant cette palette : fond crème ou presque blanc, noir, touches de lavande et de vert profond, beaucoup d'espace vide.
