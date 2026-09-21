package com.afrikaisse.tablette;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Les écrans d'AfriKaisse sont déjà dessinés pour le doigt (texte 16 px, boutons 48 px) : l'agrandissement
 * de police d'Android (130 % sur la tablette de référence) les ferait déborder. La WebView reste donc à 100 %.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Impression thermique universelle (Bluetooth / Wi-Fi / USB) : disponible avant le chargement des écrans.
    registerPlugin(ThermalPrinter.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onStart() {
    super.onStart();
    if (bridge != null && bridge.getWebView() != null) {
      bridge.getWebView().getSettings().setTextZoom(100);
    }
  }
}
