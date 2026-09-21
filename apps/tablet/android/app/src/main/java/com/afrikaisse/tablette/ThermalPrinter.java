package com.afrikaisse.tablette;

import android.Manifest;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.dantsu.escposprinter.connection.DeviceConnection;
import com.dantsu.escposprinter.connection.bluetooth.BluetoothConnection;
import com.dantsu.escposprinter.connection.tcp.TcpConnection;
import com.dantsu.escposprinter.connection.usb.UsbConnection;

import java.util.Map;

/**
 * Impression thermique universelle depuis la tablette, sur n'importe quelle imprimante ESC/POS,
 * qu'elle soit branchée en <b>Bluetooth</b>, en <b>Wi-Fi/réseau (TCP 9100)</b> ou en <b>câble USB</b>.
 *
 * <p>La tablette reçoit du serveur les octets ESC/POS <i>déjà fabriqués</i> (base64) ; ce plugin ne
 * fait que les <b>transmettre</b> par la liaison choisie, via la librairie DantSu (MIT). Aucun ticket
 * n'est reconstruit ici : le format (accents, largeur 58/80 mm, coupe) reste décidé côté serveur.
 *
 * <p>Ce plugin n'existe que dans l'APK. La version web (navigateur) n'a pas d'accès natif : elle
 * garde l'impression par le serveur local (PC) ou la boîte d'impression du navigateur.
 */
