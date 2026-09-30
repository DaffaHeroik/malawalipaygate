# Data model

| Koleksi | Field kunci | Index |
|---|---|---|
| `users` | email, passwordHash (scrypt), name, displayName, merchantName, emailVerified, role, totpSecret, totpEnabled, subscriptionUntil, verifyTokenHash, resetTokenHash | `email` unique |
| `merchantsettings` | userId, feePercent, uniqueDigits, shopeeMode/gopayMode, orderTtl, notifyUrl, redirectUrl, webhookSecret | `userId` unique |
| `projects` | userId, name, isDefault, apiKeyHash, apiKeyMasked, apiKeyLastUsedAt, webhookUrl | `userId+name`, `apiKeyHash` sparse |
| `qrisaccounts` | userId, provider, qrisString, merchantName, merchantCity, imagePath, qrisType, status | `userId+provider`, `userId+status` |
| `providerconnections` | userId, provider, credentialsEnc, status, hasCredential, tokenPreview | `userId+provider` unique |
| `listenerdevices` | userId, deviceId, name, model, androidVersion, notificationAccess, enabledSources, lastSeenAt | `deviceId` unique |
| `transactions` | provider, providerTransactionId, amount, occurredAt, claimedByOrderId | `provider+providerTransactionId` **unique** |
| `orders` | orderId (`pay_…`), userId, projectId, project{id,name}, reference, webhookUrl, provider, baseAmount, feeAmount, uniqueCode, payAmount, status, qris, expiresAt, paidAt | `userId+provider+payAmount` partial unique (pending), `status+expiresAt` |
| `webhookdeliveries` | deliveryId (`evt_…`), userId, orderId, event, url, payload, status, attempts, responseStatus | `orderId`, `status+nextRetryAt` |
| `subscriptionpayments` | paymentId (`sub_…`), userId, planMonths, price, totalCheckout, status | `userId+createdAt` |
| `appsettings` | key (singleton `global`), pricing, disabledProviders, announcement | `key` unique |
| `auditlogs` | userId, action, targetType, targetId, ip, ua | `userId+createdAt` |

## Integritas

- `pay_amount` unik hanya di antara order `pending` per `userId + provider`
  (partial unique index + retry pada bentrok).
- `Transaction.providerTransactionId` unique → satu bukti bayar = satu order.
- API key disimpan **hash**, bukan plaintext; masked key (`pk_live_••••abcd`) untuk display.
- Kredensial provider disimpan di `credentialsEnc` (placeholder AES-256-GCM, key dari
  `CREDENTIAL_ENC_KEY`).
