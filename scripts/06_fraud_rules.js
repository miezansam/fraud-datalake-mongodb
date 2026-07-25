// ============================================================
// Phase 4 — Règles de détection et scoring
// À exécuter dans mongosh, après avoir fait : use fraud_datalake
// Usage : load("scripts/06_fraud_rules.js")
//
// Principe : on calcule des seuils (fixes ou statistiques selon la pertinence
// pour ce jeu de données) sur les features Gold, on marque les entités "à
// risque", puis on calcule un score de risque par transaction en combinant :
//   - anomalies propres à la transaction (montant invalide)
//   - anomalies propres à l'expéditeur (vélocité, variabilité, multi-bénéficiaires)
//   - anomalies propres à l'agent (taux d'échec élevé, calculé par percentile 95)
//
// ⚠️ Les seuils (2 points, 1.5x, 0.3, etc.) sont volontairement
// simples et doivent être justifiés/ajustés dans le rapport —
// ce n'est pas un modèle ML, mais un système de règles explicable.
// ============================================================

// --- 4.1 — Calcul des seuils statistiques (percentile 95) ---

// Note importante : le percentile 95 du nombre de transactions (et du nombre
// de bénéficiaires distincts) par expéditeur tombe sur 1 dans ce jeu de données,
// car 98,7% des expéditeurs n'envoient qu'une seule transaction sur toute la
// période (voir analyse de distribution dans le rapport). Utiliser ce percentile
// comme seuil flaguerait presque tout le monde dès la 2e transaction, ce qui n'a
// aucun sens métier. On fixe donc des seuils manuels plus réalistes : les
// expéditeurs ayant 2 transactions ou plus représentent déjà le groupe le plus
// actif (1,3% des expéditeurs), on retient donc ce seuil comme signal faible.
const seuilTransactions = 2;
const seuilBeneficiaires = 2;
print("Seuil fixe (justifié) nombre de transactions par expéditeur : " + seuilTransactions);
print("Seuil fixe (justifié) nombre de bénéficiaires distincts : " + seuilBeneficiaires);

const statsAgent = db.gold_features_agent.aggregate([
  { $match: { nbTransactions: { $gte: 30 } } },
  {
    $group: {
      _id: null,
      p95TauxEchec: { $percentile: { input: "$tauxEchec", p: [0.95], method: "approximate" } }
    }
  }
]).toArray()[0];

const seuilTauxEchecAgent = statsAgent.p95TauxEchec[0];
print("Seuil P95 taux d'échec agent (agents avec >= 30 transactions) : " + seuilTauxEchecAgent);


// --- 4.2 — Marquage des expéditeurs à risque ---

db.gold_features_expediteur.aggregate([
  {
    $addFields: {
      veloticeSuspecte: { $gte: ["$nbTransactions", seuilTransactions] },
      multiBeneficiairesSuspect: { $gte: ["$nbBeneficiairesDistincts", seuilBeneficiaires] },
      variabiliteSuspecte: {
        $and: [
          { $gte: ["$nbTransactions", 5] },
          {
            $gt: [
              { $cond: [{ $eq: ["$montantMoyen", 0] }, 0, { $divide: ["$montantEcartType", "$montantMoyen"] }] },
              1.5
            ]
          }
        ]
      },
      // ⚠️ Le taux d'échec n'est fiable statistiquement qu'avec un minimum
      // d'observations. Sur un échantillon d'une seule transaction, le taux
      // vaut mécaniquement 0% ou 100% sans que cela soit un vrai signal.
      // On exige donc au moins 5 transactions avant de considérer ce critère
      // (ce qui, vu le maximum de 3 transactions par expéditeur observé dans
      // ce jeu de données, désactive de fait ce critère au niveau expéditeur
      // — c'est un résultat honnête à documenter, pas un bug).
      tauxEchecEleve: {
        $and: [{ $gte: ["$nbTransactions", 5] }, { $gt: ["$tauxEchec", 0.3] }]
      }
    }
  },
  {
    $addFields: {
      scoreRisque: {
        $sum: [
          { $cond: ["$veloticeSuspecte", 1, 0] },
          { $cond: ["$multiBeneficiairesSuspect", 1, 0] },
          { $cond: ["$variabiliteSuspecte", 2, 0] },
          { $cond: ["$tauxEchecEleve", 1, 0] }
        ]
      }
    }
  },
  { $merge: { into: "gold_features_expediteur", whenMatched: "merge", whenNotMatched: "discard" } }
]);

