// ============================================================
// Phase 3 — Couche Gold : features de détection de fraude
// À exécuter dans mongosh, après avoir fait : use fraud_datalake
// Usage : load("scripts/05_gold_features.js")
// ============================================================

// Index supplémentaires nécessaires pour la corrélation 3.4 (jointure lourde)
db.silver_mobile_money.createIndex({ "montantFcfa": 1 });
db.silver_mobile_money.createIndex({ "beneficiaire.zone": 1 });

// ------------------------------------------------------------
// 3.1 — Features par EXPÉDITEUR (numéro de téléphone)
//   - nombre de transactions
//   - montant total et moyen envoyé
//   - écart-type des montants (variabilité suspecte)
//   - nombre de zones distinctes utilisées (mobilité suspecte)
//   - nombre de bénéficiaires distincts
//   - taux d'échec
// ------------------------------------------------------------
db.silver_mobile_money.aggregate([
  {
    $group: {
      _id: "$expediteur.numero",
      nbTransactions: { $sum: 1 },
      montantTotal: { $sum: "$montantFcfa" },
      montantMoyen: { $avg: "$montantFcfa" },
      montantEcartType: { $stdDevPop: "$montantFcfa" },
      zonesDistinctes: { $addToSet: "$expediteur.zone" },
      beneficiairesDistincts: { $addToSet: "$beneficiaire.numero" },
      nbEchecs: {
        $sum: { $cond: [{ $eq: ["$statut", "Échec"] }, 1, 0] }
      },
      premiereTransaction: { $min: "$dateHeure" },
      derniereTransaction: { $max: "$dateHeure" }
    }
  },
  {
    $project: {
      _id: 1,
      nbTransactions: 1,
      montantTotal: 1,
      montantMoyen: { $round: ["$montantMoyen", 0] },
      montantEcartType: { $round: ["$montantEcartType", 0] },
      nbZonesDistinctes: { $size: "$zonesDistinctes" },
      nbBeneficiairesDistincts: { $size: "$beneficiairesDistincts" },
      tauxEchec: { $round: [{ $divide: ["$nbEchecs", "$nbTransactions"] }, 3] },
      premiereTransaction: 1,
      derniereTransaction: 1
    }
  },
  {
    $merge: {
      into: "gold_features_expediteur",
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
]);

print("gold_features_expediteur créée : " + db.gold_features_expediteur.countDocuments() + " expéditeurs distincts.");


// ------------------------------------------------------------
// 3.2 — Features par AGENT (id_agent)
//   - nombre de transactions traitées
//   - taux d'échec par agent (un agent avec un taux anormalement
//     élevé peut être impliqué dans des fraudes ou mal former)
//   - montant total traité
// ------------------------------------------------------------
db.silver_mobile_money.aggregate([
  { $match: { idAgent: { $ne: null } } },
  {
    $group: {
      _id: "$idAgent",
      nbTransactions: { $sum: 1 },
      montantTotal: { $sum: "$montantFcfa" },
      nbEchecs: {
        $sum: { $cond: [{ $eq: ["$statut", "Échec"] }, 1, 0] }
      }
    }
  },
  {
    $project: {
      _id: 1,
      nbTransactions: 1,
      montantTotal: 1,
      tauxEchec: { $round: [{ $divide: ["$nbEchecs", "$nbTransactions"] }, 3] }
    }
  },
  {
    $merge: {
      into: "gold_features_agent",
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
]);

print("gold_features_agent créée : " + db.gold_features_agent.countDocuments() + " agents distincts.");


// ------------------------------------------------------------
// 3.3 — Transferts inter-zones rapprochés dans le temps
//   Un même expéditeur qui envoie de l'argent depuis deux zones
//   différentes en moins de 30 minutes est un signal fort
//   (usurpation possible, compte partagé, etc.)
// ------------------------------------------------------------
db.silver_mobile_money.aggregate([
  { $sort: { "expediteur.numero": 1, dateHeure: 1 } },
  {
    $group: {
      _id: "$expediteur.numero",
      transactions: {
        $push: { dateHeure: "$dateHeure", zone: "$expediteur.zone", idTransaction: "$_id" }
      }
    }
  },
  { $match: { $expr: { $gt: [{ $size: "$transactions" }, 1] } } },
  {
    $project: {
      _id: 1,
      paires: {
        $filter: {
          input: {
            $map: {
              input: { $range: [0, { $subtract: [{ $size: "$transactions" }, 1] }] },
              as: "i",
              in: {
                t1: { $arrayElemAt: ["$transactions", "$$i"] },
                t2: { $arrayElemAt: ["$transactions", { $add: ["$$i", 1] }] }
              }
            }
          },
          as: "paire",
          cond: {
            $and: [
              { $ne: ["$$paire.t1.zone", "$$paire.t2.zone"] },
              {
                $lt: [
                  { $abs: { $subtract: ["$$paire.t2.dateHeure", "$$paire.t1.dateHeure"] } },
                  1800000 // 30 minutes en millisecondes
                ]
              }
            ]
          }
        }
      }
    }
  },
  { $match: { $expr: { $gt: [{ $size: "$paires" }, 0] } } },
  {
    $merge: {
      into: "gold_transferts_inter_zones_suspects",
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
]);

print("gold_transferts_inter_zones_suspects créée : " + db.gold_transferts_inter_zones_suspects.countDocuments() + " expéditeurs concernés.");


// ------------------------------------------------------------
// 3.4 — Corrélation Mobile Money <-> Ventes commerce
//   Ventes payées en Mobile Money le même jour, dans la même
//   zone, pour un montant strictement identique à une transaction
//   Mobile Money — signal de double-comptabilisation ou de
//   détournement possible.
// ------------------------------------------------------------
db.silver_ventes.aggregate([
  { $match: { modePaiement: "Mobile Money" } },
  {
    $lookup: {
      from: "silver_mobile_money",
      let: { montantVente: "$montantFcfa", zoneVente: "$client.zone", dateVente: "$date" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$montantFcfa", "$$montantVente"] },
                { $eq: ["$beneficiaire.zone", "$$zoneVente"] },
                {
                  $eq: [
                    { $dateToString: { format: "%Y-%m-%d", date: "$dateHeure" } },
                    { $dateToString: { format: "%Y-%m-%d", date: "$$dateVente" } }
                  ]
                }
              ]
            }
          }
        }
      ],
      as: "transactionsCorrespondantes"
    }
  },
  { $match: { $expr: { $gt: [{ $size: "$transactionsCorrespondantes" }, 0] } } },
  {
    $project: {
      _id: 1,
      produit: 1,
      montantFcfa: 1,
      date: 1,
      client: 1,
      nbCorrespondances: { $size: "$transactionsCorrespondantes" }
    }
  },
  {
    $merge: {
      into: "gold_correlation_ventes_mobile_money",
      whenMatched: "replace",
      whenNotMatched: "insert"
    }
  }
]);

print("gold_correlation_ventes_mobile_money créée : " + db.gold_correlation_ventes_mobile_money.countDocuments() + " ventes corrélées.");
