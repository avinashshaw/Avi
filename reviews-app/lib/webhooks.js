// Webhook handlers passed to shopify.processWebhooks(). Covers app uninstall
// cleanup plus the three GDPR/compliance webhooks Shopify requires for every
// public app.

import { DeliveryMethod } from '@shopify/shopify-api';
import { deleteShopData } from './store.js';

export default {
  APP_UNINSTALLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: '/api/webhooks',
    callback: async (_topic, shop) => {
      // Remove this shop's locally stored reviews on uninstall.
      await deleteShopData(shop);
    },
  },

  // --- Mandatory compliance webhooks (required to pass app review) ---
  CUSTOMERS_DATA_REQUEST: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: '/api/webhooks',
    callback: async (_topic, _shop, _body) => {
      // We do not store personal customer data beyond what is in the reviews
      // the merchant imported. Nothing to export.
    },
  },
  CUSTOMERS_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: '/api/webhooks',
    callback: async (_topic, _shop, _body) => {
      // Nothing additional to redact.
    },
  },
  SHOP_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: '/api/webhooks',
    callback: async (_topic, shop, _body) => {
      await deleteShopData(shop);
    },
  },
};
