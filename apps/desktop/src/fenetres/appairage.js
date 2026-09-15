'use strict';
// QR d'appairage : adresses réelles du serveur (`lanUrls` de /api/health), classées par main.ts → pairingInfo.
(function () {
  var afk = window.afk;
  var infos = null;
  var choisie = 0;
  var $ = function (id) {
    return document.getElementById(id);
  };

  function erreur(texte, detail) {
    $('chargement').hidden = true;
    $('appairage').hidden = true;
    $('autres').hidden = true;
    $('erreur').hidden = false;
    $('erreur-texte').textContent = texte;
    $('erreur-detail').textContent = detail || '';
  }

  function afficher() {
    var adresse = infos.addresses[choisie];
    $('qr').src = adresse.qr;
    $('adresse').textContent = adresse.label;
    $('carte').textContent = adresse.interfaceName ? 'Carte réseau : ' + adresse.interfaceName : '';

    var alertes = [];
    if (!infos.configured) alertes.push('Aucun restaurant sur ce serveur : créez-le d’abord dans la caisse.');
    if (adresse.virtual) alertes.push('Carte réseau virtuelle : les tablettes ne la joignent pas. Reliez le PC au Wi-Fi ou au câble du restaurant.');
    $('alerte').hidden = alertes.length === 0;
    $('alerte-texte').textContent = alertes.join(' ');

    var liste = $('liste');
    liste.textContent = '';
    infos.addresses.forEach(function (a, i) {
      var ligne = document.createElement('button');
      ligne.type = 'button';
      ligne.className = i === choisie ? 'ligne choisie' : 'ligne';
      ligne.setAttribute('aria-pressed', String(i === choisie));
      var libelle = document.createElement('span');
      libelle.textContent = a.label;
      var carte = document.createElement('span');
      carte.className = 'muted';
      carte.textContent = a.interfaceName || '';
      ligne.append(libelle, carte);
      ligne.addEventListener('click', function () {
        choisie = i;
        afficher();
      });
      liste.appendChild(ligne);
    });
    $('autres').hidden = infos.addresses.length < 2;
  }

  function charger() {
    $('chargement').hidden = false;
    $('erreur').hidden = true;
    $('actualiser').disabled = true;
    afk.appairage().then(
      function (r) {
        $('actualiser').disabled = false;
        $('chargement').hidden = true;
        if (!r || !r.ok) return erreur(r ? r.message : 'Serveur AfriKaisse introuvable.', r && r.detail ? 'Détail : ' + r.detail : '');
        if (!r.addresses.length) return erreur('Ce PC n’est relié à aucun réseau local.', 'Branchez le câble ou le Wi-Fi du restaurant, puis actualisez.');
        infos = r;
        if (choisie >= r.addresses.length) choisie = 0;
        $('appairage').hidden = false;
        afficher();
      },
      function () {
        $('actualiser').disabled = false;
        erreur('Serveur AfriKaisse introuvable.', '');
      },
    );
  }

  $('actualiser').addEventListener('click', charger);
  $('fermer').addEventListener('click', function () {
    afk.fermer();
  });
  afk.surActualiser(charger);
  charger();
})();
