/**
 * Prix d'une ligne de commande. Aucune dépendance (pas de Zod) : le même calcul tourne
 * sur le serveur, qui fait foi à chaque commande (§20), et dans le panier du client, qui
 * affiche le même total sans alourdir son téléphone.
 */

export interface PricingOption {
  id: string;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
}

export interface PricingProduct {
  id: string;
  name: string;
  price: number;
  promoPrice: number | null;
  isAvailable: boolean;
  variants: PricingOption[];
  modifierGroups: { id: string; name: string; minSelect: number; maxSelect: number; modifiers: PricingOption[] }[];
}

export interface LineSelection {
  variantId?: string | null;
  modifierIds?: string[];
  quantity: number;
}

export type PricingErrorCode =
  | 'PRODUCT_UNAVAILABLE'
  | 'VARIANT_REQUIRED'
  | 'VARIANT_INVALID'
  | 'MODIFIER_INVALID'
  | 'MODIFIER_UNAVAILABLE'
  | 'GROUP_MIN'
  | 'GROUP_MAX'
  | 'QUANTITY_INVALID'
  | 'NEGATIVE_PRICE';

export type PricedLine =
  | {
      ok: true;
      unitPrice: number;
      total: number;
      variant: { id: string; name: string; priceDelta: number } | null;
      modifiers: { id: string; groupId: string; name: string; priceDelta: number }[];
    }
  | { ok: false; code: PricingErrorCode; message: string };

const fail = (code: PricingErrorCode, message: string): PricedLine => ({ ok: false, code, message });

/**
 * Prix unitaire = (prix promo ou prix) + version + options. Refuse toute sélection que
 * le restaurant n'a pas prévue : option d'un autre produit, choix au-delà du maximum,
 * groupe obligatoire oublié, article épuisé.
 */
export function priceLine(product: PricingProduct, selection: LineSelection): PricedLine {
  if (!product.isAvailable) return fail('PRODUCT_UNAVAILABLE', `« ${product.name} » n'est plus disponible.`);
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99) {
    return fail('QUANTITY_INVALID', 'Quantité invalide (1 à 99).');
  }

  let variant: PricingOption | null = null;
  if (product.variants.length > 0) {
    if (!selection.variantId) return fail('VARIANT_REQUIRED', `Choisissez une version pour « ${product.name} ».`);
    variant = product.variants.find((v) => v.id === selection.variantId) ?? null;
    if (!variant) return fail('VARIANT_INVALID', 'Version inconnue pour ce produit.');
    if (!variant.isAvailable) return fail('PRODUCT_UNAVAILABLE', `« ${product.name} — ${variant.name} » n'est plus disponible.`);
  } else if (selection.variantId) {
    return fail('VARIANT_INVALID', "Ce produit n'a pas de versions.");
  }

  const ids = selection.modifierIds ?? [];
  if (new Set(ids).size !== ids.length) return fail('MODIFIER_INVALID', 'Option choisie deux fois.');

  const chosen: { id: string; groupId: string; name: string; priceDelta: number }[] = [];
  for (const id of ids) {
    const group = product.modifierGroups.find((g) => g.modifiers.some((m) => m.id === id));
    const modifier = group?.modifiers.find((m) => m.id === id);
    if (!group || !modifier) return fail('MODIFIER_INVALID', 'Option inconnue pour ce produit.');
    if (!modifier.isAvailable) return fail('MODIFIER_UNAVAILABLE', `L'option « ${modifier.name} » n'est plus disponible.`);
    chosen.push({ id, groupId: group.id, name: modifier.name, priceDelta: modifier.priceDelta });
  }

  for (const group of product.modifierGroups) {
    const count = chosen.filter((c) => c.groupId === group.id).length;
    if (count < group.minSelect) return fail('GROUP_MIN', `« ${group.name} » : choisissez au moins ${group.minSelect} option(s).`);
    if (count > group.maxSelect) return fail('GROUP_MAX', `« ${group.name} » : ${group.maxSelect} option(s) au maximum.`);
  }

  const unitPrice =
    (product.promoPrice ?? product.price) + (variant?.priceDelta ?? 0) + chosen.reduce((sum, c) => sum + c.priceDelta, 0);
  if (unitPrice < 0) return fail('NEGATIVE_PRICE', 'Le prix calculé est négatif : vérifiez les suppléments.');

  return {
    ok: true,
    unitPrice,
    total: unitPrice * selection.quantity,
    variant: variant ? { id: variant.id, name: variant.name, priceDelta: variant.priceDelta } : null,
    modifiers: chosen,
  };
}
