import type { LandingContent } from "@/lib/landing-content";

/**
 * Le site public, en français.
 *
 * Traduit plutôt qu'adapté mot à mot : « culte » pour un service du dimanche,
 * « cellule de maison » pour un home cell, « dîmes et offrandes » — ce sont
 * les mots qu'une assemblée reconnaît. Les affirmations restent vérifiables
 * dans le produit, exactement comme dans la version anglaise, parce que cette
 * page est aussi ce qu'un moteur de recherche lit pour décider si le site
 * décrit quelque chose de réel.
 */
export const fr: LandingContent = {
  hero: {
    eyebrow: "Pour les églises, fraternités et ministères",
    title: "Tout ce dont votre ministère a besoin,",
    titleAccent: "dans une seule application",
    body: "Ne jonglez plus entre carnets, tableurs et groupes WhatsApp. Présence, membres, groupes, classes, dons, finances de l'église et suivi des nouveaux. SMS groupés et e-mails gratuits, rappels qui s'envoient seuls, événements, formulaires, prédications et votre propre page publique — une seule connexion, pensée pour l'Afrique.",
    ctaPrimary: "Commencer gratuitement",
    ctaSecondary: "Voir les tarifs",
    reassurance: "7 premiers dimanches gratuits • Sans carte bancaire • Résiliable à tout moment",
  },

  highlights: [
    { value: "18", label: "Modules, une seule connexion" },
    { value: "7", label: "Dimanches gratuits pour essayer" },
    { value: "₦0", label: "Pour commencer — sans carte" },
    { value: "100%", label: "Vos données, exportables" },
  ],

  painsTitle: "Les tracas quotidiens de la gestion d'un ministère",
  painsIntro:
    "Si l'un de ces points vous parle, vous n'êtes pas seul — et ce n'est pas votre faute.",
  painsOutro: "FlockInsight règle tout cela — en un seul endroit. 👇",

  pains: [
    "« Je n'ai aucune idée du nombre de personnes venues dimanche dernier — ni le mois dernier. »",
    "« Les coordonnées de nos membres sont éparpillées entre carnets, téléphones et trois groupes WhatsApp. »",
    "« Les nouveaux viennent une fois et nous ne les relançons jamais — ils disparaissent. »",
    "« Compter et suivre les dons à la main prend des heures et ne tombe toujours pas juste. »",
    "« Nous oublions les anniversaires, et rappeler le culte à tout le monde est une corvée hebdomadaire. »",
    "« Personne ne peut me dire qui a terminé le cours de fondation sans ouvrir un carnet. »",
  ],

  featuresTitle: "Tout ce qu'il faut pour faire grandir votre ministère",

  features: [
    {
      icon: "attendance",
      title: "La présence en moins d'une minute",
      body: "Saisissez les chiffres du pouce sur votre téléphone, debout au fond de la salle — adultes, adolescents, enfants et nouveaux venus, répartis par sexe si vous le souhaitez. Enregistrer deux fois le même culte le modifie au lieu de le doubler.",
    },
    {
      icon: "members",
      title: "Membres et foyers",
      body: "Un seul annuaire pour toute l'assemblée, avec les familles regroupées par foyer et les enfants rattachés à un tuteur. Importez des centaines de personnes depuis un tableur, ou laissez les membres mettre à jour leurs informations depuis un lien privé.",
    },
    {
      icon: "groups",
      title: "Groupes, ministères et cellules",
      body: "Chorales, accueil, départements, cellules de maison et comités, chacun avec ses responsables et ses titres. Écrivez à l'un d'eux sans déranger le reste de l'église.",
    },
    {
      icon: "training",
      title: "Formations et cours",
      body: "Organisez les cours de fondation, de baptême, prénuptiaux et de formation des responsables. Inscrivez les participants, notez les résultats, et un badge apparaît à côté du nom de ceux qui ont terminé.",
    },
    {
      icon: "giving",
      title: "Dons, projets et promesses",
      body: "Enregistrez dîmes et offrandes selon vos propres catégories. Lancez un fonds de construction avec un objectif, suivez qui a promis quoi, et relancez seulement ceux qui sont réellement en retard.",
    },
    {
      icon: "finance",
      title: "Finances — toute la comptabilité",
      body: "Recettes, dépenses, comptes bancaires et virements, avec des soldes calculés plutôt que saisis. Reliez une catégorie de dons à un fonds et il se remplit de lui-même à partir de ce qui a été donné.",
    },
    {
      icon: "followup",
      title: "Suivi des nouveaux venus",
      body: "Les visiteurs arrivent dans une liste, sont confiés à une personne réelle, et avancent par étapes jusqu'à ce qu'ils rejoignent l'église ou déclinent. Des messages de bienvenue automatiques assurent le premier contact.",
    },
    {
      icon: "comms",
      title: "SMS groupés et e-mails gratuits",
      body: "Touchez tout le monde, un groupe, ou quelques personnes. Votre propre identifiant SMS pour que les messages arrivent au nom de votre église, et des e-mails qui ne coûtent rien, quelle que soit leur longueur.",
    },
    {
      icon: "reminders",
      title: "Des rappels qui s'envoient seuls",
      body: "Chaque culte, chaque semaine, dans votre fuseau horaire, sans que personne n'ait à y penser. Les anniversaires de naissance et de mariage aussi, avec vos propres mots.",
    },
    {
      icon: "forms",
      title: "Formulaires avec un lien à partager",
      body: "Créez une fiche de nouveau venu ou une inscription à un événement, partagez un lien ou un QR code, et les réponses créent les fiches membres et arrivent d'elles-mêmes dans le suivi.",
    },
    {
      icon: "events",
      title: "Événements et programmes",
      body: "Publiez une croisade ou une convention avec son affiche, ses dates et son lieu. Les événements publics apparaissent sur votre page et dans l'annuaire, là où les gens cherchent une église.",
    },
    {
      icon: "media",
      title: "Prédications et médiathèque",
      body: "Déposez prédications, photos, bulletins et documents, et partagez-en n'importe lequel par un lien. L'audio et la vidéo se lisent dans le navigateur — personne n'a besoin de télécharger pour écouter.",
    },
    {
      icon: "devotionals",
      title: "Méditations et infolettres",
      body: "Rédigez une méditation quotidienne ou une infolettre hebdomadaire et envoyez-la par e-mail aux membres et aux abonnés. Programmez une semaine à l'avance. L'e-mail est gratuit et illimité.",
    },
    {
      icon: "public",
      title: "Votre propre page publique",
      body: "Une vraie page sur flockinsight.com/c/votre-eglise, avec les horaires des cultes et les événements tenus à jour automatiquement, parce qu'ils viennent de vos propres registres.",
    },
    {
      icon: "analytics",
      title: "Analyses et tendances",
      body: "La croissance dans le temps, les adultes face aux enfants, un culte comparé à un autre, les nouveaux venus mois par mois. La tendance, pas seulement le chiffre de dimanche dernier.",
    },
    {
      icon: "reports",
      title: "Rapports et export complet",
      body: "N'importe quelle partie de vos données en tableur ou en PDF, ou l'ensemble dans un seul fichier accompagné d'un dictionnaire de données. Ce sont les données de votre église, et vous pouvez toujours les emporter.",
    },
    {
      icon: "branches",
      title: "Antennes et dénominations",
      body: "Reliez vos antennes à un siège et obtenez un rapport unique sur l'ensemble, regroupé par zone. Chaque antenne garde ses registres privés — le siège ne voit que les totaux.",
    },
    {
      icon: "roles",
      title: "Rôles et permissions",
      body: "Laissez le responsable de l'accueil saisir la présence sans voir les dons, et le trésorier tenir les comptes sans ouvrir l'annuaire des membres. Une section à laquelle quelqu'un n'a pas accès n'existe tout simplement pas pour lui.",
    },
  ],

  stepsTitle: "Comment commencer",
  steps: [
    {
      n: 1,
      title: "Créez votre compte",
      body: "Le nom de votre église, le pays et la devise. Environ deux minutes, sans carte.",
    },
    {
      n: 2,
      title: "Ajoutez les cultes et les membres",
      body: "Définissez vos cultes du dimanche et de la semaine, puis importez votre assemblée depuis un tableur.",
    },
    {
      n: 3,
      title: "Enregistrez votre premier dimanche",
      body: "Touchez Enregistrer, saisissez les chiffres, validez. Votre courbe de présence part de là.",
    },
  ],

  builtForTitle: "Pensé pour l'église africaine",
  builtFor: [
    {
      title: "Cela fonctionne sur une connexion lente",
      body: "Les pages qu'un visiteur ou un bénévole ouvre réellement sont conçues pour être légères. Pas de tableaux de bord lourds là où une page simple suffit, et rien de chargé avant que vous puissiez lire la page.",
    },
    {
      title: "Des SMS qui arrivent au nom de votre église",
      body: "Nous nous occupons pour vous de l'enregistrement de l'identifiant auprès des opérateurs, pour que vos messages affichent GraceChapel plutôt qu'un numéro inconnu que l'on ignore.",
    },
    {
      title: "Le naira, et 30 autres devises africaines",
      body: "L'argent est enregistré et présenté dans votre propre devise, pas converti dans celle de quelqu'un d'autre.",
    },
    {
      title: "Les adresses telles qu'on les écrit vraiment",
      body: "Maison, rue, ville, collectivité et région — avec des points de repère sur votre page publique, parce que c'est ainsi que l'on indique réellement le chemin dans une ville nigériane.",
    },
    {
      title: "Fonctionne sur le téléphone dans votre poche",
      body: "Installez-le sur votre écran d'accueil et il s'ouvre comme une application. La présence est conçue pour être saisie debout, d'une seule main.",
    },
    {
      title: "Un prix pour une vraie assemblée",
      body: "Sept dimanches gratuits, aucune carte pour commencer, et une formule qui démarre petit. Rien ici ne suppose le budget d'une église américaine.",
    },
  ],

  audiencesTitle: "Conçu pour",
  audiences: [
    "Églises locales",
    "Groupes universitaires et étudiants",
    "Cellules de maison et groupes de quartier",
    "Ministères et œuvres d'évangélisation",
    "Dénominations à plusieurs antennes",
  ],

  faqTitle: "Questions fréquentes",
  faq: [
    {
      q: "Qu'est-ce que FlockInsight ?",
      a: "FlockInsight est un logiciel de gestion d'église destiné aux églises, fraternités et ministères. Il réunit en un seul endroit la présence, les membres, les groupes, les formations, les dons, les finances de l'église, le suivi des visiteurs, la communication, les événements, les formulaires, les prédications et les rapports, et donne à chaque église une page publique. Il fonctionne dans un navigateur, sur n'importe quel téléphone ou ordinateur.",
    },
    {
      q: "Combien cela coûte-t-il ?",
      a: "Chaque église bénéficie de ses sept premiers dimanches gratuitement, sans carte bancaire. Ensuite, des formules payantes en naira se distinguent principalement par le nombre de membres que vous pouvez gérer. L'e-mail est gratuit et illimité sur toutes les formules ; les SMS sont facturés au message depuis un portefeuille que vous rechargez.",
    },
    {
      q: "Est-ce que cela fonctionne sur un téléphone ?",
      a: "Oui, et c'est conçu d'abord pour le téléphone. Vous pouvez l'installer sur votre écran d'accueil pour qu'il s'ouvre comme une application. La saisie de la présence est pensée pour être faite d'une seule main, debout.",
    },
    {
      q: "Est-ce que cela fonctionne avec une connexion lente ?",
      a: "Oui. Les pages publiques sont volontairement légères et l'application évite de charger quoi que ce soit avant que vous puissiez lire la page. C'est construit pour des églises en données mobiles, pas sur la fibre d'un bureau.",
    },
    {
      q: "Puis-je envoyer des SMS à mes membres ?",
      a: "Oui. Vous demandez une fois un identifiant d'expéditeur pour que les messages arrivent au nom de votre église plutôt que d'un numéro inconnu, et nous nous chargeons de l'enregistrement auprès des opérateurs. Les SMS sont facturés au message depuis votre portefeuille. L'e-mail est gratuit et illimité.",
    },
    {
      q: "Puis-je importer mes registres existants ?",
      a: "Oui. Les membres, l'historique de présence et l'historique des dons peuvent tous être importés depuis un tableur, de sorte qu'une église qui quitte Excel ou un registre papier démarre avec son histoire intacte plutôt qu'à zéro.",
    },
    {
      q: "Qui peut voir quoi ?",
      a: "C'est vous qui décidez. Les rôles contrôlent l'accès module par module : le responsable de l'accueil peut saisir la présence sans voir les dons, et le trésorier tenir les comptes sans ouvrir l'annuaire des membres. Une section pour laquelle quelqu'un n'a pas la permission n'apparaît pas du tout chez lui.",
    },
    {
      q: "Puis-je récupérer mes données ?",
      a: "À tout moment. Chaque partie de vos registres se télécharge en tableur ou en PDF, et un export complet vous donne l'ensemble dans un seul fichier, accompagné d'un dictionnaire de données expliquant comment les fichiers s'articulent. Ce sont les données de votre église.",
    },
    {
      q: "Cela convient-il à une dénomination avec plusieurs antennes ?",
      a: "Oui. Chaque antenne fonctionne comme sa propre église, avec ses registres et son équipe, et peut se rattacher à un siège qui voit les totaux par antenne, regroupés en zones. Le siège ne voit jamais les fiches membres ni les entrées de dons d'une antenne en particulier.",
    },
    {
      q: "Dans quels pays cela fonctionne-t-il ?",
      a: "Partout où il y a une connexion internet, avec la prise en charge de plus de 30 devises africaines. C'est construit en pensant d'abord au Nigeria et au reste de l'Afrique — formats d'adresse, devises et routes SMS sont configurés pour ce contexte en priorité.",
    },
    {
      q: "Les données de mon église sont-elles en sécurité ?",
      a: "Les registres de chaque église sont séparés et accessibles uniquement aux personnes que vous avez invitées. La base de données est sauvegardée chaque jour, chiffrée, et copiée hors du serveur. Personne dans une autre église ne peut voir vos membres, vos dons ou vos messages.",
    },
    {
      q: "Faut-il être technicien pour s'en servir ?",
      a: "Non. Si vous savez utiliser WhatsApp, vous saurez utiliser FlockInsight. Configurer une église prend environ une demi-heure, et des guides pas à pas sont disponibles pour chaque partie, dans l'application.",
    },
  ],

  ctaTitle: "Prêt à commencer ?",
  ctaBody:
    "Sept dimanches gratuits. Sans carte bancaire. Vos données restent les vôtres.",
  footerTagline:
    "Donner aux églises des outils de gestion modernes pour grandir et prospérer.",
};
