// Erreur "metier" renvoyee par une source (droits, donnee invalide...).
// Le serveur la transmet telle quelle au front avec son code HTTP.
class ErreurSource extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { ErreurSource };
