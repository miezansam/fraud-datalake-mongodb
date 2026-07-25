// ============================================================
// Phase 2 — Couche Silver : ventes_commerce
// À exécuter dans mongosh, après avoir fait : use fraud_datalake
// Usage : load("scripts/03_silver_ventes.js")
// ============================================================

db.raw_ventes.aggregate([

  // 1. Conversion des types (bronze = tout en string)
  {
    $addFields: {
      dateConvertie: {
        $dateFromString: {
          dateString: "$date",
          format: "%Y-%m-%d",
          onError: null,
          onNull: null
        }
      },
      quantiteConvertie: { $toInt: "$quantite" },
      prixUnitaireConverti: { $toDouble: "$prix_unitaire" },
      montantConverti: { $toDouble: "$montant_fcfa" },
      vendeurPropre: {
        $cond: [ { $in: ["$vendeur", ["", null]] }, null, "$vendeur" ]
      },
      zoneClientPropre: {
        $cond: [ { $in: ["$zone_client", ["", null]] }, null, "$zone_client" ]
      }
    }
  },

  // 2. Structuration en documents imbriqués + flags qualité
  {
    $project: {
      _id: "$id_transaction",
      source: { $literal: "ventes_commerce" },
      date: "$dateConvertie",
      produit: "$produit",
      quantite: "$quantiteConvertie",
      prixUnitaire: "$prixUnitaireConverti",
      montantFcfa: "$montantConverti",
      modePaiement: "$mode_paiement",
      vendeur: { nom: "$vendeurPropre" },
      client: { zone: "$zoneClientPropre" },
      qualite: {
        montantValide: { $gt: ["$montantConverti", 0] },
        vendeurManquant: { $eq: ["$vendeurPropre", null] },
        zoneClientManquante: { $eq: ["$zoneClientPropre", null] },
        dateValide: { $ne: ["$dateConvertie", null] },
        montantCoherent: {
          $eq: [
            "$montantConverti",
            { $multiply: ["$quantiteConvertie", "$prixUnitaireConverti"] }
          ]
        }
      }
    }
  },

  // 3. Écriture dans la collection silver
  {
    $merge: {
      into: "silver_ventes",
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
]);

print("Transformation silver_ventes terminée.");
print("Nombre de documents : " + db.silver_ventes.countDocuments());
print("Documents avec montant incohérent (qte x prix ≠ montant) : " + db.silver_ventes.countDocuments({ "qualite.montantCoherent": false }));
print("Documents avec vendeur manquant : " + db.silver_ventes.countDocuments({ "qualite.vendeurManquant": true }));
