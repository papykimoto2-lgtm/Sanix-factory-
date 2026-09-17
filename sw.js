/* ═══════════════════════════════════════════════════════════════════
   SANIX OpusFab — SERVICE WORKER

   Trois regles, dans cet ordre :

   1. On ne met en cache QUE la coquille et les bibliotheques publiques.
      Aucune reponse de Supabase, aucune requete portant un jeton : les
      donnees d'un utilisateur n'ont rien a faire dans un cache qui
      survit a sa deconnexion et que le suivant pourrait relire.

   2. La coquille est servie depuis le cache, puis rafraichie en fond.
      L'ouverture est immediate ; la version suivante est signalee, pas
      imposee au milieu d'une saisie.

   3. Le nom du cache porte la version. Une nouvelle version efface les
      precedentes a l'activation : personne ne reste bloque sur un
      ancien build.
═══════════════════════════════════════════════════════════════════ */
'use strict';

const VERSION = 'opusfab-2026-09-17';
const COQUILLE = 'coquille-' + VERSION;
const BIBLIO  = 'biblio-'   + VERSION;

/* Bibliotheques publiques, immuables, servies par CDN. */
const CDN = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(COQUILLE)
      .then(function(c){ return c.add(new Request('./', {cache: 'reload'})); })
      .then(function(){ return self.skipWaiting(); })
      .catch(function(){ /* hors ligne a l'installation : on reessaiera */ })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(noms){
      return Promise.all(noms.map(function(n){
        if (n !== COQUILLE && n !== BIBLIO) return caches.delete(n);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* Une requete est mettable en cache seulement si elle ne porte rien de
   personnel : pas de jeton, pas de cookie, et une origine publique. */
function personnelle(req){
  if (req.method !== 'GET') return true;
  if (req.headers.get('Authorization')) return true;
  var u = new URL(req.url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return true;
  if (u.search) return true;                       /* une requete parametree est une lecture de donnees */
  /* Toute navigation porte credentials:'include' : l'exclure sur ce seul
     critere reviendrait a ne jamais servir la coquille hors ligne. Notre
     propre origine ne sert qu'un fichier statique, sans donnee d'utilisateur. */
  if (u.origin === self.location.origin) return false;
  return CDN.indexOf(u.hostname) < 0;              /* tout le reste, dont Supabase : jamais */
}

function estCoquille(req){
  if (req.mode === 'navigate') return true;
  var u = new URL(req.url);
  return u.origin === self.location.origin && (u.pathname === '/' || u.pathname.endsWith('/index.html'));
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (personnelle(req)) return;                    /* on laisse passer, sans jamais rien garder */

  if (estCoquille(req)) {
    /* Cache d'abord pour l'ouverture, reseau en fond pour la suite. */
    e.respondWith(
      caches.open(COQUILLE).then(function(c){
        return c.match('./').then(function(cache){
          var frais = fetch(req).then(function(res){
            if (res && res.ok) {
              c.put('./', res.clone());
              if (cache) prevenir(cache, res.clone());
            }
            return res;
          }).catch(function(){ return cache; });
          return cache || frais;
        });
      })
    );
    return;
  }

  /* Bibliotheques : immuables, donc cache d'abord sans revalidation. */
  e.respondWith(
    caches.open(BIBLIO).then(function(c){
      return c.match(req).then(function(cache){
        if (cache) return cache;
        return fetch(req).then(function(res){
          if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
          return res;
        });
      });
    })
  );
});

/* Comparer les deux versions plutot que d'annoncer une mise a jour a
   chaque ouverture : le reseau renvoie souvent un contenu identique. */
function prevenir(ancienne, nouvelle){
  Promise.all([ancienne.text(), nouvelle.text()]).then(function(t){
    if (t[0] === t[1]) return;
    return self.clients.matchAll({type: 'window'}).then(function(cl){
      cl.forEach(function(c){ c.postMessage({type: 'sf-version-disponible'}); });
    });
  }).catch(function(){});
}

self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'sf-activer-maintenant') self.skipWaiting();
});
