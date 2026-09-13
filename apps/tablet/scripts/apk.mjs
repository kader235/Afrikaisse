// Fabrique l'APK de la tablette : build web → cap sync → Gradle → apps/tablet/dist/.
// Usage : npm run apk -w @afrikaisse/tablet   (VITE_AFK_CLOUD_URL pour changer le Cloud par défaut)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tablet = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(tablet, '../..');
const android = join(tablet, 'android');
const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');

// Capacitor 8 compile en Java 21 : le JDK 17 du PATH échoue (« invalid source release: 21 »).
// On prend JAVA_HOME s'il est défini, sinon le JDK embarqué par Android Studio.
const studioJdk = 'C:\\Program Files\\Android\\Android Studio\\jbr';
const javaHome = process.env.JAVA_HOME || (existsSync(studioJdk) ? studioJdk : undefined);

// Electron laisse parfois cette variable dans l'environnement : elle casse les outils Node lancés ensuite.
const env = { ...process.env, ANDROID_HOME: sdk, ...(javaHome && { JAVA_HOME: javaHome }) };
delete env.ELECTRON_RUN_AS_NODE;

const run = (command, cwd) => {
  console.log(`\n> ${command}`);
  execSync(command, { cwd, env, stdio: 'inherit' });
};

run('npm run build -w @afrikaisse/web', root);
run('npx cap sync android', tablet);
if (!existsSync(android)) throw new Error('Projet Android absent : lancer « npx cap add android » dans apps/tablet.');
// Chemin absolu : cmd.exe ne cherche pas toujours l'exécutable dans le dossier courant.
const gradlew = join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(`"${gradlew}" assembleDebug --no-daemon -q`, android);

const out = join(tablet, 'dist');
mkdirSync(out, { recursive: true });
const apk = join(out, 'AfriKaisse-tablette-debug.apk');
copyFileSync(join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), apk);
console.log(`\nAPK : ${apk}`);
