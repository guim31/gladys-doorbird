# DoorBird

Intègre vos **portiers vidéo DoorBird** (D10x, D11x, D21x, D2101V…) à Gladys, **en local**, par leur API LAN
officielle : l'image de la caméra, les coups de sonnette, le détecteur de mouvement, l'éclairage infrarouge
et — seulement si vous l'autorisez — l'ouverture de la porte depuis une scène. Rien ne passe par un cloud.

> Developed without the hardware: feedback welcome. Développée sans le matériel : vos retours sont les
> bienvenus, ce qui marche comme ce qui ne marche pas, sur
> [GitHub](https://github.com/guim31/gladys-doorbird/issues).
>
> Cette intégration n'est pas affiliée à Bird Home Automation (DoorBird).

## Prérequis

- Gladys 5.1.0 ou plus récent.
- Un portier DoorBird sur le même réseau que Gladys, avec une adresse fixe (à régler dans votre box).
- L'app DoorBird, avec les identifiants administrateur du portier (sur le « Digital Passport » livré avec),
  pour créer un utilisateur pour Gladys.

## Créer un utilisateur DoorBird dédié

Gladys ne doit pas utiliser le compte administrateur. Dans l'app DoorBird : **Réglages → Administration**,
connectez-vous avec les identifiants administrateur, puis **Utilisateur** → **+**. L'app donne au nouvel
utilisateur un nom du type `abcdef0001` et un mot de passe : notez-les. Ne lui donnez que ce dont Gladys a
besoin :

- **Watch always** (vue en direct à tout moment) : l'image de la caméra à tout moment et l'éclairage
  infrarouge. Sans ce droit, le DoorBird n'ouvre son image que 5 minutes après un coup de sonnette.
- Les **relais** que l'ouverture de porte pourra utiliser, et seulement si vous l'autorisez dans Gladys (voir
  plus bas).
- Rien d'autre : Gladys n'a besoin ni d'« API-Operator », ni de l'historique, ni des favoris.

Vérifiez aussi que le **détecteur de mouvement** est activé sur le DoorBird (Administration → Détecteur de
mouvement), sinon aucun mouvement n'est signalé. Le nom des droits peut varier selon la version et la langue
de l'app.

## Configuration

Dans Gladys : **Intégrations → DoorBird → Configuration**.

- **Adresse du DoorBird** : l'adresse IP du portier, ex. `192.168.1.50` (avec `:port` si ce n'est pas 80,
  `https://` pour HTTPS).
- **Utilisateur DoorBird** et **Mot de passe** : l'utilisateur créé plus haut. Le mot de passe n'est envoyé
  qu'au DoorBird. Après un refus, l'intégration ne réessaie plus (elle n'insiste jamais) tant que vous ne
  l'avez pas corrigé ou pressé « Tester la connexion ».
- **Second DoorBird** (facultatif) : **Son adresse**, **Son utilisateur** et **Son mot de passe**, pour un
  portail ou une porte arrière.
- **Image du DoorBird** : fréquence de rafraîchissement de l'image de chaque DoorBird (seulement sur
  événement, chaque minute, toutes les 5 minutes — par défaut —, toutes les 15 minutes ou toutes les heures).
  Une sonnerie ou un mouvement en prend toujours une neuve.
- **Autoriser l'ouverture de porte** : désactivé par défaut. Voir « Ouvrir la porte (relais DoorBird) »
  plus bas.
- **Langue des noms** : langue des noms de fonctionnalités (français par défaut) et des textes envoyés aux
  scènes. Les noms sont fixés à l'ajout de l'appareil : changez la langue avant de l'ajouter.

Ouvrez ensuite l'onglet **Découverte** et ajoutez le DoorBird à Gladys.

## L'appareil DoorBird

Un appareil par DoorBird, nommé d'après son modèle (par exemple « DoorBird D2101V »), avec ces
fonctionnalités :