print("Expéditeurs à risque (score > 0) : " + db.gold_features_expediteur.countDocuments({ scoreRisque: { $gt: 0 } }));


// --- 4.3 — Marquage des agents à risque ---

db.gold_features_agent.aggregate([
  {
    $addFields: {
      tauxEchecSuspect: {
        $and: [{ $gte: ["$nbTransactions", 30] }, { $gt: ["$tauxEchec", seuilTauxEchecAgent] }]
      }
    }
  },
  { $addFields: { scoreRisque: { $cond: ["$tauxEchecSuspect", 3, 0] } } },
  { $merge: { into: "gold_features_agent", whenMatched: "merge", whenNotMatched: "discard" } }
]);

print("Agents à risque (score > 0) : " + db.gold_features_agent.countDocuments({ scoreRisque: { $gt: 0 } }));


// --- 4.4 — Génération des alertes au niveau transaction ---

db.silver_mobile_money.aggregate([
  {
    $lookup: {
      from: "gold_features_expediteur",
      localField: "expediteur.numero",
      foreignField: "_id",
      as: "profilExpediteur"
    }
  },
  { $unwind: { path: "$profilExpediteur", preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: "gold_features_agent",
      localField: "idAgent",
      foreignField: "_id",
      as: "profilAgent"
    }
  },
  { $unwind: { path: "$profilAgent", preserveNullAndEmptyArrays: true } },
  {
    $addFields: {
      scoreTransaction: { $cond: [{ $eq: ["$qualite.montantValide", false] }, 3, 0] },
      scoreExpediteur: { $ifNull: ["$profilExpediteur.scoreRisque", 0] },
      scoreAgent: { $ifNull: ["$profilAgent.scoreRisque", 0] }
    }
  },
  {
    $addFields: {
      scoreTotal: { $add: ["$scoreTransaction", "$scoreExpediteur", "$scoreAgent"] }
    }
  },
  { $match: { scoreTotal: { $gte: 2 } } },
  {
    $project: {
      _id: 1,
      dateHeure: 1,
      expediteur: 1,
      beneficiaire: 1,
      montantFcfa: 1,
      idAgent: 1,
      statut: 1,
      scoreTotal: 1,
      motifs: {
        $concatArrays: [
          { $cond: [{ $eq: ["$qualite.montantValide", false] }, ["Montant invalide (≤ 0)"], []] },
          { $cond: ["$profilExpediteur.veloticeSuspecte", ["Fréquence de transactions anormalement élevée pour cet expéditeur"], []] },
          { $cond: ["$profilExpediteur.multiBeneficiairesSuspect", ["Nombre inhabituel de bénéficiaires distincts"], []] },
          { $cond: ["$profilExpediteur.variabiliteSuspecte", ["Montants très irréguliers pour cet expéditeur"], []] },
          { $cond: ["$profilAgent.tauxEchecSuspect", ["Agent avec un taux d'échec anormalement élevé"], []] }
        ]
      }
    }
  },
  { $merge: { into: "alertes_fraude", whenMatched: "replace", whenNotMatched: "insert" } }
]);

print("--------------------------------------------------");
print("Total alertes générées : " + db.alertes_fraude.countDocuments());
print("Répartition par score :");
db.alertes_fraude.aggregate([
  { $group: { _id: "$scoreTotal", nb: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).forEach(doc => print("  score " + doc._id + " : " + doc.nb + " alertes"));


// --- 4.5 — Niveau de sévérité (pour un rapport plus nuancé) ---
// score 2      : à surveiller (signal faible, souvent isolé)
// score 3 à 4  : suspect (un critère fort ou une combinaison de critères faibles)
// score 5 et + : prioritaire (plusieurs critères forts combinés)

db.alertes_fraude.updateMany(
  { scoreTotal: 2 },
  { $set: { niveauRisque: "A_SURVEILLER" } }
);
db.alertes_fraude.updateMany(
  { scoreTotal: { $gte: 3, $lte: 4 } },
  { $set: { niveauRisque: "SUSPECT" } }
);
db.alertes_fraude.updateMany(
  { scoreTotal: { $gte: 5 } },
  { $set: { niveauRisque: "PRIORITAIRE" } }
);

print("--------------------------------------------------");
print("Répartition par niveau de sévérité :");
db.alertes_fraude.aggregate([
  { $group: { _id: "$niveauRisque", nb: { $sum: 1 } } },
  { $sort: { nb: -1 } }
]).forEach(doc => print("  " + doc._id + " : " + doc.nb + " alertes"));
