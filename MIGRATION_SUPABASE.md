# Base de données — SANIX OpusFab ERP 2026

Projet Supabase : **sanix-opusfab** · ref `mglosevjadbvwurdrlsz` · eu-west-3 (Paris) · PostgreSQL 17

> Le nom du projet est une étiquette d'affichage. La référence `mglosevjadbvwurdrlsz`
> et l'URL d'API sont **permanentes** : renommer le projet ne casse aucune connexion.
URL API : `https://mglosevjadbvwurdrlsz.supabase.co`
Clé publiable : `sb_publishable_5M7FKSrYIqvoSt9Jww5HbQ_gkZ6JC1d`

> La clé publiable est conçue pour le client. Elle ne donne aucun droit :
> tout accès passe par RLS. La clé `service_role` ne doit **jamais** atteindre le navigateur.

---

## 1. État

| Élément | Valeur |
|---|---|
| Tables | 46 |
| Politiques RLS | 103 |
| Tables sans RLS | **0** |
| Comptes SYSCOHADA | 270 (tous imputables) |
| Rôles | 13 |
| Permissions | 37 |

---

## 2. Migrations

| # | Nom | Contenu |
|---|---|---|
| 01 | `socle_multi_societe_auth_rbac` | Sociétés, profils, rôles, permissions, audit, fonctions RLS |
| 02 | `referentiel_roles_permissions` | 13 rôles · 37 permissions · 96 attributions |
| 03a | `referentiel_syscohada_table` | Table du référentiel normatif OHADA |
| 03b | `seed_plan_syscohada_revise` | 266 comptes AUDCIF |
| 03c | `comptabilite_partie_double_fec` | Exercices, journaux, écritures, FEC |
| 04 | `tiers_articles_stocks` | Tiers, contacts, articles, dépôts, lots, mouvements, CMUP |
| 05 | `crm_ventes_achats_reglements` | Leads, devis→facture, achats, règlements, lettrage |
| 06 | `rh_paie_cnps_its_syscohada` | Employés, paramètres légaux CI, bulletins, congés, pointages |
| 07 | `production_gmao_qualite` | OF, sessions, TRS, équipements, OT, NC, actions correctives |
| 08 | `complements_referentiel_et_index_fk` | Comptes manquants + 38 index sur clés étrangères |
| 09 | `durcissement_droits_et_extensions` | Révocation `anon`, extensions hors `public` |

---

## 3. Sécurité

### Cloisonnement
Chaque table métier porte `entreprise_id`. Les politiques s'appuient sur
`app.entreprises_visibles()`, qui remonte l'arbre société → filiales. Un utilisateur
ne voit jamais au-delà de son périmètre, quel que soit le code client.

### Fonctions d'accès
`SECURITY DEFINER` + `search_path = ''` — évitent la récursion RLS classique
(une policy sur `profiles` qui interroge `profiles`).

| Fonction | Rôle |
|---|---|
| `app.entreprise_id()` | Société de l'utilisateur courant |
| `app.entreprises_visibles()` | Société + filiales (récursif) |
| `app.dans_perimetre(uuid)` | Test de cloisonnement |
| `app.has_role(text)` | Rôle porté |
| `app.has_perm(text)` | Permission effective (admin = tout) |
| `app.is_admin()` | Raccourci |

### Confidentialité renforcée
- **Bulletins de paie** : lisibles par leur titulaire ou par `paie.lire` uniquement.
- **Leads** : un commercial ne voit que son portefeuille ; les encadrants voient tout.
- **Journal d'audit** : écriture réservée aux triggers `SECURITY DEFINER`, aucune
  politique `insert` — un client ne peut ni forger ni effacer une trace.
- **Mouvements de stock** : ni `update` ni `delete`. Une correction passe par un
  mouvement inverse, l'historique reste intact.

### Avertissements restants
Deux fonctions RPC sont signalées `SECURITY DEFINER` exécutables par les
utilisateurs connectés : `initialiser_plan_comptable` et `comptabiliser_bulletin`.
C'est **voulu** — elles doivent écrire dans `ecritures` en contournant RLS, et
chacune vérifie les droits dès sa première ligne (`app.is_admin()`,
`app.has_perm('paie.valider')`, `app.dans_perimetre()`). `anon` en est révoqué.

---

## 4. Conformité SYSCOHADA

### Garanties par contrainte, pas par convention

| Règle | Mécanisme |
|---|---|
| Partie double | Trigger différé : débit = crédit à la validation |
| Minimum deux lignes | Même trigger |
| Un seul sens par ligne | `check ((debit > 0) <> (credit > 0))` |
| Imputation sur compte imputable | Trigger sur `compte` — refus si absent, inactif ou collectif |
| Date dans l'exercice | Trigger sur `ecritures` |
| Exercice clôturé verrouillé | Trigger sur `ecritures` |
| Intangibilité du Livre-Journal | Écriture validée non modifiable — extourne obligatoire |
| Numérotation continue | Séquence par journal et exercice (exigence FEC) |
| Exercices sans chevauchement | Contrainte `exclude using gist` |
| Durée d'exercice ≤ 18 mois | `check` |

