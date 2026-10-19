const fs = require("fs");

const key = process.env.VESSELAPI_KEY; // Remplacez par votre clé VesselAPI si nécessaire
const mmsi = process.env.MMSI;

if (!key || !mmsi) {
  console.error("Erreur : Variables manquantes.");
  process.exit(1);
}

async function getLatestPosition() {
  try {
    // Exemple d'appel HTTP vers un point de terminaison REST de position de navire
    const response = await fetch(`https://vesselapi.com{mmsi}/position`, {
      headers: { 'Authorization': `Bearer ${key}` }
    });

    if (!response.ok) {
      throw new Error(`Erreur API: ${response.status}`);
    }

    const data = await response.json();
    
    // Extraction des données selon la structure de l'API choisie
    const out = {
      latitude: data.latitude,
      longitude: data.longitude,
      date: new Date(data.timestamp).toISOString(),
      sog: data.speed ?? null,
      cog: data.course ?? null,
      source: "ais",
    };

    fs.writeFileSync("position.json", JSON.stringify(out, null, 2));
    console.log("Position mise à jour avec succès via API REST.");
    process.exit(0);

  } catch (error) {
    console.error("Impossible de récupérer la position :", error.message);
    process.exit(1);
  }
}

getLatestPosition();
