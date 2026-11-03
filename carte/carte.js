/* ==========================================================================
   Carte du voilier — Leaflet + traces GPX + lecture des récits
   Dépôt : voilier-cocody/mes-traces-gpx  (dossier carte/)
   Prérequis chargés avant : Leaflet, leaflet-gpx, leaflet-fullscreen
   Variables optionnelles définies dans le widget : myLat, myLng, myZoom, myLayers
   ========================================================================== */

  var carte = null;
  var gpxLayers = {};
  var liensArticles = [];       // Rempli dynamiquement par le fichier GitHub JSON
  var boatMarker = null;        // Marqueur du voilier
  var layersParAnnee = {};      // Regroupement des traces par année
  var controleCalques = null;   // Panneau de calques personnalisé
  var popupLecteur = null;      // Popup lecteur d'article (unique, réutilisé)
  var splitActif = false;       // Mode écran partagé : carte à gauche, lecture à droite
  var panneauLecture = null;    // Panneau latéral du mode split
  var indicateurLecture = null; // Marqueur : point de trace correspondant au paragraphe lu
  var registrePoints = [];      // Tous les points GPX horodatés, toutes traces confondues
  var animationRadar = null;        // Animation en cours du radar (requestAnimationFrame)
  var carteEnInteraction = false;   // Vrai pendant que le lecteur manipule la carte
  var minuterieInteraction = null;  // Délai de grâce après un geste sur la carte
  // Position de la ligne de lecture : POURCENTAGE de la hauteur du panneau,
  // mesuré sous le bord inférieur de l'en-tête. UNE SEULE VALEUR à ajuster :
  // elle déplace la ligne visible, le seuil du radar et les tirets de la barre
  // de progression, toujours en cohérence. 33 = ligne au tiers de l'écran.
  var POURCENTAGE_LIGNE_LECTURE = 33;

  function decalageLigneLecturePx() {
    if (!panneauLecture) return 0;
    var p = Math.max(0, Math.min(80, POURCENTAGE_LIGNE_LECTURE)) / 100;
    return p * panneauLecture.clientHeight;
  }

  // URL brute de votre fichier de position sur GitHub
  var urlJsonPosition = "https://raw.githubusercontent.com/voilier-cocody/mes-traces-gpx/refs/heads/main/position.json";

  // Libellés lisibles des mois
  var nomsMois = { "01":"Janvier","02":"Février","03":"Mars","04":"Avril",
                   "05":"Mai","06":"Juin","07":"Juillet","08":"Août",
                   "09":"Septembre","10":"Octobre","11":"Novembre","12":"Décembre" };

  // Fonction pour chercher l'article correspondant à la date cliquée
  function trouverLienArticle(datePoint) {
    if (!datePoint || liensArticles.length === 0) return null;
    for (var i = 0; i < liensArticles.length; i++) {
      var art = liensArticles[i];
      var dateDebut = new Date(art.debut);
      var dateFin = new Date(art.fin);
      if (datePoint >= dateDebut && datePoint <= dateFin) {
        return art;
      }
    }
    return null;
  }

  // Extraction directe du XML pour récupérer l'horodatage exact de chaque point
  function chargerPointsEtDates(url, callback) {
    fetch(url)
      .then(function(response) { return response.text(); })
      .then(function(str) {
        var parser = new DOMParser();
        var xmlDoc = parser.parseFromString(str, "text/xml");
        var trkpts = xmlDoc.getElementsByTagName("trkpt");
        var pointsComplets = [];

        for (var i = 0; i < trkpts.length; i++) {
          var pt = trkpts[i];
          var lat = parseFloat(pt.getAttribute("lat"));
          var lon = parseFloat(pt.getAttribute("lon"));
          var timeNode = pt.getElementsByTagName("time")[0];
          if (timeNode) {
            pointsComplets.push({
              latlng: L.latLng(lat, lon),
              date: new Date(timeNode.textContent)
            });
          }
        }
        callback(pointsComplets);
      })
      .catch(function(err) {
        console.log("Erreur de lecture du fichier GPX XML :", err);
        callback([]);
      });
  }

  // --- POSITION ACTUELLE DU VOILIER ---
  function chargerPositionVoilier() {
    if (!carte) return;

    // On n'affiche le marqueur que sur la page d'accueil
    var estPageAccueil = window.location.pathname === "/" || window.location.pathname === "/index.html";
    if (!estPageAccueil) return;

    // L'ajout de '?t=' force le navigateur à contourner le cache GitHub
    fetch(urlJsonPosition + "?t=" + new Date().getTime())
      .then(function(response) {
        if (!response.ok) throw new Error("Fichier position.json introuvable");
        return response.json();
      })
      .then(function(data) {
        var latLng = [data.latitude, data.longitude];

        // Icône personnalisée (marqueur + onde radar)
        var sailboatIcon = L.divIcon({
          className: 'custom-svg-icon',
          html: `<div class="pulse"></div>
                 <svg viewBox="0 0 24 24" width="60" height="60"
                      style="position: relative; filter: drop-shadow(0px 3px 4px rgba(0,0,0,0.3));">
                   <path fill="#e74c3c" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                 </svg>`,
          iconSize: [60, 60],
          iconAnchor: [30, 60],
          popupAnchor: [0, -60]
        });

        var dateObj = new Date(data.date);
        var dateSeule = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        var heureSeule = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

        var popupContent = '<div style="font-family: sans-serif; font-size: 13px; line-height: 1.5; padding: 8px; color: #333;">' +
                           '<b style="font-size: 15px; color: #2c3e50;">📍 Nous sommes ici</b><br>' +
                           '📡 Source : ' + data.source + '<br>' +
                           '📅 Le ' + dateSeule + ' à ' + heureSeule +
                           '</div>';

        if (boatMarker) {
          boatMarker.setLatLng(latLng);
          boatMarker.getPopup().setContent(popupContent).openPopup();
        } else {
          boatMarker = L.marker(latLng, { icon: sailboatIcon }).addTo(carte);
          boatMarker.bindPopup(popupContent);
          carte.setView(latLng, 8);
        }
      })
      .catch(function(err) {
        console.log("Impossible de charger la position actuelle du voilier :", err);
      });
  }

  function initCarteAutonome() {
    var elCarte = document.getElementById('carte');
    if (!elCarte || carte !== null) return;

    // 1. Table d'articles externe depuis GitHub
    var urlJsonArticles = "https://raw.githubusercontent.com/voilier-cocody/mes-traces-gpx/refs/heads/main/articles.json";
    fetch(urlJsonArticles)
      .then(function(response) { return response.json(); })
      .then(function(data) {
        liensArticles = data;
        console.log("Table de correspondance des articles chargée avec succès !");
      })
      .catch(function(err) {
        console.log("Attention: Impossible de charger le fichier d'articles JSON :", err);
      });

    // 2. Position et zoom par défaut
    var initialLat = (typeof myLat !== 'undefined') ? myLat : 43.4000;
    var initialLng = (typeof myLng !== 'undefined') ? myLng : 5.0317;
    var initialZoom = (typeof myZoom !== 'undefined') ? myZoom : 6;

    carte = L.map('carte', {
      fullscreenControl: true,
      fullscreenControlOptions: { position: 'topleft' },
      closePopupOnClick: false
    }).setView([initialLat, initialLng], initialZoom);

    // Si l'on quitte le plein écran pendant le mode split, on restaure la
    // largeur normale de la carte (sinon elle resterait à 50 %)
    function quitterSplitSiActif() {
      if (splitActif) basculerSplit();
    }
    carte.on('exitFullscreen', quitterSplitSiActif);
    document.addEventListener('fullscreenchange', function() {
      if (!document.fullscreenElement) quitterSplitSiActif();
    });

    // Si le lecteur déplace ou zoome lui-même la carte, on ne la lui reprend pas.
    // Petit délai de grâce après le geste, pour ne pas rebondir aussitôt.
    function debutInteraction() {
      carteEnInteraction = true;
      clearTimeout(minuterieInteraction);
    }
    function finInteraction() {
      clearTimeout(minuterieInteraction);
      minuterieInteraction = setTimeout(function() {
        carteEnInteraction = false;
      }, 2000);
    }
    carte.on('dragstart zoomstart', debutInteraction);
    carte.on('dragend zoomend', finInteraction);

    // 3. Fond satellite Esri + couche de labels (villes, pays) par-dessus
    var vueSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });

    var labelsVilles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Esri'
    });

    // Le groupe : satellite d'abord, labels ensuite (ordre = superposition)
    var satelliteAvecVilles = L.layerGroup([vueSatellite, labelsVilles]);
    satelliteAvecVilles.addTo(carte);

    // 4. Panneau de calques personnalisé (rempli plus tard par construirePanneauParAnnee)
    controleCalques = L.control.layers(null, null, { collapsed: true }).addTo(carte);

    // Panneau visible UNIQUEMENT sur la page d'accueil
    var estPageAccueil = window.location.pathname === "/" || window.location.pathname === "/index.html";
    if (!estPageAccueil) {
      controleCalques.getContainer().style.display = 'none';
    }

    // 5. Marqueur par défaut pour les points GPX
    var defaultIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    // Palette de couleurs des traces
    var palette = ["#e74c3c", "#3498db", "#2ecc71", "#e67e22", "#9b59b6", "#e84393", "#ffffff"];
    var indexCouleur = 0;

    // 6. RÉCUPÉRATION DYNAMIQUE DES FICHIERS GPX DEPUIS L'API GITHUB
    var urlApiGithub = "https://api.github.com/repos/voilier-cocody/mes-traces-gpx/contents/";

    chargerPositionVoilier();

    fetch(urlApiGithub)
      .then(function(response) {
        if (!response.ok) {
          throw new Error("Réponse GitHub KO (Erreur " + response.status + "). Limite d'API atteinte ?");
        }
        return response.json();
      })
      .then(function(fichiers) {
        if (!Array.isArray(fichiers)) {
          console.log("L'API GitHub n'a pas renvoyé un tableau. Contenu reçu :", fichiers);
          return;
        }

        // On ne garde que les fichiers .gpx
        var fichiersGpx = fichiers.filter(function(f) {
          return f.name.toLowerCase().endsWith('.gpx');
        });
        fichiersGpx.reverse();

        // Saison la plus récente (ex: "2026")
        var nomSaisonPlusRecente = fichiersGpx.length > 0 ? fichiersGpx[0].name.replace('.gpx', '') : "";

        fichiersGpx.forEach(function(fichier) {
          var nomSaison = fichier.name.replace('.gpx', '');
          var urlRaw = "https://raw.githubusercontent.com/voilier-cocody/mes-traces-gpx/refs/heads/main/" + fichier.name;

          var couleurChoisie = palette[indexCouleur];
          indexCouleur = (indexCouleur + 1) % palette.length;

          var pointsHorodates = [];
          chargerPointsEtDates(urlRaw, function(points) {
            pointsHorodates = points;
            points.forEach(function(p) {
              registrePoints.push({ date: p.date, latlng: p.latlng, saison: nomSaison });
            });
          });

          var gpxLayer = new L.GPX(urlRaw, {
            async: true,
            marker_options: { startIcon: defaultIcon, endIcon: defaultIcon, pointIcon: defaultIcon },
            polyline_options: { color: couleurChoisie, weight: 8, opacity: 0.85 }
          });

          // Écouteur au clic sur la trace
          gpxLayer.on('click', function(evt) {
            var dateTexte = "Non disponible";
            var dateProche = null;

            if (pointsHorodates.length > 0) {
              var minDistance = Infinity;
              for (var i = 0; i < pointsHorodates.length; i++) {
                var dist = evt.latlng.distanceTo(pointsHorodates[i].latlng);
                if (dist < minDistance) {
                  minDistance = dist;
                  dateProche = pointsHorodates[i].date;
                }
              }
              if (dateProche) {
                dateTexte = dateProche.toLocaleDateString('fr-FR', {
                  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
                });
              }
            }

            var articleCorrespondant = trouverLienArticle(dateProche);
            var estEnPleinEcran = carte.getContainer().classList.contains('leaflet-fullscreen-on');
            var popupContent = '';
            var optionsPopup = {};

            if (estEnPleinEcran && articleCorrespondant) {
              // Mode écran partagé actif : l'article se lit dans le panneau
              // latéral droit, la carte n'ouvre plus de popup
              if (splitActif) {
                if (panneauLecture && panneauLecture._urlArticle === articleCorrespondant.url) {
                  // Même article que celui affiché : pas de reconstruction du
                  // panneau, on défile simplement vers la date cliquée
                  panneauLecture.querySelector('.split-date').textContent = '📍 Nous étions içi le : ' + dateTexte;
                  if (dateProche) panneauLecture._anneeRef = dateProche.getFullYear();
                  var zoneSplit = panneauLecture.querySelector('.zone-lecture-split');
                  if (zoneSplit) {
                    var cibleSplit = localiserParagrapheParDate(zoneSplit, dateProche);
                    if (cibleSplit) defilerVers(cibleSplit, false);
                  }
                  // Le radar suit le nouveau paragraphe atteint
                  setTimeout(majIndicateurLecture, 400);
                } else {
                  remplirPanneauSplit(articleCorrespondant, dateProche, dateTexte);
                }
                return;
              }

              var conteneurId = "article_content_" + new Date().getTime();
              // En-tête draggable (poignée de déplacement) + bouton mode split
              // (icône "écran partagé" : un carré barré d'une ligne verticale,
              // masquée sur mobile/tablette où le mode split n'est pas proposé)
              var petitEcran = window.innerWidth < 1024;
              var boutonSplit = petitEcran ? '' :
                '<button class="btn-split" title="Écran partagé : carte à gauche, lecture à droite" style="background: #3498db; color: #fff; border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer; margin-left: 10px;">' +
                '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align: middle; display: block;">' +
                '<rect x="1.25" y="2.25" width="13.5" height="11.5" rx="1.5" stroke="#fff" stroke-width="1.5"/>' +
                '<line x1="8" y1="3" x2="8" y2="13" stroke="#fff" stroke-width="1.5"/>' +
                '</svg>' +
                '</button>';
              popupContent = '<div style="font-family: sans-serif; font-size: 14px; width: 100%; color: #333; display: flex; flex-direction: column;">' +
                             '<div class="entete-lecture" style="background: #f8f9fa; padding: 10px; margin: -14px -14px 10px -14px; border-radius: 4px 4px 0 0; border-bottom: 1px solid #eee; user-select: none; cursor: move; display: flex; align-items: center;">' +
                             '<div style="flex: 1;">' +
                             '<h3 style="margin: 4px 0 2px 0; color: #2c3e50; font-size: 16px; font-weight: bold;">' + articleCorrespondant.titre + '</h3>' +
                             '<span class="popup-date" style="font-size: 12px; color: #95a5a6;">📍 Nous étions içi le : ' + dateTexte + '</span>' +
                             '</div>' +
                             boutonSplit +
                             '</div>' +
                             '<div id="' + conteneurId + '" class="zone-lecture-popup" style="width: 480px; height: 350px; min-width: 320px; min-height: 200px; max-width: 85vw; max-height: 70vh; overflow: auto; resize: both; line-height: 1.6; padding-right: 8px; box-sizing: border-box;">' +
                             '<div style="text-align:center; padding-top:40px; color:#7f8c8d;"><i>📥 Chargement du récit...</i></div>' +
                             '</div>' +
                             '</div>';

              // Popup lecteur UNIQUE, réutilisé d'un clic à l'autre :
              // il reste ouvert et l'article défile vers la nouvelle date
              if (!popupLecteur) {
                popupLecteur = L.popup({ autoPan: false, className: 'popup-liseuse-gpx' });
                popupLecteur.on('add', function() {
                  var conteneurPopup = popupLecteur.getElement();
                  if (conteneurPopup) {
                    var contenuInterne = conteneurPopup.querySelector('.leaflet-popup-content');
                    if (contenuInterne) {
                      contenuInterne.style.width = '100%';
                      contenuInterne.style.margin = '14px';
                    }
                    // Bouton "⇔" : bascule en écran partagé (une seule fois, par délégation)
                    if (!conteneurPopup.getAttribute('data-btn-split')) {
                      conteneurPopup.setAttribute('data-btn-split', '1');
                      conteneurPopup.addEventListener('click', function(ev) {
                        if (ev.target.closest('.btn-split')) {
                          ev.stopPropagation();
                          basculerSplit();
                        }
                      });
                    }
                  }
                });
                popupLecteur.on('remove', function() {
                  // On restaure le panneau de calques dès que le lecteur est fermé
                  controleCalques.getContainer().style.display = '';
                  // On annule le déplacement manuel : à la réouverture,
                  // le popup se replacera normalement près du point cliqué
                  popupLecteur._deplace = false;
                  popupLecteur._dx = 0;
                  popupLecteur._dy = 0;
                  // Le radar disparaît avec le popup, sauf si on passe en mode split
                  if (!splitActif) supprimerRadar();
                });
              }

              var dejaOuvert = carte.hasLayer(popupLecteur);
              // Sur petit écran (mobile/tablette), on revient au comportement
              // précédent : à chaque clic, on referme le popup et on en ouvre
              // un neuf repositionné près du point cliqué (le cache rend le
              // remplissage instantané, même sans re-téléchargement).
              var ecranRetrait = window.innerWidth < 1024;
              if (ecranRetrait && dejaOuvert) {
                carte.closePopup(popupLecteur); // déclenche 'remove' : remise à zéro
                dejaOuvert = false;
              }
              var deplaceManuellement = !ecranRetrait && !!popupLecteur._deplace;

              var memeArticle = dejaOuvert && popupLecteur._urlArticle === articleCorrespondant.url;

              if (memeArticle) {
                // Même article que celui affiché : pas de rechargement du contenu,
                // on défile simplement vers le paragraphe de la nouvelle date
                var zoneLecture = popupLecteur.getElement() && popupLecteur.getElement().querySelector('.zone-lecture-popup');
                if (zoneLecture) {
                  var cibleScroll = localiserParagrapheParDate(zoneLecture, dateProche);
                  if (cibleScroll) defilerVers(cibleScroll, false);
                }
              } else {
                popupLecteur._urlArticle = articleCorrespondant.url;
                popupLecteur._titreArticle = articleCorrespondant.titre;
                popupLecteur._dateArticle = dateProche;
                popupLecteur._dateTexteArticle = dateTexte;
                popupLecteur._anneeRef = dateProche ? dateProche.getFullYear() : new Date().getFullYear();

                if (!deplaceManuellement) {
                  popupLecteur.setLatLng(evt.latlng);
                  if (dejaOuvert) popupLecteur.update();
                }

                popupLecteur.setContent(popupContent);

                if (!dejaOuvert) {
                  popupLecteur.openOn(carte);
                  // On masque le panneau de calques pendant la lecture de l'article
                  controleCalques.getContainer().style.display = 'none';
                }

                // Chargement de l'article et défilement vers la date du point cliqué
                extraireTexteArticleBlogger(articleCorrespondant.url, conteneurId, dateProche);

                // Popup déplaçable à la souris ou au doigt (via son en-tête)
                rendrePopupDeplacable(popupLecteur);

                // Radar : suit aussi la lecture dans le popup
                brancherRadarPopup(popupLecteur);
              }

            } else {
              popupContent = '<div style="font-family: sans-serif; font-size: 14px; padding: 3px; line-height: 1.4;">' +
                             '📍 <b>Nous étions içi le :</b> ' + dateTexte;

              if (articleCorrespondant) {
                popupContent += '<br><hr style="border:0; border-top:1px solid #eee; margin: 8px 0;">' +
                                '📖 <b>Article :</b> <a href="' + articleCorrespondant.url + '" target="_parent" style="color: #3498db; text-decoration: underline; font-weight: bold;">' +
                                articleCorrespondant.titre + '</a>';
              }
              popupContent += '</div>';

              L.popup({ autoPan: true }).setLatLng(evt.latlng).setContent(popupContent).openOn(carte);
            }
          });

          gpxLayers[nomSaison] = gpxLayer;

          // Affichage par défaut : myLayers si défini, sinon la saison la plus récente
          var afficher = (typeof myLayers !== 'undefined') ? myLayers.includes(nomSaison) : (nomSaison === nomSaisonPlusRecente);

          // --- REGROUPEMENT PAR ANNÉE ---
          // "2024-08" → année "2024" ; "2025" → année "2025"
          var annee = nomSaison.slice(0, 4);
          var morceaux = nomSaison.split('-');
          var libelle;
          if (morceaux.length === 1) {
            libelle = "Toute l'année " + annee;   // ex: 2025.gpx
          } else {
            libelle = (nomsMois[morceaux[1]] || morceaux[1]) + " " + annee;  // ex: Août 2024
          }

          if (!layersParAnnee[annee]) layersParAnnee[annee] = [];
          layersParAnnee[annee].push({
            nom: libelle,
            layer: gpxLayer,
            couleur: couleurChoisie,
            afficher: afficher
          });

          if (afficher) {
            gpxLayer.addTo(carte);
          }
        });

        // Une fois toutes les traces enregistrées, on construit le panneau
        construirePanneauParAnnee();
      })
      .catch(function(err) {
        console.log("Erreur lors de la récupération des fichiers sur l'API GitHub :", err);
      });

  }

  // --- PANNEAU DE CALQUES : ANNÉES UNIQUEMENT ---
  // Une case par année : cocher/décocher bascule toutes les traces de l'année
  function construirePanneauParAnnee() {
    if (!controleCalques) return;
    var conteneur = controleCalques.getContainer();
    var liste = conteneur.querySelector('.leaflet-control-layers-list') || conteneur;
    liste.innerHTML = '';

    // Années les plus récentes en haut
    var annees = Object.keys(layersParAnnee).sort().reverse();

    annees.forEach(function(annee) {
      var couches = layersParAnnee[annee];

      var ligneAnnee = document.createElement('label');
      ligneAnnee.style.cssText = 'display:flex; align-items:center; font-size:13px; font-weight:bold; color:#2c3e50; cursor:pointer; padding:4px; margin:2px 0; border-radius:4px;';

      var caseAnnee = document.createElement('input');
      caseAnnee.type = 'checkbox';
      caseAnnee.style.cssText = 'margin-right:10px; transform:scale(1.1);';
      ligneAnnee.appendChild(caseAnnee);

      ligneAnnee.appendChild(document.createTextNode(' ' + annee));

      // État initial : cochée si toutes les traces de l'année sont affichées
      caseAnnee.checked = couches.every(function(c) { return carte.hasLayer(c.layer); });

      caseAnnee.addEventListener('change', function() {
        couches.forEach(function(c) {
          if (caseAnnee.checked) { carte.addLayer(c.layer); } else { carte.removeLayer(c.layer); }
        });
      });

      liste.appendChild(ligneAnnee);
    });
  }

  // --- PLEIN ÉCRAN SEUL (raccourci du widget de barre latérale) ---
  // Appelable depuis un bouton du blog : onclick="activerPleinEcranCarte()".
  // Ne fait qu'afficher la carte en plein écran — pas de split, pas d'article.
  window.activerPleinEcranCarte = function() {
    var conteneur = document.getElementById('carte');
    if (!conteneur || !carte) return;
    if (!document.fullscreenElement && conteneur.requestFullscreen) {
      var promesse = conteneur.requestFullscreen();
      if (promesse && promesse.catch) promesse.catch(function() {});
    }
    // Recalage de la taille une fois le plein écran installé
    setTimeout(function() { carte.invalidateSize(); }, 300);
  };

  window.chargeMaCarte = function() { initCarteAutonome(); };

  // --- RACCOURCI "LECTURE IMMERSIVE" (un seul clic) ---
  // Plein écran + écran partagé + ouverture du récit le plus récent.
  // Appelable depuis n'importe où dans le blog (widget de barre latérale,
  // bouton dans un article...) : onclick="activerLectureCarte()"
  window.activerLectureCarte = function() {
    var conteneur = document.getElementById('carte');
    if (!conteneur || !carte) return;

    function demarrer() {
      setTimeout(function() {
        carte.invalidateSize();

        // La table des articles (articles.json) et les points GPX peuvent ne
        // pas être encore chargés si l'utilisateur clique très tôt : on attend
        // qu'ils soient prêts (polling toutes les 200 ms, ~10 s maximum).
        var tentatives = 0;
        function ouvrirDernierRecit() {
          if (liensArticles.length === 0 || registrePoints.length === 0) {
            tentatives++;
            if (tentatives <= 50) {
              setTimeout(ouvrirDernierRecit, 200);
              return;
            }
            // Table injoignable : on ouvre quand même l'écran partagé
            if (!splitActif) basculerSplit();
            return;
          }

          // Récit le plus récent = date de fin la plus tardive (champ fin valide)
          var meilleur = null, meilleureFin = null;
          for (var i = 0; i < liensArticles.length; i++) {
            var fin = (liensArticles[i] && liensArticles[i].fin) ? new Date(liensArticles[i].fin) : null;
            if (fin && (!meilleureFin || fin > meilleureFin)) {
              meilleureFin = fin;
              meilleur = liensArticles[i];
            }
          }

          if (!splitActif) basculerSplit();
          if (meilleur) {
            // Ouverture au DÉBUT du récit : date de début, premier paragraphe,
            // radar sur le point de départ de la sortie
            var dateDebut = (meilleur.debut) ? new Date(meilleur.debut) : meilleureFin;
            var dateTexte = dateDebut.toLocaleDateString('fr-FR', {
              day: 'numeric', month: 'long', year: 'numeric'
            });
            remplirPanneauSplit(meilleur, dateDebut, dateTexte);

            // Recentrage : la carte montre par défaut la position actuelle,
            // souvent loin de la trace du récit ouvert. On la centre sur le
            // point GPX du premier jour de navigation (même règle que le radar :
            // jour visé à midi). ATTENTION : le panneau split occupe la moitié
            // droite — le recentrage ne peut se faire qu'UNE FOIS la carte
            // réduite à 50 % (invalidateSize), sinon Leaflet centrerait le
            // point sur l'ancienne géométrie pleine largeur, c'est-à-dire au
            // milieu de l'écran… sous le panneau de lecture.
            var dateRef = new Date(dateDebut.getTime());
            dateRef.setHours(12, 0, 0, 0);
            var pointDepart = null, ecartMin = Infinity;
            for (var p = 0; p < registrePoints.length; p++) {
              var pt = registrePoints[p];
              if (!carte.hasLayer(gpxLayers[pt.saison])) continue;
              var ecart = Math.abs(pt.date.getTime() - dateRef.getTime());
              if (ecart < ecartMin) { ecartMin = ecart; pointDepart = pt; }
            }
            if (pointDepart) {
              var latlngDepart = pointDepart.latlng;
              setTimeout(function() {
                carte.invalidateSize();
                var taille = carte.getSize();
                carte.setView(latlngDepart, Math.max(carte.getZoom(), 10));
                // La zone de lecture couvre la moitié droite de l'écran :
                // le "centre visible" de la carte est donc à 25 % de la
                // largeur. setView place le point à 50 % ; on décale la vue
                // d'un quart de largeur vers la droite pour poser le point
                // au milieu de la demi-carte dégagée du panneau.
                carte.panBy([Math.round(taille.x / 4), 0]);
              }, 400);
            }
          }
        }
        ouvrirDernierRecit();
      }, 200); // laisser le plein écran s'installer avant d'ajuster la carte
    }

    if (!document.fullscreenElement && conteneur.requestFullscreen) {
      // La promesse se résout quand le plein écran est effectivement actif ;
      // en cas de refus (navigateur sans plein écran natif), on continue quand même
      var promesse = conteneur.requestFullscreen();
      if (promesse && promesse.then) {
        promesse.then(demarrer, demarrer);
      } else {
        demarrer();
      }
    } else {
      demarrer();
    }
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initCarteAutonome); } else { initCarteAutonome(); }
  window.addEventListener('load', initCarteAutonome);

  // Cache des articles déjà téléchargés : re-cliquer dans le même article
  // ne retélécharge rien (ni HTML ni images), plus de "saut" à l'écran
  var cacheArticles = {};

  // Fonction automatique : charge l'article, isole le texte, puis se positionne
  // sur le paragraphe correspondant à la date du point de trace cliqué
  function extraireTexteArticleBlogger(urlArticle, idElementA_Remplir, dateCible) {
    (cacheArticles[urlArticle] ?
      Promise.resolve(cacheArticles[urlArticle]) :
      fetch(urlArticle).then(function(response) { return response.text(); })
    )
      .then(function(htmlString) {
        cacheArticles[urlArticle] = htmlString;
        var parser = new DOMParser();
        var docArticle = parser.parseFromString(htmlString, "text/html");
        var corpsArticle = docArticle.querySelector('.post-body') || docArticle.querySelector('.entry-content');
        var cible = document.getElementById(idElementA_Remplir);

        if (corpsArticle && cible) {
          cible.innerHTML = corpsArticle.innerHTML;

          // Images différées : hors écran = pas chargées, décodage hors fil principal.
          // Les photos haute résolution ne bloquent plus le positionnement du lecteur.
          var images = cible.querySelectorAll('img');
          for (var x = 0; x < images.length; x++) {
            images[x].setAttribute('loading', 'lazy');
            images[x].setAttribute('decoding', 'async');
            // Une image qui se charge change la mise en page : les tirets de
            // la barre de progression doivent être repositionnés
            images[x].addEventListener('load', function() {
              if (splitActif && panneauLecture && panneauLecture.contains(cible)) {
                reconstruireBarreProgression();
              }
            });
          }

          // Panneau split : on construit les tirets MAINTENANT que le contenu
          // est réellement injecté. Le délai de 400 ms de remplirPanneauSplit
          // peut tomber avant la fin du chargement (première ouverture, pas
          // encore en cache) : à ce moment-là la course d'ascenseur est nulle
          // et les tirets étaient perdus sans autre retentative.
          if (splitActif && panneauLecture && panneauLecture.contains(cible)) {
            reconstruireBarreProgression();
          }

          if (dateCible) {
            var cibleScroll = localiserParagrapheParDate(cible, dateCible);

            if (cibleScroll) {
              // Défilement initial (animé) : part sans attendre les images
              defilerVers(cibleScroll, false);

              // Recalage : quand une image se charge, la mise en page bouge ;
              // on repositionne le défilement (immédiat, sans animation)
              for (var y = 0; y < images.length; y++) {
                images[y].addEventListener('load', function() {
                  defilerVers(cibleScroll, true);
                });
              }
            }
          }
          // Le radar se cale sur la date atteinte une fois l'article en place,
          // même si le défilement n'a pas bougé (popup ou panneau)
          setTimeout(majIndicateurLecture, 500);
        } else if (cible) {
          cible.innerHTML = "<i>Le texte de l'article n'a pas pu être isolé automatiquement.</i>";
        }
      })
      .catch(function(err) {
        console.log("Erreur d'extraction de l'article :", err);
        var cible = document.getElementById(idElementA_Remplir);
        if (cible) cible.innerHTML = "<i>Erreur lors du chargement du récit.</i>";
      });
  }

  // Convertit une date en texte français en Date
  // "12 mai 2026", "12/05/2026", "12-05-2026" ; et sans année : "12 mai", "12/05"
  // (l'année manquante est reprise de l'année de la date cliquée)
  var moisFrancais = { "janvier":0, "février":1, "fevrier":1, "mars":2, "avril":3, "mai":4, "juin":5,
                       "juillet":6, "août":7, "aout":7, "septembre":8, "octobre":9, "novembre":10, "décembre":11, "decembre":11 };
  function parserDateDansTexte(texte, anneeRef) {
    // Format "12 mai 2026"
    var m = texte.match(/(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})/i);
    if (m) return new Date(parseInt(m[3], 10), moisFrancais[m[2].toLowerCase()], parseInt(m[1], 10));
    // Formats "12/05/2026" et "12-05-2026"
    m = texte.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    // Sans année : "12 mai" / "12/05" / "12-05" → on suppose l'année de la date cliquée
    m = texte.match(/(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\b/i);
    if (m && typeof anneeRef === 'number') return new Date(anneeRef, moisFrancais[m[2].toLowerCase()], parseInt(m[1], 10));
    m = texte.match(/(\d{1,2})[/-](\d{1,2})\b/);
    if (m && typeof anneeRef === 'number') return new Date(anneeRef, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return null;
  }

  // Collecte les éléments porteurs de texte dans un conteneur.
  // Comprend les <div> "feuilles" (sans descendants textuels) : les anciens
  // articles Blogger n'utilisent pas de <p>, tout est dans des <div>.
  // Sans ce filtre, le textContent d'un div conteneur engloberait
  // l'article entier et créerait des repères parasites.
  function collecterElementsTexte(conteneur) {
    var selection = Array.prototype.slice.call(
      conteneur.querySelectorAll('p, h2, h3, h4, li, blockquote, img')
    );
    var divs = conteneur.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      if (!divs[i].querySelector('p, h2, h3, h4, li, blockquote, img, div')) {
        selection.push(divs[i]);
      }
    }
    return selection;
  }

  // Trouve le paragraphe cible correspondant à la date cliquée et retourne l'élément
  // (ou null si aucun repère n'est trouvé : le lecteur reste alors en haut)
  function localiserParagrapheParDate(conteneur, dateCible) {
    // On ne scanne que de vrais éléments de texte (les div conteneurs sont
    // exclus, seuls les div "feuilles" des anciens articles sont retenus).
    // Les images comptent uniquement via un attribut data-date explicite.
    var paragraphes = collecterElementsTexte(conteneur);
    var jourCible = new Date(dateCible.getFullYear(), dateCible.getMonth(), dateCible.getDate());

    // Collecte des candidats : ancres data-date + dates présentes dans le texte
    var candidats = [];
    for (var i = 0; i < paragraphes.length; i++) {
      var el = paragraphes[i];
      var a = el.getAttribute && el.getAttribute('data-date');
      if (a) {
        var parties = a.split('-');
        var dateAncre = new Date(parseInt(parties[0], 10), parseInt(parties[1], 10) - 1, parseInt(parties[2], 10));
        candidats.push({ el: el, date: dateAncre, exact: true });
        continue; // l'ancre prime sur toute date écrite dans le texte de ce même élément
      }
      var dateTxt = parserDateDansTexte(el.textContent || '', dateCible.getFullYear());
      if (dateTxt) candidats.push({ el: el, date: dateTxt, exact: false });
    }
    console.log("Départ de lecture —", candidats.length, "repère(s) trouvé(s) pour la cible",
                jourCible.toLocaleDateString('fr-FR'), ":", candidats.map(function(c) {
                  return (c.exact ? "ancre " : "texte ") + c.date.toLocaleDateString('fr-FR');
                }));
    if (candidats.length === 0) return null; // aucun repère : le lecteur reste en haut

    // 1) Jour exact du point cliqué (ancre ou texte)
    for (var k = 0; k < candidats.length; k++) {
      if (candidats[k].date.getFullYear() === jourCible.getFullYear() &&
          candidats[k].date.getMonth() === jourCible.getMonth() &&
          candidats[k].date.getDate() === jourCible.getDate()) {
        return candidats[k].el;
      }
    }

    // 2) Sinon : dernier repère (ancre ou date du texte) antérieur ou égal au point cliqué
    var meilleur = null;
    for (var l = 0; l < candidats.length; l++) {
      if (candidats[l].date.getTime() <= dateCible.getTime()) {
        if (!meilleur || candidats[l].date.getTime() >= meilleur.date.getTime()) meilleur = candidats[l];
      }
    }
    if (!meilleur) meilleur = candidats[0]; // point cliqué avant le 1er repère : début du récit

    return meilleur.el;
  }

  // --- MODE ÉCRAN PARTAGÉ (split) : carte à gauche, lecture à droite ---
  // Bascule entre le mode popup (normal) et le mode panneau latéral
  function basculerSplit() {
    var conteneurCarte = carte.getContainer();

    if (!splitActif) {
      // Entrée en mode split : la carte occupe la moitié gauche
      splitActif = true;
      conteneurCarte.style.width = '50%';
      carte.invalidateSize();

      creerRadar();

      // Création du panneau latéral droit
      panneauLecture = document.createElement('div');
      panneauLecture.className = 'panneau-lecture-split';
      panneauLecture.innerHTML =
        '<div class="split-entete" style="display:flex; align-items:center; justify-content:space-between; background:#2c3e50; color:#fff; padding:12px 16px; position:sticky; top:0; z-index:2; position:sticky;">' +
        '<div style="flex:1; margin-right:10px;">' +
        '<h3 class="split-titre" style="margin:0 0 2px 0; font-size:16px;"></h3>' +
        '<span class="split-date" style="font-size:12px; color:#bdc3c7;"></span>' +
        '</div>' +
        '<button class="btn-split-exit" title="Quitter le mode écran partagé" style="background:#e74c3c; color:#fff; border:none; border-radius:4px; padding:6px 10px; cursor:pointer; font-size:14px;">✕</button>' +
        // Ligne de lecture : c'est ici que la date change pendant le défilement
        '<div class="ligne-lecture"></div>' +
        '</div>' +        '<div class="zone-lecture-split" style="padding:16px; font-size:15px; line-height:1.7; color:#333;"><i>📥 Chargement du récit...</i></div>' +
        '<div class="barre-progression-lecture" title="Position dans le récit — cliquez un tiret pour sauter à une date">' +
        '<div class="bp-remplissage"></div>' +
        '<div class="bp-reperes"></div>' +
        '</div>';
      // ATTENTION : en plein écran natif (ordinateur), seul l'élément
      // fullscreen et ses descendants sont affichés. On attache donc le
      // panneau À L'ÉLÉMENT PLEIN ÉCRAN (le conteneur de la carte),
      // pas au body, sinon il reste invisible derrière.
      var hotePanneau = document.fullscreenElement || conteneurCarte;
      hotePanneau.appendChild(panneauLecture);

      // Position de la ligne de lecture pilotée par la constante unique
      var ligneVisuelle = panneauLecture.querySelector('.ligne-lecture');
      if (ligneVisuelle) ligneVisuelle.style.bottom = (-decalageLigneLecturePx()) + 'px';

      // Sortie du mode split : le bouton rouge du panneau
      panneauLecture.querySelector('.btn-split-exit').addEventListener('click', function() {
        basculerSplit();
      });

      // Le panneau est un enfant du conteneur de la carte (requis par le
      // plein écran natif) : ses événements remontent donc vers Leaflet.
      // On interrompt la propagation pour que la roulette défile l'article
      // (et non le zoom de la carte), et que la souris ne déplace pas la carte.
      ['wheel', 'dblclick', 'mousedown', 'touchstart', 'touchmove'].forEach(function(evenement) {
        panneauLecture.addEventListener(evenement, function(e) {
          e.stopPropagation();
        }, { passive: true });
      });

      // Pendant le défilement de l'article, on déplace l'indicateur sur la trace.
      // L'événement scroll est très fréquent : on limite le recalcul lourd à
      // ~5 fois/s, MAIS on refait TOUJOURS une passe finale 220 ms après le
      // dernier événement — sans elle, le tout dernier geste de défilement
      // peut être avalé par le frein, et la première/dernière date ratée.
      var dernierCalcul = 0;
      panneauLecture.addEventListener('scroll', function() {
        var maintenant = new Date().getTime();
        if (maintenant - dernierCalcul >= 200) {
          dernierCalcul = maintenant;
          majIndicateurLecture();
        }
        // Rattrapage : une fois le défilement arrêté, dernier recalcule
        if (panneauLecture._minuterieRattrapage) {
          clearTimeout(panneauLecture._minuterieRattrapage);
        }
        panneauLecture._minuterieRattrapage = setTimeout(function() {
          dernierCalcul = 0;
          majIndicateurLecture();
          majBarreProgression();
        }, 220);
        // La barre de progression, très légère, suit chaque événement
        majBarreProgression();
      });

      // On y transfère l'article en cours de lecture dans le popup —
      // mais s'il n'y a PAS de popup ouvert (entrée directe par le bouton
      // de la barre latérale), rien à transférer : le panneau sera rempli
      // par l'appelant (récit le plus récent, par exemple).
      if (popupLecteur && popupLecteur._urlArticle) {
        remplirPanneauSplit(
          { url: popupLecteur._urlArticle, titre: popupLecteur._titreArticle },
          popupLecteur._dateArticle,
          popupLecteur._dateTexteArticle || ''
        );

        // Le popup n'a plus lieu d'être : la carte est entièrement visible à gauche
        carte.closePopup(popupLecteur);
      }
    } else {
      // Sortie du mode split : la carte reprend toute la largeur
      splitActif = false;
      conteneurCarte.style.width = '';
      carte.invalidateSize();
      supprimerRadar();
      if (panneauLecture && panneauLecture.parentNode) {
        panneauLecture.parentNode.removeChild(panneauLecture);
      }
      panneauLecture = null;
    }
  }

  // Charge l'article dans le panneau latéral et défile vers la date cliquée
  function remplirPanneauSplit(article, dateProche, dateTexte) {
    if (!panneauLecture) return;
    // Année de référence pour interpréter les dates du texte sans année
    panneauLecture._anneeRef = dateProche ? dateProche.getFullYear() : new Date().getFullYear();
    panneauLecture._urlArticle = article.url; // pour éviter une reconstruction au prochain clic
    panneauLecture.querySelector('.split-titre').textContent = article.titre;
    panneauLecture.querySelector('.split-date').textContent = '📍 Nous étions içi le : ' + dateTexte;

    // Nouveau conteneur à chaque clic : pas d'état résiduel entre deux lectures
    var zone = panneauLecture.querySelector('.zone-lecture-split');
    zone.id = 'split_zone_' + new Date().getTime();
    zone.innerHTML = '<div style="text-align:center; padding:40px 0; color:#7f8c8d;"><i>📥 Chargement du récit...</i></div>';

    extraireTexteArticleBlogger(article.url, zone.id, dateProche);

    // Une fois l'article injecté, on positionne l'indicateur sur le bon point
    // et on construit les tirets de la barre de progression
    setTimeout(function() {
      reconstruireBarreProgression();
      majIndicateurLecture();
    }, 400);
  }


  // --- INDICATEUR DE LECTURE ---
  // Repères datés d'une zone de texte (panneau split OU popup) : ancres
  // data-date ou dates écrites dans le texte. Les images comptent si elles
  // portent un attribut data-date (photo du jour).
  function construireReperes(zone, anneeRef) {
    var blocs = collecterElementsTexte(zone);
    var reperes = [];
    for (var i = 0; i < blocs.length; i++) {
      var el = blocs[i];
      var d = null;
      var a = el.getAttribute && el.getAttribute('data-date');
      if (a) {
        var parties = a.split('-');
        d = new Date(parseInt(parties[0], 10), parseInt(parties[1], 10) - 1, parseInt(parties[2], 10));
      } else if (el.tagName !== 'IMG') {
        // Pas de scan de texte dans les images : uniquement l'attribut data-date,
        // pour éviter les faux positifs (alt, filigranes, captures d'écran...)
        // Année de référence = année du point cliqué (les dates du texte sans
        // année sont celles de la saison naviguée, pas de l'année en cours)
        d = parserDateDansTexte(el.textContent || '', anneeRef || new Date().getFullYear());
      }
      if (d) reperes.push({ el: el, date: d });
    }
    return reperes;
  }

  // Version panneau split (utilisée par la barre de progression)
  function construireReperesPanneau() {
    if (!panneauLecture) return [];
    var zone = panneauLecture.querySelector('.zone-lecture-split');
    return zone ? construireReperes(zone, panneauLecture._anneeRef) : [];
  }

  // Ce dont le radar a besoin pour suivre la lecture : l'élément qui défile,
  // la zone de texte, la ligne de lecture et l'étiquette de date.
  // null si aucune lecture n'est en cours.
  function contexteLecture() {
    if (splitActif && panneauLecture) {
      var zone = panneauLecture.querySelector('.zone-lecture-split');
      if (!zone) return null;
      var entete = panneauLecture.querySelector('.split-entete');
      var rectPanneau = panneauLecture.getBoundingClientRect();
      return {
        defilant: panneauLecture,
        zone: zone,
        ligneY: entete
          ? entete.getBoundingClientRect().bottom - rectPanneau.top + decalageLigneLecturePx()
          : 60,
        etiquette: panneauLecture.querySelector('.split-date'),
        anneeRef: panneauLecture._anneeRef
      };
    }
    if (popupLecteur && carte.hasLayer(popupLecteur)) {
      var el = popupLecteur.getElement();
      var zonePopup = el && el.querySelector('.zone-lecture-popup');
      if (!zonePopup) return null;
      var pct = Math.max(0, Math.min(80, POURCENTAGE_LIGNE_LECTURE)) / 100;
      return {
        defilant: zonePopup,
        zone: zonePopup,
        ligneY: pct * zonePopup.clientHeight,
        etiquette: el.querySelector('.popup-date'),
        anneeRef: popupLecteur._anneeRef
      };
    }
    return null;
  }

  // Création / suppression du radar (idempotentes : le radar peut passer du
  // popup au mode split sans être recréé)
  function creerRadar() {
    if (indicateurLecture || !carte) return;
    // Indicateur de lecture : zone radar floue ("grosso modo par ici") qui
    // recouvre la zone de navigation du paragraphe lu, sans fausse précision
    indicateurLecture = L.marker([0, 0], {
      interactive: false,
      icon: L.divIcon({
        className: 'radar-lecture',
        html: '<div class="radar-anneaux"></div>',
        iconSize: [200, 200],
        iconAnchor: [100, 100]
      })
    }).addTo(carte);
  }

  function supprimerRadar() {
    if (animationRadar) {
      cancelAnimationFrame(animationRadar);
      animationRadar = null;
    }
    if (indicateurLecture) {
      carte.removeLayer(indicateurLecture);
      indicateurLecture = null;
    }
  }

  // Branche le radar sur le popup de lecture : écoute le défilement de sa zone
  function brancherRadarPopup(popup) {
    creerRadar();
    var el = popup.getElement();
    if (!el || el.getAttribute('data-radar')) return;
    el.setAttribute('data-radar', '1');
    var dernier = 0, minuterie = null;
    // 'scroll' ne remonte pas dans le DOM : on l'écoute en phase de capture
    el.addEventListener('scroll', function(e) {
      if (!e.target.classList || !e.target.classList.contains('zone-lecture-popup')) return;
      var maintenant = new Date().getTime();
      if (maintenant - dernier >= 200) {
        dernier = maintenant;
        majIndicateurLecture();
      }
      clearTimeout(minuterie);
      minuterie = setTimeout(function() { dernier = 0; majIndicateurLecture(); }, 220);
    }, true);
  }

  // --- LARGEUR DE CARTE RÉELLEMENT VISIBLE ---
  // En mode split : tout ce qui est à gauche du panneau de lecture (que la
  // carte soit réduite à 50 % ou qu'elle reste pleine largeur sous le
  // panneau, comme en plein écran natif)
  function largeurVisibleCarte() {
    var taille = carte.getSize();
    if (!splitActif || !panneauLecture) return taille.x;
    var rectCarte = carte.getContainer().getBoundingClientRect();
    var rectPanneau = panneauLecture.getBoundingClientRect();
    var visible = rectPanneau.left - rectCarte.left;
    return Math.max(100, Math.min(taille.x, visible));
  }

  // --- LA CARTE SUIT LE RADAR ---
  function suivreRadar(cible) {
    if (!carte || carteEnInteraction) return;
    if (!splitActif) return; // en mode popup, la carte ne bouge pas (le popup partirait avec elle)

    var taille = carte.getSize();
    var largeurVisible = largeurVisibleCarte();
    var p = carte.latLngToContainerPoint(cible);

    // Zone de confort : 80 % centraux de la partie VISIBLE de la carte
    var margeX = largeurVisible * 0.2;
    var margeY = taille.y * 0.2;
    var dansLaZone = p.x >= margeX && p.x <= largeurVisible - margeX &&
                     p.y >= margeY && p.y <= taille.y - margeY;
    if (dansLaZone) return;

    // On veut le radar au centre de la partie visible, pas au centre de la
    // carte entière : le centre de la carte doit donc se placer à droite du
    // radar, de la moitié de la largeur masquée par le panneau.
    var decalageX = taille.x / 2 - largeurVisible / 2;
    var nouveauCentre = carte.containerPointToLatLng([p.x + decalageX, p.y]);

    var reduire = window.matchMedia &&
                  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    carte.panTo(nouveauCentre, { animate: !reduire, duration: 0.8, easeLinearity: 0.25 });
  }

  // --- DÉPLACEMENT ANIMÉ DU RADAR ---
  function deplacerRadar(cible) {
    if (!indicateurLecture) return;

    // Premier placement (le marqueur démarre à [0,0]) ou préférence
    // "réduire les animations" : on saute directement, sans glisser
    var reduire = window.matchMedia &&
                  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!indicateurLecture._place || reduire) {
      indicateurLecture._place = true;
      indicateurLecture.setLatLng(cible);
      return;
    }

    // Nouvelle cible pendant une animation : on repart de la position affichée
    if (animationRadar) {
      cancelAnimationFrame(animationRadar);
      animationRadar = null;
    }

    var depart = indicateurLecture.getLatLng();
    var dist = depart.distanceTo(cible);
    if (dist < 5) return; // déjà arrivé

    suivreRadar(cible);

    // Durée selon la distance : 300 ms (court) à 1 s (longue traversée)
    var duree = Math.min(1000, Math.max(300, dist / 200));
    var t0 = null;

    function pas(t) {
      if (!indicateurLecture) { animationRadar = null; return; }
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / duree);
      var e = 1 - Math.pow(1 - k, 3); // easing "ease-out" : démarre vite, freine en douceur
      indicateurLecture.setLatLng([
        depart.lat + (cible.lat - depart.lat) * e,
        depart.lng + (cible.lng - depart.lng) * e
      ]);
      animationRadar = (k < 1) ? requestAnimationFrame(pas) : null;
    }
    animationRadar = requestAnimationFrame(pas);
  }

  // Déplace l'indicateur sur le point de trace correspondant au paragraphe lu
  // (panneau split OU popup de lecture)
  function majIndicateurLecture() {
    var ctx = contexteLecture();
    if (!ctx || !indicateurLecture) return;
    var reperes = construireReperes(ctx.zone, ctx.anneeRef);
    if (reperes.length === 0) return;

    // Position de l'ascenseur : les extrêmes imposent première/dernière date
    var defilant = ctx.defilant;
    var maxScroll = defilant.scrollHeight - defilant.clientHeight;
    if (maxScroll < 0) maxScroll = 0; // article plus court que la zone
    var enHaut = defilant.scrollTop <= 40;
    var enBas = defilant.scrollTop >= maxScroll - 40;

    // Pour chaque repère : position d'ascenseur à laquelle il franchit la ligne
    var rectDefilant = defilant.getBoundingClientRect();
    var scrollFranchissement = [];
    for (var i = 0; i < reperes.length; i++) {
      var absRep = reperes[i].el.getBoundingClientRect().top - rectDefilant.top +
                   defilant.scrollTop;
      scrollFranchissement.push(absRep - ctx.ligneY);
    }

    // Repère le plus avancé qui a franchi la ligne, et le plus avancé
    // qui POURRA la franchir avant le fond d'ascenseur
    var dernierFranchi = 0;
    var dernierAtteignable = 0;
    for (var j = 0; j < reperes.length; j++) {
      if (scrollFranchissement[j] <= defilant.scrollTop) dernierFranchi = j;
      if (scrollFranchissement[j] <= maxScroll) dernierAtteignable = j;
    }

    var indexDate;
    if (enHaut) {
      indexDate = 0;
    } else if (enBas) {
      indexDate = reperes.length - 1;
    } else {
      indexDate = dernierFranchi;
      // Repères finaux qui ne franchiront JAMAIS la ligne (plus assez de
      // contenu derrière eux) : on les répartit progressivement sur la
      // fin de course de l'ascenseur, pour qu'ils soient tous atteints
      // au lieu d'apparaître d'un coup tout en bas.
      var restants = reperes.length - 1 - dernierAtteignable;
      if (restants > 0) {
        var depart = scrollFranchissement[dernierAtteignable];
        var course = Math.max(1, maxScroll - depart);
        for (var r = 0; r < restants; r++) {
          // seuil du (r+1)-ième repère non atteignable par la ligne
          var seuil = depart + course * (r + 1) / (restants + 1);
          if (defilant.scrollTop >= seuil) {
            indexDate = dernierAtteignable + 1 + r;
          }
        }
      }
    }

    var dateCourante = reperes[indexDate].date;

    // L'étiquette de date (en-tête du panneau OU du popup) suit la lecture :
    // elle affiche la même date que celle que suit le radar (niveau jour)
    if (ctx.etiquette) {
      var nouveauTexte = '📍 Nous étions içi le : ' +
        dateCourante.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      if (ctx.etiquette.textContent !== nouveauTexte) {
        ctx.etiquette.textContent = nouveauTexte;
      }
    }

    // Point GPX le plus proche dans le temps, parmi les traces VISIBLES.
    // Les repères d'article sont des jours (pas des heures) : on vise midi
    // ce jour-là, pour tomber au cœur de la navigation plutôt qu'à 0h00
    var dateReference = new Date(dateCourante.getTime());
    dateReference.setHours(12, 0, 0, 0);

    var meilleur = null, meilleurEcart = Infinity;
    for (var m = 0; m < registrePoints.length; m++) {
      var pt = registrePoints[m];
      if (!carte.hasLayer(gpxLayers[pt.saison])) continue;
      var ecart = Math.abs(pt.date.getTime() - dateReference.getTime());
      if (ecart < meilleurEcart) { meilleurEcart = ecart; meilleur = pt; }
    }
    // Repli : aucune trace visible ne couvre cette date (saison décochée) ?
    // On cherche alors dans TOUTES les traces, sinon le radar resterait figé.
    if (!meilleur) {
      for (var k = 0; k < registrePoints.length; k++) {
        var ecartRepli = Math.abs(registrePoints[k].date.getTime() - dateReference.getTime());
        if (ecartRepli < meilleurEcart) { meilleurEcart = ecartRepli; meilleur = registrePoints[k]; }
      }
    }
    if (meilleur) deplacerRadar(meilleur.latlng);
  }

  // --- BARRE DE PROGRESSION CHRONOLOGIQUE (mode split) ---
  // Met à jour le remplissage : fraction de la course de l'ascenseur.
  // Sémantique d'ascenseur : 0 % en haut, 100 % quand on est au plus bas.
  function majBarreProgression() {
    if (!panneauLecture) return;
    var remplissage = panneauLecture.querySelector('.bp-remplissage');
    if (!remplissage) return;
    var maxScroll = panneauLecture.scrollHeight - panneauLecture.clientHeight;
    var percent = maxScroll > 0 ? panneauLecture.scrollTop / maxScroll : 1;
    remplissage.style.width = (percent * 100) + '%';
  }

  // Reconstruit les tirets : un par repère daté (ancre, texte, photo data-date).
  // Un tiret est placé à la position d'ascenseur où sa date devient courante
  // (repère franchissant la ligne de lecture) — la même échelle que le remplissage.
  function reconstruireBarreProgression() {
    if (!panneauLecture) return;
    var conteneurMarqueurs = panneauLecture.querySelector('.bp-reperes');
    if (!conteneurMarqueurs) return;
    conteneurMarqueurs.innerHTML = '';
    var maxScroll = panneauLecture.scrollHeight - panneauLecture.clientHeight;
    majBarreProgression();
    if (maxScroll <= 0) return; // article plus court que le panneau : pas de tirets

    var panneauRect = panneauLecture.getBoundingClientRect();
    // Le tiret est placé là où le repère franchit la ligne de lecture
    // (bord inférieur de l'en-tête) : cohérent avec la détection du radar
    var enteteBarre = panneauLecture.querySelector('.split-entete');
    var seuilEntete = enteteBarre
      ? enteteBarre.getBoundingClientRect().bottom - panneauRect.top + decalageLigneLecturePx()
      : 60;
    var reperes = construireReperesPanneau();
    for (var i = 0; i < reperes.length; i++) {
      (function(rep) {
        // Position du repère dans le contenu défilable, indépendante du scroll :
        // rect.top - panneauRect.top + scrollTop = décalage absolu dans le contenu
        var repScroll = rep.el.getBoundingClientRect().top - panneauRect.top +
                        panneauLecture.scrollTop - seuilEntete;
        var percent = repScroll / maxScroll;
        if (percent < 0) percent = 0;
        if (percent > 1) percent = 1;
        var marqueur = document.createElement('div');
        marqueur.className = 'bp-marqueur';
        marqueur.style.left = (percent * 100) + '%';
        marqueur.title = 'Le ' + rep.date.toLocaleDateString('fr-FR');
        marqueur.addEventListener('click', function(ev) {
          ev.stopPropagation();
          defilerVers(rep.el, true);          // défilement lissé vers le repère
          setTimeout(majIndicateurLecture, 500); // le radar suit le saut
        });
        conteneurMarqueurs.appendChild(marqueur);
      })(reperes[i]);
    }
  }

  // Rend le popup déplaçable via son en-tête : le décalage manuel (dx, dy)
  // est réappliqué après CHAQUE repositionnement fait par Leaflet,
  // pour que le popup reste posé par l'utilisateur malgré les clics et zooms
  function rendrePopupDeplacable(popup) {
    var el = popup.getElement();
    if (!el || el.getAttribute('data-deplacable')) return;
    el.setAttribute('data-deplacable', '1');

    popup._dx = 0;
    popup._dy = 0;
    popup._deplace = false;

    // Transform "pur" tel que positionné par Leaflet (sans notre décalage).
    // On repart TOUJOURS de lui : sinon chaque pointermove additionnerait
    // le décalage total au transform courant déjà décalé → mouvement amplifié.
    // Capturé dès l'installation : sinon le premier drag part d'une base vide
    // et le popup disparaît de l'écran.
    var baseTransform = el.style.transform || '';

    function ajouterDecalage(t) {
      var m = (t || '').match(/translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/);
      if (!m) return t || '';
      return 'translate3d(' + (parseFloat(m[1]) + popup._dx) + 'px, ' +
             (parseFloat(m[2]) + popup._dy) + 'px, 0)';
    }

    // On surcharge update() : après chaque repositionnement Leaflet
    // (setContent, zoom, etc.), on mémorise la base puis on réapplique le décalage
    var majOrigine = popup.update.bind(popup);
    popup.update = function() {
      majOrigine();
      baseTransform = el.style.transform || '';
      if (popup._dx || popup._dy) {
        el.style.transform = ajouterDecalage(baseTransform);
      }
    };

    var enCours = false, x0 = 0, y0 = 0;

    // Délégation sur l'élément persistant du popup (l'en-tête est recréé
    // à chaque setContent, un écouteur direct sur lui serait perdu)
    el.addEventListener('pointerdown', function(e) {
      if (!e.target.closest('.entete-lecture')) return;
      enCours = true;
      x0 = e.clientX; y0 = e.clientY;
      e.preventDefault();
    });

    window.addEventListener('pointermove', function(e) {
      if (!enCours) return;
      popup._dx += (e.clientX - x0);
      popup._dy += (e.clientY - y0);
      popup._deplace = true;
      x0 = e.clientX; y0 = e.clientY;
      el.style.transform = ajouterDecalage(baseTransform);
    });

    window.addEventListener('pointerup', function() { enCours = false; });
  }

  // Défilement + petit surlignage pour marquer le paragraphe
  // instant = true : saut direct sans animation (utilisé pour le recalage après chargement d'image)
  function defilerVers(element, instant) {
    setTimeout(function() {
      element.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
      if (!instant) {
        element.style.transition = 'background-color 1.5s ease';
        element.style.backgroundColor = 'rgba(52, 152, 219, 0.25)';
        setTimeout(function() { element.style.backgroundColor = 'transparent'; }, 1600);
      }
    }, instant ? 0 : 150); // en mode instantané, pas d'attente
  }
