// ============================================================
// Phase 2 (suite) — Création des index
// À exécuter dans mongosh, après avoir fait : use fraud_datalake
// Usage : load("scripts/04_indexes.js")
// ============================================================

// --- silver_mobile_money ---
db.silver_mobile_money.createIndex({ "expediteur.numero": 1 });
db.silver_mobile_money.createIndex({ "beneficiaire.numero": 1 });
db.silver_mobile_money.createIndex({ "idAgent": 1 });
db.silver_mobile_money.createIndex({ "dateHeure": 1 });
db.silver_mobile_money.createIndex({ "expediteur.zone": 1, "beneficiaire.zone": 1 });
db.silver_mobile_money.createIndex({ "statut": 1 });

// --- silver_ventes ---
db.silver_ventes.createIndex({ "vendeur.nom": 1 });
db.silver_ventes.createIndex({ "client.zone": 1 });
db.silver_ventes.createIndex({ "date": 1 });
db.silver_ventes.createIndex({ "modePaiement": 1 });

print("Index créés.");
print("Index silver_mobile_money : " + JSON.stringify(db.silver_mobile_money.getIndexes().map(i => i.name)));
print("Index silver_ventes : " + JSON.stringify(db.silver_ventes.getIndexes().map(i => i.name)));
