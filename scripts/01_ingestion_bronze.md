# Phase 1 — Ingestion brute (couche Bronze)

## Principe

On charge les deux CSV **tels quels**, sans aucune transformation — c'est le principe même d'un Data Lake : on conserve la donnée source intacte, y compris ses défauts (montants négatifs, valeurs manquantes), pour garder une traçabilité complète et pouvoir revenir en arrière si besoin.

## Commandes (à exécuter dans l'invite de commandes Windows, PAS dans mongosh)

Adapte les chemins vers l'endroit où sont stockés tes fichiers CSV (ex. `C:/Users/MIEZANSAM/Documents/`).

```bash
mongoimport --db fraud_datalake --collection raw_mobile_money --type csv --headerline --file "C:/Users/MIEZANSAM/Documents/transactions_mobile_money_100k.csv"

mongoimport --db fraud_datalake --collection raw_ventes --type csv --headerline --file "C:/Users/MIEZANSAM/Documents/ventes_commerce_abidjan_100k.csv"
```

- `--type csv --headerline` : indique que le fichier est un CSV et que la première ligne contient les noms de colonnes (mongoimport les utilise comme noms de champs).
- Chaque ligne du CSV devient un document MongoDB. Tous les champs sont importés en **string** à ce stade (normal pour du bronze — la conversion des types se fait en Silver).

## Vérification après import

Dans `mongosh` :

```javascript
use fraud_datalake

db.raw_mobile_money.countDocuments()   // doit afficher 100000
db.raw_ventes.countDocuments()         // doit afficher 100000

db.raw_mobile_money.findOne()
db.raw_ventes.findOne()
```

Vérifie que chaque `findOne()` correspond bien à la première ligne de données de ton CSV (hors en-tête).

## Point d'attention

Ne t'inquiète pas si tous les champs numériques (`montant_fcfa`, `quantite`, etc.) apparaissent comme des chaînes de caractères (`"91784"` au lieu de `91784`) — c'est normal et attendu pour la couche bronze. La conversion de types se fait explicitement dans la couche Silver (script `02_silver_mobile_money.js`), ce qui permet de documenter et justifier chaque transformation.
