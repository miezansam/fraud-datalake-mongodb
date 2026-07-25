// ============================================================
// Phase 2 — Couche Silver : transactions_mobile_money
// À exécuter dans mongosh, après avoir fait : use fraud_datalake
// Usage : load("scripts/02_silver_mobile_money.js")
// ============================================================

db.raw_mobile_money.aggregate([

  // 1. Conversion des types (bronze = tout en string)
  {
    $addFields: {
      dateHeureConvertie: {
        $dateFromString: {
          dateString: "$date_heure",
          format: "%Y-%m-%d %H:%M:%S",
          onError: null,
          onNull: null
        }
      },
      montantConverti: { $toDouble: "$montant_fcfa" },
      fraisConverti: {
        $cond: [
          { $in: ["$frais_fcfa", ["", null]] },
          null,
          { $toDouble: "$frais_fcfa" }
        ]
      },
      agentPropre: {
        $cond: [ { $in: ["$id_agent", ["", null]] }, null, "$id_agent" ]
      },
      zoneBeneficiairePropre: {
        $cond: [ { $in: ["$zone_beneficiaire", ["", null]] }, null, "$zone_beneficiaire" ]
      }
    }
  },

  // 2. Structuration en documents imbriqués + flags qualité
  {
    $project: {
      _id: "$id_transaction",
      source: { $literal: "mobile_money" },
      dateHeure: "$dateHeureConvertie",
      operateur: "$operateur",
      typeOperation: "$type_operation",
      expediteur: {
        numero: "$expediteur",
        zone: "$zone_expediteur"
      },
      beneficiaire: {
        numero: "$beneficiaire",
        zone: "$zoneBeneficiairePropre"
      },
      montantFcfa: "$montantConverti",
      fraisFcfa: "$fraisConverti",
      idAgent: "$agentPropre",
      statut: "$statut",
      qualite: {
        montantValide: { $gt: ["$montantConverti", 0] },
        agentManquant: { $eq: ["$agentPropre", null] },
        zoneBeneficiaireManquante: { $eq: ["$zoneBeneficiairePropre", null] },
        dateValide: { $ne: ["$dateHeureConvertie", null] }
      }
    }
  },

  // 3. Écriture dans la collection silver (remplace si déjà existante)
  {
    $merge: {
      into: "silver_mobile_money",
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
]);

print("Transformation silver_mobile_money terminée.");
print("Nombre de documents : " + db.silver_mobile_money.countDocuments());
print("Documents avec montant invalide : " + db.silver_mobile_money.countDocuments({ "qualite.montantValide": false }));
print("Documents avec agent manquant : " + db.silver_mobile_money.countDocuments({ "qualite.agentManquant": true }));