| Fonctionnalité           | Type                   | Ce qu'elle fait                                                                                |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| **Image**                | caméra                 | L'image de la caméra, rafraîchie à l'intervalle choisi, à chaque sonnerie et chaque mouvement. |
| **En ligne**             | entrée                 | 1 tant que le DoorBird répond, 0 quand il est injoignable.                                     |
| **Sonnette**             | sonnette               | 1 quand quelqu'un sonne, de retour à 0 dix secondes plus tard.                                 |
| **Mouvement**            | détecteur de mouvement | 1 tant que le détecteur du DoorBird signale un mouvement.                                      |
| **Éclairage infrarouge** | lumière                | Allume l'éclairage infrarouge. Il s'éteint seul après 3 minutes environ.                       |

L'éclairage infrarouge ne s'éteint pas sur commande : le DoorBird ne le propose pas, et l'intégration le dit
plutôt que de faire semblant. La porte n'est **jamais** une fonctionnalité de l'appareil : aucun
interrupteur, aucun assistant vocal, aucun bouton du tableau de bord ne peut l'ouvrir.

## Widget du tableau de bord

Le widget **DoorBird** affiche, pour tous les DoorBird ou celui choisi dans ses réglages (« DoorBird
(vide : tous) ») :

- le nombre de sonneries et de mouvements des dernières 24 heures ;
- les dernières sonneries et derniers mouvements, du plus récent au plus ancien, chacun avec l'image prise à
  ce moment ;
- l'état en ligne de chaque DoorBird ;
- avec un seul DoorBird ajouté à Gladys, un bouton **Éclairage infrarouge**.

La liste est gardée en mémoire : elle repart vide au redémarrage de l'intégration.

## Déclencheurs de scène

- **Quelqu'un sonne au DoorBird** : un coup de sonnette. Filtre : le DoorBird (vide : n'importe lequel).
  Variable : **Nom du DoorBird**.
- **Mouvement devant le DoorBird** : le début d'un mouvement. Filtre : le DoorBird. Variable : **Nom du
  DoorBird**.

L'image du DoorBird est rafraîchie avant le déclenchement : une action « envoyer l'image de la caméra » dans
la même scène envoie le visiteur. Un déclenchement par DoorBird toutes les 15 secondes au plus (un appui
long, une personne qui s'attarde devant la caméra comptent une fois).

## Actions de scène

- **Rafraîchir l'image du DoorBird** : prend une image neuve maintenant, à envoyer ensuite dans un message.
- **Ouvrir la porte (relais DoorBird)** : active un **Relais** du DoorBird (gâche, portail) : `1` ou `2`
  pour les relais du DoorBird, `abcdef@1` pour un relais d'un contrôleur de porte associé (« Tester la
  connexion » les liste). Ne fonctionne qu'une fois **Autoriser l'ouverture de porte** coché. Seul un relais
  que le DoorBird liste est accepté, et la commande est envoyée une fois, jamais répétée.

> **Attention.** Une scène qui ouvre une porte l'ouvre à qui se trouve devant. Ne la liez jamais à un
> déclencheur que n'importe qui dehors peut provoquer (une sonnerie, un mouvement) : utilisez-la avec une
> condition que vous seul maîtrisez (une confirmation, votre présence à la maison). Ne donnez à l'utilisateur
> de Gladys que les relais nécessaires.

## Actions de configuration

- **Tester la connexion** : relit chaque DoorBird et indique son modèle, son firmware et ses relais, et si
  son utilisateur peut prendre une image. Relance aussi un DoorBird arrêté après un mot de passe refusé.
- **Afficher l'adresse du flux vidéo** : l'adresse RTSP d'un DoorBird
  (`rtsp://utilisateur:PASSWORD@adresse:554/mpeg/media.amp`), pour ajouter la vidéo en direct à
  l'intégration « Caméra RTSP » de Gladys. Remplacez `PASSWORD` vous-même : l'intégration ne l'affiche jamais.

