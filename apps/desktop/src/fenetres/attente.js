'use strict';
// Attente du serveur dans la fenêtre de la caisse ; l'état vient du processus principal (main.ts → setWaiting).
(function () {
  var afk = window.afk;
  var $ = function (id) {
    return document.getElementById(id);
  };

  function afficher(etat) {
    if (!etat) return;
    var echec = etat.etat === 'echec';
    $('message').hidden = echec;
    $('message').textContent = echec ? '' : etat.message;
    $('piste').hidden = echec;
    $('erreur').hidden = !echec;
    $('actions').hidden = !echec;
    $('erreur-texte').textContent = echec ? etat.message : '';
    $('detail').textContent = echec && etat.detail ? 'Détail : ' + etat.detail : '';
  }

  afk.surEtat(afficher);
  afk.etat().then(afficher);
  $('reessayer').addEventListener('click', function () {
    afficher({ etat: 'demarrage', message: 'Démarrage du serveur du restaurant…' });
    afk.reessayer();
  });
  $('journaux').addEventListener('click', function () {
    afk.ouvrirJournaux();
  });
})();
