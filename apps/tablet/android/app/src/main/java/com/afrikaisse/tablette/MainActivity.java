package com.afrikaisse.tablette;

import com.getcapacitor.BridgeActivity;

/**
 * Les écrans d'AfriKaisse sont déjà dessinés pour le doigt (texte 16 px, boutons 48 px) : l'agrandissement
 * de police d'Android (130 % sur la tablette de référence) les ferait déborder. La WebView reste donc à 100 %.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onStart() {
    super.onStart();
    if (bridge != null && bridge.getWebView() != null) {
      bridge.getWebView().getSettings().setTextZoom(100);
    }
  }
}
