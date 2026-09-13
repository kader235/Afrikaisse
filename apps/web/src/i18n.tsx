import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Français de référence ; anglais et arabe (RTL) branchés dès la phase 1 pour
 * que chaque écran soit construit en propriétés CSS logiques.
 * Les messages d'erreur métier viennent encore de l'API en français.
 */
const fr = {
  'app.tagline': 'La caisse intelligente de la restauration africaine.',
  'auth.login.title': 'Connexion',
  'auth.login.subtitle': 'Accédez à votre restaurant.',
  'auth.email': 'Adresse e-mail',
  'auth.password': 'Mot de passe',
  'auth.login.submit': 'Se connecter',
  'auth.noAccount': 'Pas encore de compte ?',
  'auth.createRestaurant': 'Créer mon restaurant',
  'auth.haveAccount': 'Déjà un compte ?',
  'auth.register.title': 'Créer mon restaurant',
  'auth.register.subtitle': 'Votre organisation, votre premier établissement et votre compte propriétaire.',
  'auth.organizationName': "Nom de l'organisation",
  'auth.organizationHint': 'Ex. « Groupe ABC » ou le nom du restaurant.',
  'auth.locationName': 'Premier établissement',
  'auth.locationType': "Type d'établissement",
  'auth.country': 'Pays',
  'auth.currency': 'Devise',
  'auth.ownerName': 'Votre nom',
  'auth.passwordHint': 'Au moins 10 caractères.',
  'auth.register.submit': 'Créer mon restaurant',
  'common.loading': 'Chargement…',
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.retry': 'Réessayer',
  'common.logout': 'Se déconnecter',
  'common.all': 'Tous',
  'common.saved': 'Enregistré.',
  'nav.organization': 'Organisation',
  'nav.team': 'Équipe',
  'nav.audit': 'Journal',
  'nav.account': 'Mon compte',
  'nav.platform': 'Plateforme',
  'shell.switchOrg': "Changer d'organisation",
  'shell.theme': 'Thème',
  'shell.language': 'Langue',
  'org.title': 'Organisation',
  'org.plan': 'Offre',
  'org.demo': 'Démonstration',
  'org.locations': 'Établissements',
  'org.rename': 'Renommer',
  'org.timezone': 'Fuseau horaire',
  'team.title': 'Équipe',
  'team.subtitle': "Les personnes qui travaillent dans l'organisation et ce qu'elles peuvent faire.",
  'team.add': 'Ajouter un membre',
  'team.name': 'Nom',
  'team.role': 'Rôle',
  'team.location': 'Établissement',
  'team.status': 'Statut',
  'team.active': 'Actif',
  'team.disabled': 'Désactivé',
  'team.disable': 'Désactiver',
  'team.enable': 'Réactiver',
  'team.resetPassword': 'Nouveau mot de passe',
  'team.shared': 'Compte partagé',
  'team.sharedHint': 'Ce compte appartient aussi à une autre organisation : seul son titulaire gère son mot de passe.',
  'team.you': 'vous',
  'team.initialPassword': 'Mot de passe initial',
  'team.existingAccountHint': "Si l'adresse a déjà un compte AfriKaisse, le mot de passe est ignoré.",
  'team.passwordSet': 'Mot de passe modifié. La personne a été déconnectée de ses appareils.',
  'audit.title': "Journal d'audit",
  'audit.subtitle': 'Qui a fait quoi, et quand. Non modifiable.',
  'audit.empty': 'Aucune entrée.',
  'audit.more': 'Afficher plus',
  'audit.system': 'Système',
  'account.title': 'Mon compte',
  'account.currentPassword': 'Mot de passe actuel',
  'account.newPassword': 'Nouveau mot de passe',
  'account.changePassword': 'Changer le mot de passe',
  'account.passwordChanged': 'Mot de passe changé. Vos autres appareils ont été déconnectés.',
  'platform.title': 'Organisations clientes',
  'platform.members': 'Membres',
  'platform.createdAt': 'Créée le',
  'platform.suspend': 'Suspendre',
  'platform.reactivate': 'Réactiver',
  'platform.suspended': 'Suspendue',
  'blocked.SUSPENDED': 'Cette organisation est suspendue. Contactez AfriKaisse pour la réactiver.',
  'blocked.DISABLED': "Votre accès à cette organisation a été désactivé par un responsable.",
  'blocked.REVOKED': "Vous n'avez plus accès à cette organisation.",
  'choose.title': 'Choisissez une organisation',
  'offline.title': 'Serveur injoignable',
  'offline.body': 'Impossible de joindre AfriKaisse. Vérifiez la connexion puis réessayez.',
  'theme.light': 'Clair',
  'theme.dark': 'Sombre',
  'theme.system': 'Système',
  'app.product': 'Gestion de restaurant',
  'common.close': 'Fermer',
  'common.refresh': 'Actualiser',
  'common.edit': 'Modifier',
  'common.confirm': 'Confirmer',
  'auth.groupOrganization': 'Organisation',
  'auth.groupLocation': 'Premier établissement',
  'auth.groupOwner': 'Compte propriétaire',
  'team.count': 'membre(s)',
  'team.editTitle': 'Modifier le membre',
  'team.passwordTitle': 'Nouveau mot de passe',
  'team.disableConfirm': 'La personne perdra immédiatement l’accès à l’organisation sur tous ses appareils.',
  'team.createdAt': 'Ajouté le',
  'org.status': 'Statut',
  'org.createdAt': 'Créée le',
  'org.renameTitle': "Renommer l'organisation",
  'audit.date': 'Date',
  'audit.action': 'Action',
  'audit.user': 'Utilisateur',
  'audit.detail': 'Détail',
  'audit.ip': 'Adresse IP',
  'platform.status': 'Statut',
  'platform.active': 'Active',
  'status.cloud': 'Serveur Cloud',
  'status.local': 'Serveur local',
  'status.connected': 'Connecté',
  'status.offline': 'Hors ligne',
  'status.version': 'Version',
  'nav.locations': 'Établissements',
  'nav.floor': 'Plan de salle',
  'loc.title': 'Établissements',
  'loc.count': 'établissement(s)',
  'loc.add': 'Nouvel établissement',
  'loc.editTitle': "Modifier l'établissement",
  'loc.archive': 'Archiver',
  'loc.restore': 'Réactiver',
  'loc.showArchived': 'Afficher les archivés',
  'loc.archived': 'Archivé',
  'loc.archiveConfirm': "L'établissement disparaîtra des écrans de travail. Son historique est conservé et il pourra être réactivé.",
  'loc.groupIdentity': 'Identité',
  'loc.groupPlace': 'Localisation',
  'loc.groupOperation': 'Exploitation',
  'loc.address': 'Adresse',
  'loc.phone': 'Téléphone',
  'loc.cutoff': 'Début de journée',
  'loc.cutoffHint': "Les ventes réalisées avant cette heure comptent pour la veille (service de nuit).",
  'loc.mode': "Mode d'exploitation",
  'loc.modeHint': "Serveur local : le restaurant continue de travailler sans Internet. Nécessite le PC du restaurant.",
  'floor.title': 'Plan de salle',
  'floor.addZone': 'Nouvelle zone',
  'floor.editZone': 'Modifier la zone',
  'floor.archiveZone': 'Archiver la zone',
  'floor.addTable': 'Nouvelle table',
  'floor.editTable': 'Modifier la table',
  'floor.archiveTable': 'Archiver la table',
  'floor.arrange': 'Disposer',
  'floor.rotate': 'Pivoter',
  'floor.saveLayout': 'Enregistrer le plan',
  'floor.layoutSaved': 'Plan enregistré.',
  'floor.noLocation': 'Aucun établissement actif.',
  'floor.noZone': 'Aucune zone pour cet établissement. Commencez par créer une zone : Salle, Terrasse, VIP…',
  'floor.noZoneReadOnly': "Aucune zone n'a encore été définie pour cet établissement.",
  'floor.tables': 'Tables',
  'floor.seats': 'Places',
  'floor.planSize': 'Taille du plan',
  'floor.table': 'Table',
  'floor.label': 'Libellé',
  'floor.capacity': 'Nombre de places',
  'floor.shape': 'Forme',
  'floor.position': 'Position',
  'floor.zone': 'Zone',
  'floor.zoneName': 'Nom de la zone',
  'floor.planWidth': 'Largeur (cases)',
  'floor.planHeight': 'Hauteur (cases)',
  'floor.planHint': 'Une table de 2 à 4 personnes occupe 2 × 2 cases.',
  'floor.seatsShort': 'pl.',
  'floor.hintSelect': 'Touchez une table pour afficher sa fiche.',
  'floor.hintArrange': 'Faites glisser les tables au doigt, ou touchez-en une et utilisez les flèches.',
  'floor.conflicts': 'À corriger avant d’enregistrer',
  'floor.unsaved': 'Modifications non enregistrées',
  'floor.archiveTableConfirm': 'La table disparaîtra du plan. Son libellé pourra être réutilisé.',
  'floor.archiveZoneConfirm': 'La zone disparaîtra du plan. Elle doit être vide.',
};
export type MessageKey = keyof typeof fr;
type Dictionary = Partial<Record<MessageKey, string>>;