@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = {
        // Android 12+ : se connecter à une imprimante appairée exige BLUETOOTH_CONNECT à l'exécution.
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class ThermalPrinter extends Plugin {

    private static final String ACTION_USB_PERMISSION = "com.afrikaisse.tablette.USB_PERMISSION";

    // --- Liste des imprimantes joignables ---------------------------------------

    /** Imprimantes Bluetooth déjà appairées dans les réglages Android : { name, address }. */
    @PluginMethod
    public void listBluetoothDevices(PluginCall call) {
        if (needsBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback");
            return;
        }
        doListBluetoothDevices(call);
    }

    private void doListBluetoothDevices(PluginCall call) {
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth indisponible ou désactivé.");
            return;
        }
        JSArray devices = new JSArray();
        try {
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                JSObject item = new JSObject();
                item.put("name", device.getName());
                item.put("address", device.getAddress());
                devices.put(item);
            }
        } catch (SecurityException e) {
            call.reject("Autorisation Bluetooth manquante.");
            return;
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    /** Imprimantes USB branchées : { name, deviceId, hasPermission }. */
    @PluginMethod
    public void listUsbDevices(PluginCall call) {
        UsbManager manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        JSArray devices = new JSArray();
        if (manager != null) {
            for (UsbDevice device : manager.getDeviceList().values()) {
                JSObject item = new JSObject();
                item.put("name", device.getProductName() != null ? device.getProductName() : device.getDeviceName());
                item.put("deviceId", device.getDeviceId());
                item.put("hasPermission", manager.hasPermission(device));
                devices.put(item);
            }
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    // --- Impression -------------------------------------------------------------

    /**
     * Envoie des octets ESC/POS bruts à une imprimante.
     * Paramètres : { transport: "bluetooth"|"tcp"|"usb", data: base64,
     *                address?, host?, port?, deviceId?, timeout? }
     */
    @PluginMethod
    public void printRaw(PluginCall call) {
        String transport = call.getString("transport", "");
        if ("bluetooth".equals(transport) && needsBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback");
            return;
        }
        doPrintRaw(call);
    }

    private void doPrintRaw(PluginCall call) {
        String transport = call.getString("transport", "");
        String dataB64 = call.getString("data");
        if (dataB64 == null || dataB64.isEmpty()) {
            call.reject("Aucune donnée à imprimer.");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(dataB64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Données d'impression invalides.");
            return;
        }

        if ("usb".equals(transport)) {
            printUsb(call, bytes);
            return;
        }

        final DeviceConnection connection;
        try {
            if ("bluetooth".equals(transport)) {
                connection = bluetoothConnection(call.getString("address"));
            } else if ("tcp".equals(transport)) {
                String host = call.getString("host");
                int port = call.getInt("port", 9100);
                int timeout = call.getInt("timeout", 5000);
                if (host == null || host.isEmpty()) {
                    call.reject("Adresse de l'imprimante manquante.");
                    return;
                }
                connection = new TcpConnection(host, port, timeout);
            } else {
                call.reject("Liaison inconnue : " + transport);
                return;
            }
        } catch (Exception e) {
            call.reject(message(e));
            return;
        }
        sendOnThread(call, connection, bytes);
    }

    private BluetoothConnection bluetoothConnection(String address) {
        if (address == null || address.isEmpty()) {
            throw new IllegalArgumentException("Adresse Bluetooth manquante.");
        }
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null) throw new IllegalStateException("Bluetooth indisponible.");
        BluetoothDevice device = adapter.getRemoteDevice(address);
        return new BluetoothConnection(device);
    }

    /** L'IO (connexion, envoi) ne doit jamais tourner sur le fil principal : réseau et Bluetooth y sont interdits. */
    private void sendOnThread(PluginCall call, DeviceConnection connection, byte[] bytes) {
        new Thread(() -> {
            try {
                connection.connect();
                connection.write(bytes);
                connection.send();
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(message(e));
            } finally {
                try {
                    connection.disconnect();
                } catch (Exception ignored) {
                }
            }
        }).start();
    }

    // --- USB : autorisation puis envoi ------------------------------------------

    private void printUsb(PluginCall call, byte[] bytes) {
        UsbManager manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (manager == null) {
            call.reject("USB indisponible sur cet appareil.");
            return;
        }
        UsbDevice device = findUsbDevice(manager, call.getInt("deviceId"));
        if (device == null) {
            call.reject("Imprimante USB introuvable (est-elle branchée ?).");
            return;
        }
        if (manager.hasPermission(device)) {
            sendOnThread(call, new UsbConnection(manager, device), bytes);
            return;
        }
        requestUsbPermission(call, manager, device, bytes);
    }

    private UsbDevice findUsbDevice(UsbManager manager, Integer deviceId) {
        Map<String, UsbDevice> list = manager.getDeviceList();
        if (deviceId != null) {
            for (UsbDevice device : list.values()) {
                if (device.getDeviceId() == deviceId) return device;
            }
            return null;
        }
        // Sans identifiant précis : la première imprimante branchée.
        return list.isEmpty() ? null : list.values().iterator().next();
    }

    private void requestUsbPermission(PluginCall call, UsbManager manager, UsbDevice device, byte[] bytes) {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!ACTION_USB_PERMISSION.equals(intent.getAction())) return;
                try {
                    context.unregisterReceiver(this);
                } catch (Exception ignored) {
                }
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (granted) {
                    sendOnThread(call, new UsbConnection(manager, device), bytes);
                } else {
                    call.reject("Autorisation USB refusée.");
                }
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent intent = PendingIntent.getBroadcast(getContext(), 0, new Intent(ACTION_USB_PERMISSION), flags);
        manager.requestPermission(device, intent);
    }

    // --- Autorisations ----------------------------------------------------------

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Autorisation Bluetooth refusée : impossible d'imprimer.");
            return;
        }
        if ("printRaw".equals(call.getMethodName())) {
            doPrintRaw(call);
        } else {
            doListBluetoothDevices(call);
        }
    }

    private boolean needsBluetoothPermission() {
        return Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter getBluetoothAdapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (manager != null) return manager.getAdapter();
        return BluetoothAdapter.getDefaultAdapter();
    }

    private String message(Throwable e) {
        String msg = e.getMessage();
        return msg != null && !msg.isEmpty() ? msg : e.getClass().getSimpleName();
    }
}
