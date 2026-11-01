# Fils de l’Homme Pay — base de projet

Cette archive contient une base full-stack de travail (interface + serveur + base SQLite). Elle n'est **pas encore une plateforme de paiement en production**.

## Ce qui est inclus
- Interface responsive : tableau de bord, réseaux sociaux, récompenses, retraits et paramètres.
- Serveur Express, base SQLite et session sécurisée par cookie.
- Formulaire de retrait uniquement : aucun dépôt.
- Routes de départ pour OAuth Facebook/TikTok, qui restent désactivées tant que les clés et les validations nécessaires ne sont pas configurées.
- Historique des demandes de retrait.
- Aucun crédit automatique de solde : il faut définir une source de financement et un système anti-fraude.

## Prérequis pour exécuter sur ordinateur
- Node.js 20 ou plus récent.
- Dans ce dossier : `npm install`
- Copier `.env.example` vers `.env` et définir `SESSION_SECRET`.
- En développement : `npm run dev`, puis ouvrir `http://localhost:3000`.

## Avant publication
1. Héberger sur une adresse HTTPS et configurer `BASE_URL`.
2. Remplacer la session de démonstration par une authentification de production vérifiée (désactiver la route de test en production).
3. Créer l'application Meta, définir l'URL de rappel exacte, limiter les permissions aux besoins, implémenter l'échange du code OAuth et vérifier les jetons côté serveur.
4. Créer l'application TikTok, demander les scopes approuvés, implémenter l'échange de code côté serveur et vérifier les données via les API officielles.
5. Choisir un prestataire de versement qui accepte explicitement les paiements vers la RDC, signer le contrat et intégrer son API de versement côté serveur.
6. Ajouter les contrôles KYC/anti-fraude et les validations administratives nécessaires.
7. Définir une source réelle de revenus et une règle de récompense vérifiable. Les vues ne deviennent pas automatiquement de l'argent.
8. Faire un audit de sécurité, ajouter des tests et vérifier les règles de confidentialité avant ouverture publique.

## Important
- Ne mets jamais les secrets dans le navigateur ou dans le dépôt.
- Ne demande jamais aux utilisateurs leurs mots de passe Facebook/TikTok.
- Les boutons OAuth sont des points de départ, pas une confirmation que l'intégration est approuvée.
- Une demande de retrait enregistrée ici n'envoie aucun argent.
