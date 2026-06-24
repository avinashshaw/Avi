// Central Shopify app configuration. Wires the official Express middleware
// (OAuth install flow, session validation, webhook processing, CSP headers)
// to our JSON session storage.

import { shopifyApp } from '@shopify/shopify-app-express';
import { ApiVersion } from '@shopify/shopify-api';
import { JsonSessionStorage } from './session-storage.js';

const appUrl = process.env.SHOPIFY_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
const hostName = appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
const hostScheme = appUrl.startsWith('https') ? 'https' : 'http';

const shopify = shopifyApp({
  api: {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || '',
    scopes: (process.env.SCOPES || 'read_products,read_metaobjects,write_metaobjects')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    hostName,
    hostScheme,
    apiVersion: ApiVersion.October24,
  },
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
  sessionStorage: new JsonSessionStorage(),
  useOnlineTokens: false,
});

export default shopify;
export const APP_URL = appUrl;
