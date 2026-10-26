# GSC Business Center — CRM synchronisé (prototype backend)

Cette version inclut une interface web, un backend Node.js/Express, une base SQLite centrale et une connexion par compte. Les prospects enregistrés sur le serveur peuvent être consultés depuis les appareils autorisés qui se connectent à la même URL.

## Prérequis
- Node.js 20 ou plus récent
- Un serveur ou ordinateur qui reste allumé et accessible pour les autres utilisateurs
- Connexion Internet pour l'envoi d'événements Meta

## Installation locale (Windows)
1. Installez Node.js LTS depuis https://nodejs.org/.
2. Décompressez le ZIP dans un dossier, par exemple `C:\GSC-CRM`.
3. Le fichier `.env` est déjà préparé dans cette version du ZIP avec un mot de passe administrateur et une clé secrète uniques. Ne les publiez pas et ne partagez pas ce ZIP publiquement.
4. Les identifiants sont indiqués dans le message ChatGPT qui accompagne ce fichier. Les variables Meta restent vides car elles nécessitent vos identifiants officiels Meta.
5. Ouvrez un terminal dans le dossier du projet.
6. Exécutez :
   ```bash
   npm install
   npm start
   ```
7. Ouvrez `http://localhost:3000`.

Identifiants initiaux par défaut du fichier `.env.example` :
- E-mail : `admin@gsc.local`
- Mot de passe : `ChangezMoi_123456!`

Changez le mot de passe dès la première connexion. Si le compte initial est déjà créé, changer seulement `ADMIN_PASSWORD` dans `.env` ne modifie pas automatiquement le mot de passe existant : utilisez l'écran Administration.

## Synchronisation multi-appareils
Le navigateur envoie les modifications au backend; les données sont stockées dans `data/gsc.sqlite`. Pour que plusieurs ordinateurs synchronisent les mêmes données, déployez le serveur sur un hébergement accessible en HTTPS et ouvrez la même URL depuis chaque appareil. Cette version rafraîchit les données à la demande; le rafraîchissement automatique en temps réel n'est pas activé.

## Export et sauvegardes
- Export CSV depuis l'écran Prospects (ouvrable dans Excel).
- Sauvegarde JSON depuis Administration.
- En production, configurez des sauvegardes automatiques chiffrées de `data/gsc.sqlite`.

## Meta et WhatsApp — limites importantes
L'interface peut préparer et envoyer QualifiedLead/Purchase depuis le backend uniquement si vous configurez des identifiants Meta valides et si votre compte/dataset est compatible avec les événements Business Messaging utilisés dans le code.
Pour l'attribution Click-to-WhatsApp, `ctwa_clid` doit être capturé depuis le webhook de WhatsApp Business Platform (ou un fournisseur compatible) et enregistré sur la fiche. Ce projet ne comprend pas encore le webhook WhatsApp entrant, la validation de signature du webhook, ni l'onboarding Meta. Sans cela, le système CRM synchronisé fonctionne, mais l'attribution automatique des messages publicitaires ne fonctionne pas.
- Ne jamais exposer `META_ACCESS_TOKEN` au navigateur.
- Vérifiez les événements dans Meta Events Manager avant toute campagne.
- Envoyez Purchase uniquement après un paiement confirmé.
- Respectez les exigences applicables de consentement, de confidentialité et de conservation des données.

## Avant production
Cette base est un starter opérationnel, pas une certification de sécurité ni un déploiement effectué. Ajoutez HTTPS, gestion des rôles, rotation des secrets, politique de sauvegarde/restauration, journalisation, et testez la compatibilité de la Conversions API avec la version Graph API et les autorisations de votre application Meta.
