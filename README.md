# KeyPassPerso

Gestionnaire de mots de passe personnel, zero-knowledge, déployable sur Vercel.

## Sécurité

- Chiffrement **AES-256-GCM** dans le navigateur (WebCrypto, aucune lib crypto tierce).
- Clé dérivée du mot de passe maître via **PBKDF2-SHA256, 600 000 itérations**, sel aléatoire, puis HKDF en deux sous-clés :
  `encKey` (chiffrement, non extractible) et `authKey` (authentification auprès de l'API).
- **2FA obligatoire (TOTP)** : ouvrir le coffre exige le mot de passe maître **et** un code à 6 chiffres
  (ou un des 10 codes de secours à usage unique). Anti-rejeu, verrouillage 15 min après 5 codes faux.
- Le secret TOTP est stocké scellé sous une clé dérivée de `authKey` : une fuite du store Blob seule ne le révèle pas.
- Sessions : 12 h par onglet, ou 30 jours si « faire confiance à cet appareil ». Révocables à tout moment ;
  un changement de mot de passe maître invalide toutes les sessions des autres appareils.
- Le serveur ne voit jamais le mot de passe maître ni les données en clair : il stocke le blob chiffré + `sha256(authKey)`.
- Stockage : **Vercel Blob privé**, écriture atomique par ETag, **historique des 30 dernières versions**.
- Verrouillage auto après inactivité, presse-papiers effacé automatiquement, clés uniquement en mémoire.
- CSP stricte (`default-src 'none'`, aucun script/style tiers, polices auto-hébergées), HSTS, `frame-ancestors 'none'`, `noindex`.
- **Pas de récupération possible** si tu perds le mot de passe maître. La sauvegarde exportée s'ouvre avec le mot de passe seul
  (pas de 2FA) : garde-la hors ligne.

## Fonctionnalités

Entrées par catégories (identifiants, banque, crypto, Wi‑Fi, notes sécurisées…), favoris, recherche (`Ctrl/⌘+K`),
générateur de mots de passe (CSPRNG sans biais), jauge de robustesse, codes 2FA TOTP des sites intégrés,
historique et restauration de versions, export/import de sauvegarde chiffrée, changement de mot de passe maître,
gestion 2FA (nouvelle application, nouveaux codes de secours, déconnexion de tous les appareils), verrouillage `Ctrl/⌘+Maj+L`.

## Développement

```bash
npm install
npm run dev        # UI seule ; l'API /api nécessite `vercel dev` (store Blob lié)
npm test           # crypto, TOTP (vecteurs RFC 6238), merge, API
npm run build
```

## Déploiement sur Vercel

1. Importe le repo dans Vercel (framework détecté : Vite).
2. Projet → **Storage** → Create → **Blob**, accès **Private**, région Paris (`cdg1`) → Connect au projet
   (`BLOB_STORE_ID` est injecté, auth OIDC).
3. Settings → Environment Variables : `KPP_SETUP_TOKEN` (ex. `openssl rand -base64 32`), puis redéploie.
4. Ouvre le site : mot de passe maître + jeton → scan du QR code 2FA → sauvegarde des codes de secours.
5. Autres appareils : même URL → mot de passe maître → code 2FA.
6. Recommandé : Firewall → *Rate limit* sur `/api/vault`, 30 requêtes / 60 s / IP → Deny.

## Format du coffre

```json
{ "format": "keypassperso", "v": 1, "kdf": { "name": "PBKDF2-SHA256", "iterations": 600000, "salt": "…" },
  "iv": "…", "ct": "…", "rev": 3, "updatedAt": 1761680000000 }
```