### Vues
- `v_balance` — balance par compte et exercice
- `v_fec` — Fichier des Écritures Comptables, format DGI Côte d'Ivoire
- `v_balance_agee_clients` — tranches non échu / 1-30 / 31-60 / 61-90 / +90
- `v_stock_actuel` — quantités et valorisation CMUP
- `v_trs` — taux de disponibilité et de qualité par ligne de production

### Corrections normatives portées en base
L'ancien plan du fichier HTML était le **PCG français**. Le référentiel chargé est
le **Plan Comptable OHADA révisé (AUDCIF)**.

| Ancien | Libellé annoncé | Réalité SYSCOHADA | Retenu |
|---|---|---|---|
| 4456 | TVA collectée | TVA transférée par d'autres entreprises | **4431** |
| 4457 | TVA déductible | non normalisé | **4452** |
| 641 | Rémunérations du personnel | Impôts et taxes directs | **6611** |
| 645 | Charges sociales patronales | — | **6641** |
| 661 | Intérêts des emprunts | Rémunérations personnel national | **671** |
| 421 | Personnel à payer | Personnel, **avances** et acomptes | **422** |
| 422 | Avances au personnel | Personnel, **rémunérations dues** | **421** |
| 701 | Ventes de produits finis | Ventes de **marchandises** | **702** |
| 71 | Variation de stocks | **Subventions d'exploitation** | **736** |
| 695 | Impôt BIC | — | **891** |
| 65, 31, 32, 36, 17, 91… | comptes à 2 chiffres | non imputables → FEC rejeté | comptes à 3+ chiffres |

Mobile Money est imputé sur **551 Monnaie électronique**, compte introduit par le
SYSCOHADA révisé — et non sur 572, qui désigne une caisse de succursale.

### Paie Côte d'Ivoire
`comptabiliser_bulletin()` produit l'écriture complète :

```
D 6611 Salaires                    D 6641 CNPS retraite patronale
D 6612 Primes                      D 6642 CNPS accidents du travail
D 6631 Indemnité transport         D 6643 CNPS prestations familiales
D 6632 Indemnité logement          D 6648 CMU employeur
D 6617 Avantages en nature         D 6413/6414 FDFP
                    C 422  Net à payer
                    C 4311 CNPS part salariale
                    C 4312 CNPS part patronale
                    C 4471 ITS retenu à la source
                    C 4472 Contribution nationale
                    C 433  CMU à reverser
                    C 442  FDFP à reverser
                    C 421  Retenue sur avances
```

Les taux (CNPS 6,3 % / 7,7 % / 5,25 % / 3 %, FDFP 0,4 % + 1,2 %, plafond 3 375 000,
SMIG, abattement ITS) vivent dans `parametres_paie`, **versionnés par date d'effet** :
un changement de loi ne réécrit pas l'historique.

---

## 5. Règles métier automatiques

| Déclencheur | Effet |
|---|---|
| Insertion d'une sortie de stock | Refus si stock insuffisant |
| Insertion d'une entrée valorisée | Recalcul du CMUP |
| Modification d'une ligne de vente/achat | Retotalisation HT / TVA / TTC de l'en-tête |
| Facture client | Refus si le plafond de crédit est dépassé |
| Affectation d'un règlement | Refus si dépassement du montant réglé |
| Affectation enregistrée | Mise à jour du solde et du statut du document |
| Inscription d'un utilisateur | Création automatique du profil |
| Écriture comptable | Trace intégrale dans `audit_log` |

---

## 6. Amorçage

```sql
-- 1. Créer la société
insert into public.entreprises (code, raison_sociale, forme_juridique, ville,
                                rccm, compte_contribuable, taux_tva_defaut)
values ('SANIX','Sanix Factory','SARL','Abidjan','CI-ABJ-2024-B-12345','1234567A', 18);

-- 2. Créer le premier utilisateur via Supabase Auth (Dashboard ou signUp),
--    en passant entreprise_id dans raw_user_meta_data.

-- 3. Lui attribuer le rôle admin
insert into public.user_roles (user_id, role_code, entreprise_id)
select p.id, 'admin', p.entreprise_id from public.profiles p where p.email = 'admin@…';

-- 4. Charger le plan comptable et les journaux (connecté en admin)
select public.initialiser_plan_comptable('<entreprise_id>');

-- 5. Ouvrir l'exercice
insert into public.exercices (entreprise_id, libelle, date_debut, date_fin)
values ('<entreprise_id>','Exercice 2026','2026-01-01','2026-12-31');

-- 6. Charger les paramètres de paie en vigueur
insert into public.parametres_paie (entreprise_id, date_effet) values ('<entreprise_id>','2026-01-01');
```

---

## 7. Authentification — fait

Le contrôle d'accès navigateur est supprimé. L'identité vient d'un JWT signé.

