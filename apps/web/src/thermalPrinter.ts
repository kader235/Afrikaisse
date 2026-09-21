import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './platform.ts';

/**
 * Impression thermique universelle, côté tablette (APK). Le plugin natif `ThermalPrinter`
 * (voir apps/tablet/android/.../ThermalPrinter.java) envoie des octets ESC/POS déjà fabriqués
 * par le serveur à n'importe quelle imprimante ESC/POS — en Bluetooth, en Wi-Fi/réseau (TCP) ou
 * en câble USB.
 *
 * Rien ici ne reconstruit un ticket : le format (accents, largeur 58/80 mm, coupe) reste décidé
 * par le serveur. On ne fait que transmettre les octets.
 *
 * La version web (navigateur) n'a pas ce plugin : `thermalPrinterSupported()` renvoie false, et
 * l'impression y reste assurée par le serveur local (PC) ou la boîte d'impression du navigateur.
 */

export type PrinterTransport = 'bluetooth' | 'tcp' | 'usb';

export interface BluetoothPrinterDevice {
  name: string | null;
  address: string;
}

export interface UsbPrinterDevice {
  name: string | null;
  deviceId: number;
  hasPermission: boolean;
}

export interface PrintRawOptions {
  transport: PrinterTransport;
  /** Octets ESC/POS en base64, tels que le serveur les a mis dans la file d'impression. */
  data: string;
  /** Bluetooth : adresse de l'imprimante appairée (ex. DC:0D:30:AA:BB:CC). */
  address?: string;
  /** TCP/Wi-Fi : adresse IP ou nom de l'imprimante. */
  host?: string;
  /** TCP/Wi-Fi : port ESC/POS (9100 par défaut). */
  port?: number;
  /** USB : identifiant de l'appareil ; absent, la première imprimante branchée. */
  deviceId?: number;
  /** TCP/Wi-Fi : délai de connexion en millisecondes (5000 par défaut). */
  timeout?: number;
}

interface ThermalPrinterPlugin {
  listBluetoothDevices(): Promise<{ devices: BluetoothPrinterDevice[] }>;
  listUsbDevices(): Promise<{ devices: UsbPrinterDevice[] }>;
  printRaw(options: PrintRawOptions): Promise<{ ok: boolean }>;
}

const ThermalPrinter = registerPlugin<ThermalPrinterPlugin>('ThermalPrinter');

/** Vrai seulement dans l'APK : le plugin natif d'impression n'existe pas dans le navigateur. */
export function thermalPrinterSupported(): boolean {
  return isNativeApp();
}

export async function listBluetoothPrinters(): Promise<BluetoothPrinterDevice[]> {
  return (await ThermalPrinter.listBluetoothDevices()).devices;
}

export async function listUsbPrinters(): Promise<UsbPrinterDevice[]> {
  return (await ThermalPrinter.listUsbDevices()).devices;
}

/** Envoie les octets ESC/POS à l'imprimante. Rejette avec un message clair si l'envoi échoue. */
export async function printRaw(options: PrintRawOptions): Promise<void> {
  await ThermalPrinter.printRaw(options);
}