const en: Dictionary = {
  'app.tagline': 'The smart till for African restaurants.',
  'auth.login.title': 'Sign in',
  'auth.login.subtitle': 'Access your restaurant.',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.login.submit': 'Sign in',
  'auth.noAccount': 'No account yet?',
  'auth.createRestaurant': 'Create my restaurant',
  'auth.haveAccount': 'Already have an account?',
  'auth.register.title': 'Create my restaurant',
  'auth.register.subtitle': 'Your organization, your first location and your owner account.',
  'auth.organizationName': 'Organization name',
  'auth.organizationHint': 'E.g. “ABC Group” or the restaurant name.',
  'auth.locationName': 'First location',
  'auth.locationType': 'Location type',
  'auth.country': 'Country',
  'auth.currency': 'Currency',
  'auth.ownerName': 'Your name',
  'auth.passwordHint': 'At least 10 characters.',
  'auth.register.submit': 'Create my restaurant',
  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.logout': 'Sign out',
  'common.all': 'All',
  'common.saved': 'Saved.',
  'nav.organization': 'Organization',
  'nav.team': 'Team',
  'nav.audit': 'Audit log',
  'nav.account': 'My account',
  'nav.platform': 'Platform',
  'shell.switchOrg': 'Switch organization',
  'team.title': 'Team',
  'team.add': 'Add member',
  'team.name': 'Name',
  'team.role': 'Role',
  'team.location': 'Location',
  'team.status': 'Status',
  'team.active': 'Active',
  'team.disabled': 'Disabled',
  'audit.title': 'Audit log',
  'account.title': 'My account',
  'platform.title': 'Client organizations',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',
  'app.product': 'Restaurant management',
  'common.close': 'Close',
  'common.refresh': 'Refresh',
  'common.edit': 'Edit',
  'common.confirm': 'Confirm',
  'status.cloud': 'Cloud server',
  'status.local': 'Local server',
  'status.connected': 'Connected',
  'status.offline': 'Offline',
  'status.version': 'Version',
};

