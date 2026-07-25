// ============================================================
// Phase 2 (complément) — Validation de schéma sur silver_mobile_money
// À exécuter dans mongosh, après avoir fait : use fraud_datalake
// Usage : load("scripts/07_validator_silver.js")
//
// Principe : on applique un $jsonSchema à la collection déjà peuplée,
// en validationLevel "moderate" (ne s'applique qu'aux futures
// insertions/modifications, ne rejette pas les documents déjà présents).
// Cela garantit qu'à partir de maintenant, plus aucun document mal
// structuré ne peut être inséré silencieusement dans la couche Silver,
// ce qui complète les flags de qualité calculés au moment du chargement.
// ============================================================

db.runCommand({
  collMod: "silver_mobile_money",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "source", "expediteur", "beneficiaire", "montantFcfa", "statut", "qualite"],
      properties: {
        _id: { bsonType: "string" },
        source: { bsonType: "string", enum: ["mobile_money"] },
        dateHeure: { bsonType: ["date", "null"] },
        operateur: { bsonType: "string" },
        typeOperation: { bsonType: "string" },
        expediteur: {
          bsonType: "object",
          required: ["numero"],
          properties: {
            numero: { bsonType: "string" },
            zone: { bsonType: ["string", "null"] }
          }
        },
        beneficiaire: {
          bsonType: "object",
          required: ["numero"],
          properties: {
            numero: { bsonType: "string" },
            zone: { bsonType: ["string", "null"] }
          }
        },
        montantFcfa: { bsonType: "double" },
        fraisFcfa: { bsonType: ["double", "null"] },
        idAgent: { bsonType: ["string", "null"] },
        statut: { bsonType: "string" },
        qualite: {
          bsonType: "object",
          properties: {
            montantValide: { bsonType: "bool" },
            agentManquant: { bsonType: "bool" },
            zoneBeneficiaireManquante: { bsonType: "bool" },
            dateValide: { bsonType: "bool" }
          }
        }
      }
    }
  },
  validationLevel: "moderate",
  validationAction: "error"
});

print("Validateur JSON Schema appliqué à silver_mobile_money (validationLevel: moderate).");

// Test : une tentative d'insertion d'un document non conforme doit échouer
try {
  db.silver_mobile_money.insertOne({ _id: "TEST_INVALIDE", source: "mobile_money" });
  print("ERREUR : le document non conforme a été accepté, le validateur ne fonctionne pas.");
} catch (e) {
  print("Test réussi : le validateur rejette bien un document incomplet.");
  print("Message : " + e.message);
}