| Avant | Après |
|---|---|
| 14 mots de passe en clair dans le source | aucun — `grep "pass:'"` → 0 |
| `SESSION = {role:'admin'}` par défaut | `SESSION = null` avant authentification |
| deux gardes recréant une session admin | supprimées |
| hash SHA-256 à 1 tour en localStorage | bcrypt côté serveur (GoTrue) |
| verrou anti-bruteforce annulé par F5 | limitation serveur par IP et par compte |
| `connect-src *` | `'self'` + le projet Supabase |
| aucune récupération de mot de passe | lien par e-mail |

Le premier inscrit devient administrateur (trigger `promouvoir_premier_utilisateur`).
Les suivants n'ont aucun rôle tant qu'un administrateur ne leur en accorde un.

**Aucun repli local.** Si la bibliothèque Supabase ne charge pas, l'application
affiche un écran de blocage plutôt que de retomber sur une authentification
navigateur — un repli silencieux aurait annulé tout le reste.

### Vues de session
- `v_ma_session` — profil, société, rôle applicatif, rôles et permissions en un appel
- `v_annuaire` — noms, postes et rôles des collègues, sans donnée sensible

## 8. Synchronisation des données

PostgreSQL devient la référence. `localStorage` reste le cache de travail :
l'application continue de lire `DB.*` sans modification, et toute écriture part
vers Supabase.

### Collections branchées

| `DB.*` | Table | Sens |
|---|---|---|
| `contacts` | `tiers` (client, prospect) | ↔ |
| `fournisseurs` | `tiers` (fournisseur) | ↔ |
| `articles` | `articles` | ↔ |
| `employes` | `employes` | ↔ |

Les autres collections restent locales. Le mécanisme est en place : brancher une
collection de plus revient à ajouter une entrée dans la table `PLAN`.

### Fonctionnement

`saveData()` — le point de sauvegarde unique de l'application — est intercepté.
À chaque appel, les fiches modifiées depuis la dernière photographie sont
détectées et envoyées. Aucun appel existant n'a été réécrit.

| Situation | Comportement |
|---|---|
| En ligne | Envoi immédiat par `upsert` sur `(entreprise_id, ref_externe)` |
| Hors ligne | Mise en file d'attente locale, rejouée au retour du réseau |
| Retour en ligne | File vidée puis relecture du serveur |
| Toutes les minutes | File vidée en silence |
| Ligne refusée par une contrainte | Retirée de la file et journalisée — sinon elle bloquerait tout |

Une pastille en bas à gauche indique l'état : *à jour*, *n en attente*, *hors ligne*.
Un clic force la synchronisation.

### Correspondance des identifiants

L'application génère des identifiants courts (`c1`, `art3`). La colonne
`ref_externe` les conserve, ce qui rend la synchronisation idempotente dans les
deux sens sans réécrire le frontend. Le `code` tiers et le `matricule` employé
sont dérivés automatiquement quand ils manquent.

### Reprise de l'existant

```js
sfPremierEnvoi()   // envoie tout le contenu local vers le serveur, puis relit
sfSynchroniser()   // vide la file puis relit
sfRecevoir()       // relit seulement
sfFileAttente()    // nombre d'écritures en attente
```

`sfPremierEnvoi()` est à lancer **une fois**, depuis la console, par un
administrateur connecté. L'opération est idempotente : la relancer ne crée pas
de doublon.

## 9. Reste à faire

1. **Créer le premier compte** : ouvrir l'application, saisir e-mail et mot de passe,
   cliquer « Première connexion — créer mon compte ». Ce compte devient administrateur.
2. **Fermer l'inscription publique** ensuite : Dashboard → Authentication →
   Sign In / Providers → désactiver *Allow new users to sign up*. Sinon n'importe qui
   peut créer un compte (sans rôle, donc sans accès — mais autant fermer la porte).
3. **Migrer les données** `localStorage` vers les tables.
4. **Écriture des données** : l'application lit et écrit encore dans `localStorage`.
   Seule l'authentification passe par Supabase à ce stade.
5. Edge Function proxy pour l'IA — la clé Anthropic ne doit jamais atteindre le client.
6. Reprise des à-nouveaux via le journal `AN`.
7. Table de correspondance ancien compte → nouveau compte pour retraiter
   l'historique comptable saisi sous le mapping erroné.

## 10. État de livraison

La base est **vide de toute donnée client**. Seuls subsistent les référentiels,
qui ne sont pas des données client :

| Conservé | Volume |
|---|---|
| Plan comptable OHADA (référentiel) | 270 comptes |
| Plan comptable de la société | 270 comptes |
| Journaux | 9 |
| Exercice ouvert | 2026 |
| Paramètres de paie (taux légaux CI) | 1 jeu |
| Dépôt principal | 1 |
| Rôles / permissions | 13 / 37 |

| Vidé | |
|---|---|
| Tiers, articles, employés | 0 |
| Écritures, ventes, achats, règlements | 0 |
| Mouvements de stock, lots, inventaires | 0 |
| Production, GMAO, qualité | 0 |
| Journal d'audit | 0 |

La société est une coquille nommée « Société à configurer ». Le client renseigne
raison sociale, RCCM et compte contribuable au premier démarrage — ces mentions
sont obligatoires sur une facture en Côte d'Ivoire.