const ar: Dictionary = {
  'app.tagline': 'الصندوق الذكي للمطاعم الأفريقية.',
  'auth.login.title': 'تسجيل الدخول',
  'auth.login.subtitle': 'ادخل إلى مطعمك.',
  'auth.email': 'البريد الإلكتروني',
  'auth.password': 'كلمة المرور',
  'auth.login.submit': 'دخول',
  'auth.noAccount': 'ليس لديك حساب؟',
  'auth.createRestaurant': 'إنشاء مطعمي',
  'auth.haveAccount': 'لديك حساب؟',
  'auth.register.title': 'إنشاء مطعمي',
  'auth.organizationName': 'اسم المؤسسة',
  'auth.locationName': 'الفرع الأول',
  'auth.locationType': 'نوع المنشأة',
  'auth.country': 'البلد',
  'auth.currency': 'العملة',
  'auth.ownerName': 'اسمك',
  'auth.register.submit': 'إنشاء مطعمي',
  'common.loading': 'جارٍ التحميل…',
  'common.save': 'حفظ',
  'common.cancel': 'إلغاء',
  'common.retry': 'إعادة المحاولة',
  'common.logout': 'تسجيل الخروج',
  'common.all': 'الكل',
  'nav.organization': 'المؤسسة',
  'nav.team': 'الفريق',
  'nav.audit': 'السجل',
  'nav.account': 'حسابي',
  'nav.platform': 'المنصة',
  'team.title': 'الفريق',
  'team.add': 'إضافة عضو',
  'team.name': 'الاسم',
  'team.role': 'الدور',
  'team.location': 'الفرع',
  'team.status': 'الحالة',
  'team.active': 'نشط',
  'team.disabled': 'معطّل',
  'audit.title': 'سجل التدقيق',
  'account.title': 'حسابي',
  'theme.light': 'فاتح',
  'theme.dark': 'داكن',
  'theme.system': 'النظام',
};

export const LANGUAGES = { fr: 'Français', en: 'English', ar: 'العربية' } as const;
export type Language = keyof typeof LANGUAGES;
const DICTIONARIES: Record<Language, Dictionary> = { fr, en, ar };

interface I18n {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: MessageKey) => string;
  locale: string;
}

const Ctx = createContext<I18n | null>(null);

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const stored = readStored('afk.lang');
    return stored && stored in LANGUAGES ? (stored as Language) : 'fr';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    try {
      localStorage.setItem('afk.lang', l);
    } catch {
      /* stockage indisponible : la langue vaut pour la session */
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key) => DICTIONARIES[lang][key] ?? fr[key],
      locale: lang === 'ar' ? 'ar-TD' : lang === 'en' ? 'en-GB' : 'fr-FR',
    }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider manquant');
  return v;
}