## Exemples de scènes

- **Quelqu'un sonne → photo sur le téléphone** : déclencheur « Quelqu'un sonne au DoorBird », action
  « envoyer un message avec l'image de la caméra » (l'image du DoorBird).
- **Mouvement la nuit → lumière du perron** : déclencheur « Mouvement devant le DoorBird », condition « après
  le coucher du soleil », action « allumer la lumière du perron 5 minutes ».
- **Mouvement en votre absence → alerte** : déclencheur « Mouvement devant le DoorBird », condition
  « personne à la maison », actions « Rafraîchir l'image du DoorBird » puis « envoyer un message avec l'image
  de la caméra ».

## Fonctionnement

- **Événements** : l'intégration garde une connexion ouverte sur le flux d'événements du DoorBird
  (`monitor.cgi`) : sonneries et mouvements arrivent en moins d'une seconde. Le DoorBird répète son état
  toutes les 20 secondes environ ; une connexion muette depuis une minute est rouverte.
- **Pourquoi pas les favoris DoorBird** : un DoorBird peut aussi appeler une adresse HTTP à chaque événement,
  mais le bac à sable de Gladys n'accepte aucune connexion entrante. Le flux d'événements est une connexion
  sortante, la voie fiable ici. L'historique cloud du DoorBird n'est pas utilisé.
- **Charge sur le DoorBird** (son API LAN n'a pas de quota publié, l'intégration reste légère) : la connexion
  d'événements, `info.cgi` toutes les 5 minutes (chaque minute tant que le flux d'événements est coupé), une
  image à l'intervalle choisi et à chaque événement (12 images par minute et par DoorBird au plus, la limite de
  Gladys), deux requêtes à la fois au plus. Les états ne partent vers Gladys que s'ils changent, et toutes les
  6 heures sinon.

## Dépannage

- **« Nom d'utilisateur ou mot de passe refusé »** : vérifiez l'utilisateur (pas l'administrateur) et son mot
  de passe, puis pressez **Tester la connexion**. L'intégration s'arrête au premier refus et n'insiste jamais.
- **« Cet utilisateur DoorBird n'a pas ce droit »** : donnez à l'utilisateur « Watch always » (image,
  infrarouge) ou le relais (porte) dans l'app DoorBird.
- **Pas d'image entre deux sonneries** : même cause, « Watch always » manque.
- **Aucun mouvement** : activez le détecteur de mouvement du DoorBird et vérifiez sa zone de détection.
- **« Pas d'API LAN DoorBird à cette adresse »** : mauvaise adresse, ou un appareil sans l'API LAN.
- **Détails** : les logs de l'intégration (Intégrations → DoorBird) disent quand un DoorBird est perdu puis
  retrouvé. Pour tout le reste, réglez `LOG_LEVEL=debug`.

## Limites

- Développée sans le matériel : les réponses viennent du code publié de DoorBirdPy, Home Assistant,
  Homebridge et openHAB. Vos retours sont les bienvenus.
- **Badges RFID et codes du clavier ne remontent pas** : le flux d'événements de l'API LAN ne porte que la
  sonnette et le détecteur de mouvement ; les autres événements passent par les favoris DoorBird (une
  connexion entrante, impossible dans le bac à sable).
- La vidéo en direct n'est pas dans cette intégration : utilisez l'adresse RTSP dans l'intégration « Caméra
  RTSP ».
- Pas d'audio bidirectionnel, pas de SIP, pas d'historique DoorBird (cloud).
- Deux DoorBird au plus. Un contrôleur de porte (A1081) s'utilise par les relais de son DoorBird associé.
- L'éclairage infrarouge ne s'éteint pas sur commande ; ses 3 minutes sont celles du DoorBird.
- Une sonnerie ou un mouvement survenu pendant que l'intégration est arrêtée n'est pas rattrapé.
