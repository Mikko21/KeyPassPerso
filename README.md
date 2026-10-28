# KeyPassPerso

Gestionnaire de mots de passe personnel, zero-knowledge, déployable sur Vercel.

## Sécurité

- Chiffrement **AES-256-GCM** dans le navigateur (WebCrypto, aucune lib crypto tierce).
- Clé dérivée du mot de passe maître via **PBKDF2-SHA256, 600 000 itérations**, sel aléatoire, puis HKDF en deux sous-clés :
  `encKey` (chiffrement, non extractible) et `authKey` (authentification auprès de l'API de sync).
- Le mot de passe maître et les données en clair ne quittent jamais l'appareil. Le serveur ne stocke que le blob chiffré + `sha256(authKey)`.
- Verrouillage auto après inactivité, presse-papiers effacé automatiquement, clés uniquement en mémoire.
- CSP stricte (`default-src 'none'`, aucun script/style tiers, polices auto-hébergées), HSTS, `frame-ancestors 'none'`, `noindex`.
- API : comparaison en temps constant, rate-limit (10 échecs / 15 min / IP), contrôle de version optimiste (409 sur conflit).
- **Pas de récupération possible** si tu perds le mot de passe maître. Exporte régulièrement une sauvegarde chiffrée.

## Fonctionnalités

Entrées par catégories (identifiants, banque, crypto, Wi‑Fi, notes sécurisées…), favoris, recherche (`Ctrl/⌘+K`),
générateur de mots de passe (CSPRNG sans biais), jauge de robustesse, codes 2FA TOTP intégrés,
export/import de sauvegarde chiffrée, changement de mot de passe maître, synchronisation multi-appareils optionnelle,
verrouillage `Ctrl/⌘+Maj+L`.

## Développement

```bash
npm install
npm run dev        # http://localhost:5173 (mode local uniquement, l'API /api n'est servie que via `vercel dev`)
npm test           # crypto, TOTP (vecteurs RFC 6238), merge, API
npm run build
```

## Déploiement sur Vercel

1. Importe le repo GitHub dans Vercel (framework détecté : Vite). Déploie. L'app fonctionne déjà en **mode local** (coffre chiffré dans le navigateur).
2. Sync multi-appareils (optionnel) :
   - Vercel → Storage / Marketplace → **Upstash Redis** (offre gratuite) → connecte-le au projet. Les variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` sont injectées.
   - Ajoute `KPP_SETUP_TOKEN` (ex. `openssl rand -base64 32`) dans Settings → Environment Variables, puis redéploie.
   - Dans l'app : Réglages → Synchronisation → mot de passe maître + jeton → Activer.
   - Sur un autre appareil : écran d'accueil → **Depuis le cloud**.
3. Recommandé : protège le déploiement (Vercel Deployment Protection / domaine perso) et active la 2FA sur ton compte Vercel et GitHub.

## Format du coffre

```json
{ "format": "keypassperso", "v": 1, "kdf": { "name": "PBKDF2-SHA256", "iterations": 600000, "salt": "…" },
  "iv": "…", "ct": "…", "rev": 3, "updatedAt": 1761680000000 }
```
