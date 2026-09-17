# SANIX OpusFab ERP 2026

ERP industriel pour l'Afrique de l'Ouest. Conforme **SYSCOHADA révisé (AUDCIF)**.

## Modules

Production · GMAO · Stocks & traçabilité lots · Qualité · CRM · Ventes · Achats ·
Comptabilité · Trésorerie · RH & Paie · Logistique · Tableaux de bord

## Adapté à la Côte d'Ivoire

- Plan Comptable OHADA révisé — 270 comptes imputables
- TVA 18 %, export FEC au format DGI
- Paie CNPS, ITS, contribution nationale, FDFP, CMU
- Mobile Money imputé sur 551 Monnaie électronique
- WhatsApp, cartographie hors-ligne, mode dégradé réseau

## Architecture

| Couche | Technologie |
|---|---|
| Frontend | HTML5 · CSS3 · JavaScript ES2025 · PWA · mobile-first |
| Backend | Supabase · PostgreSQL 17 · RLS · Auth |
| Hébergement | Vercel (frontend) · AWS eu-west-3 Paris (base) |

Base de données : voir `MIGRATION_SUPABASE.md` — 46 tables, 103 politiques RLS,
conformité comptable garantie par contrainte et non par convention.

## Développement

Fichier unique `index.html`. Ouvrir directement dans un navigateur, ou servir :

```bash
python3 -m http.server 8000
```

## État

Audit technique complet dans `AUDIT_v5.7.md`. La migration de l'authentification
vers Supabase Auth reste à faire : tant qu'elle n'est pas achevée, le contrôle
d'accès s'exécute côté navigateur et ne doit pas être considéré comme une barrière
de sécurité.
