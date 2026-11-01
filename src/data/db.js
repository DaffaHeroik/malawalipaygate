'use strict';

/**
 * Implementasi lapisan data berbasis MongoDB.
 *
 * Route memanggil method tanpa userId (selain method eksplisit `*ForUser`) —
 * userId aktif diambil dari AsyncLocalStorage (`lib/context`) yang diisi
 * middleware `loadUser`.
 */

const models = require('../models');
const config = require('../config');
const context = require('../lib/context');
const ids = require('../lib/ids');
const { addDays, addMinutes } = require('../lib/datetime');
const apikey = require('../services/apikey.service');
const amountSvc = require('../services/amount.service');
const listenerSvc = require('../services/listener.service');
const matchingService = require('../services/matching.service');
const qrisSvc = require('../services/qris.service');
const constants = require('../config/constants');

const uid = () => context.currentUserId();

/* ═══════════════════ Serializer ═══════════════════ */

const serializeUser = (doc) => ({
  id: String(doc._id),
  name: doc.name || '',
  displayName: doc.displayName || '',
  email: doc.email || '',
  merchantName: doc.merchantName || '',
  initials: ((doc.displayName || doc.name || doc.email || '?').trim().charAt(0) || '?').toUpperCase(),
  emailVerified: Boolean(doc.emailVerified),
  role: doc.role || 'user',
  isBotTenant: Boolean(doc.isBotTenant),
  twoFactorEnabled: Boolean(doc.totpEnabled),
  avatarColor: doc.avatarColor || '#174d9b',
  joinedAt: doc.createdAt || null,
  lastLoginAt: doc.lastLoginAt || null,
});

const serializeSettings = (doc) => ({
  feePercent: doc?.feePercent ?? 0,
  uniqueDigits: doc?.uniqueDigits ?? 2,
  shopeeFeeEnabled: Boolean(doc?.shopeeFeeEnabled),
  shopeeUniqueEnabled: Boolean(doc?.shopeeUniqueEnabled),
  shopeeMode: doc?.shopeeMode || 'hybrid',
  gopayFeeEnabled: Boolean(doc?.gopayFeeEnabled),
  gopayUniqueEnabled: Boolean(doc?.gopayUniqueEnabled),
  gopayMode: doc?.gopayMode || 'hybrid',
  orderTtl: doc?.orderTtl ?? 600,
  notifyUrl: doc?.notifyUrl || '',
  redirectUrl: doc?.redirectUrl || '',
  webhookSecret: doc?.webhookSecret || null,
  webhookSecretRotatedAt: doc?.webhookSecretRotatedAt || null,
});

const projectStats = async (userId, projectId) => {
  const [total, paidDocs, pending] = await Promise.all([
    models.Order.countDocuments({ userId, projectId }),
    models.Order.countDocuments({ userId, projectId, status: 'paid' }),
    models.Order.countDocuments({ userId, projectId, status: 'pending' }),
  ]);
  const [volume] = await models.Order.aggregate([
    { $match: { userId, projectId, status: 'paid' } },
    { $group: { _id: null, volume: { $sum: '$payAmount' } } },
  ]);
  return { total, paid: paidDocs, pending, volume: volume?.volume || 0 };
};

const serializeProject = async (doc) => {
  const stats = await projectStats(doc.userId, String(doc._id));
  return {
    id: String(doc._id),
    name: doc.name,
    isDefault: Boolean(doc.isDefault),
    webhookUrl: doc.webhookUrl || '',
    apiKeyMasked: doc.apiKeyMasked || null,
    hasApiKey: Boolean(doc.apiKeyMasked),
    apiKeyLastUsedAt: doc.apiKeyLastUsedAt || null,
    apiKeyRotatedAt: doc.apiKeyRotatedAt || null,
    createdAt: doc.createdAt || null,
    lastActivityAt: doc.lastActivityAt || null,
    stats,
  };
};

const serializeQris = (doc) => ({
  id: String(doc._id),
  provider: doc.provider,
  merchantName: doc.merchantName || '',
  merchantCity: doc.merchantCity || '',
  qrisString: doc.qrisString,
  imagePath: doc.imagePath || null,
  qrisType: doc.qrisType || 'static',
  status: doc.status,
  createdAt: doc.createdAt || null,
});

const serializeConnection = (doc) =>
  doc
    ? {
        provider: doc.provider,
        status: doc.status || 'disconnected',
        hasCredential: Boolean(doc.hasCredential),
        tokenPreview: doc.tokenPreview || null,
        merchantPhone: doc.merchantPhone || null,
        lastTestAt: doc.lastTestAt || null,
        lastError: doc.lastError || null,
        connectedAt: doc.connectedAt || null,
      }
    : null;

const serializeDevice = (doc) => ({
  deviceId: doc.deviceId,
  name: doc.name || '',
  model: doc.model || '',
  androidVersion: doc.androidVersion || '',
  appVersion: doc.appVersion || '',
  notificationAccess: Boolean(doc.notificationAccess),
  enabledSources: doc.enabledSources || [],
  lastSeenAt: doc.lastSeenAt || null,
  tokenPreview: doc.tokenPreview || null,
  pushCount: doc.pushCount || 0,
  lastPushAt: doc.lastPushAt || null,
});

const serializeOrder = (doc) => ({
  id: doc.orderId,
  userId: String(doc.userId),
  project: doc.project || null,
  projectId: doc.projectId || null,
  reference: doc.reference || null,
  redirectUrl: doc.redirectUrl || null,
  webhookUrl: doc.webhookUrl || null,
  mode: doc.mode || 'live',
  provider: doc.provider || null,
  baseAmount: doc.baseAmount,
  feePercent: doc.feePercent ?? 0,
  feeAmount: doc.feeAmount ?? 0,
  uniqueCode: doc.uniqueCode ?? 0,
  payAmount: doc.payAmount,
  status: doc.status,
  qris: doc.qris || '',
  checkoutUrl: doc.checkoutUrl || '',
  ttlSeconds: doc.ttlSeconds ?? 600,
  createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
  expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
  paidAt: doc.paidAt ? doc.paidAt.toISOString() : null,
  cancelledAt: doc.cancelledAt ? doc.cancelledAt.toISOString() : null,
  matchedTransaction: doc.matchedTransaction || null,
  webhookDeliveries: doc.webhookDeliveries || [],
});

/* ═══════════════════ Internal helper ═══════════════════ */

const ensureDefaultProject = async (userId) => {
  let project = await models.Project.findOne({ userId, isDefault: true });
  if (!project) {
    project = await models.Project.create({ userId, name: 'Project Utama', isDefault: true });
  }
  return project;
};

const getSettingsDoc = async (userId) => {
  let doc = await models.MerchantSettings.findOne({ userId });
  if (!doc) doc = await models.MerchantSettings.create({ userId });
  return doc;
};

/* ═══════════════════ User & setting ═══════════════════ */

const getUser = async () => {
  const id = uid();
  if (!id) return null;
  const doc = await models.User.findById(id);
  return doc ? serializeUser(doc) : null;
};

const getUserById = async (id) => {
  const doc = await models.User.findById(id);
  return doc ? serializeUser(doc) : null;
};

/**
 * Dipakai alur login: route-nya butuh `.save()` & field penuh,
 * jadi baliknya dokumen Mongoose (dengan alias `id`).
 */
const getUserByEmail = async (email) => {
  const doc = await models.User.findOne({ email: String(email || '').toLowerCase() });
  if (!doc) return null;
  doc.id = String(doc._id);
  return doc;
};

const listUsers = async () => {
  const docs = await models.User.find({}).sort({ createdAt: 1 }).lean();
  return docs.map((doc) => ({
    id: String(doc._id),
    email: doc.email,
    name: doc.name,
    displayName: doc.displayName,
    role: doc.role,
    emailVerified: Boolean(doc.emailVerified),
    subscriptionUntil: doc.subscriptionUntil ? doc.subscriptionUntil.toISOString() : null,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
  }));
};

/** REST API: key → { user, project }. `user` tetap dokumen agar dapat dipakai langsung. */
const findUserByApiKey = async (key) => {
  const hash = apikey.hashKey(key);
  let project = await models.Project.findOne({ apiKeyHash: hash });

  if (project && !project.isDefault) {
    // Project non-utama terhapus (key masih hash di DB) → kembalikan ke
    // Project Utama. Project non-utama yang masih ada tetap dipakai apa adanya,
    // supaya guard `default_project_key_required` bisa menolak endpoint khusus.
    const exists = await models.Project.exists({ _id: project._id });
    if (!exists) {
      const main = await models.Project.findOne({ userId: project.userId, isDefault: true });
      if (!main) {
        main = await models.Project.create({
          userId: project.userId,
          name: 'Project Utama',
          isDefault: true,
          apiKeyHash: hash,
          apiKeyMasked: project.apiKeyMasked,
        });
      }
      project = main;
    }
  }

  if (!project) return null;
  const user = await models.User.findById(project.userId);
  if (!user) return null;
  user.id = String(user._id);
  return {
    user,
    project: {
      id: String(project._id),
      name: project.name,
      isDefault: Boolean(project.isDefault),
      webhookUrl: project.webhookUrl || '',
    },
    rawProject: project,
  };
};

const markApiKeyUsed = async (projectId) => {
  await models.Project.updateOne({ _id: projectId }, { $set: { apiKeyLastUsedAt: new Date() } });
};

/* ═══════════════════ Settings ═══════════════════ */

const getSettingsForUser = async (userId) => serializeSettings(await getSettingsDoc(userId));

const getSettings = () => getSettingsForUser(uid());

const updateSettingsForUser = async (userId, patch = {}) => {
  const doc = await getSettingsDoc(userId);
  Object.assign(doc, patch);
  await doc.save();
  return serializeSettings(doc);
};

const updateSettings = (patch) => updateSettingsForUser(uid(), patch);

/* ═══════════════════ Project ═══════════════════ */

const listProjects = async () => {
  const docs = await models.Project.find({ userId: uid() }).sort({ isDefault: -1, createdAt: 1 });
  const out = [];
  for (const doc of docs) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await serializeProject(doc));
  }
  return out;
};

const getProjectForUser = async (userId, id) => {
  if (!id) return null;
  let doc = null;
  try {
    doc = await models.Project.findOne({ _id: id, userId });
  } catch (_) {
    doc = null; // id tidak valid (bukan ObjectId)
  }
  return doc ? serializeProject(doc) : null;
};

const getProject = (id) => getProjectForUser(uid(), id);

const createProject = async (name) => {
  const doc = await models.Project.create({ userId: uid(), name, isDefault: false });
  return serializeProject(doc);
};

const renameProject = async (id, name) => {
  const doc = await models.Project.findOne({ _id: id, userId: uid() });
  if (!doc) return null;
  doc.name = name;
  await doc.save();
  return serializeProject(doc);
};

const deleteProject = async (id) => {
  const doc = await models.Project.findOne({ _id: id, userId: uid() });
  if (!doc) return { ok: false, reason: 'not_found' };
  if (doc.isDefault) return { ok: false, reason: 'default' };

  const pending = await models.Order.countDocuments({ userId: doc.userId, projectId: String(doc._id), status: 'pending' });
  if (pending) return { ok: false, reason: 'pending' };

  const target = await ensureDefaultProject(doc.userId);
  await models.Order.updateMany(
    { userId: doc.userId, projectId: String(doc._id) },
    { $set: { projectId: String(target._id), project: { id: String(target._id), name: target.name } } }
  );
  await models.Project.deleteOne({ _id: doc._id });
  return { ok: true, movedTo: target.name };
};

/* ═══════════════════ API key & webhook secret ═══════════════════ */

const rotateApiKey = async (projectId) => {
  const id = projectId || null;
  const doc = id
    ? await models.Project.findOne({ _id: id, userId: uid() })
    : await ensureDefaultProject(uid());
  if (!doc) return null;

  const { fullKey, apiKeyHash, apiKeyMasked } = apikey.generateKey();
  doc.apiKeyHash = apiKeyHash;
  doc.apiKeyMasked = apiKeyMasked;
  doc.apiKeyRotatedAt = new Date();
  doc.apiKeyLastUsedAt = null;
  await doc.save();

  return { project: await serializeProject(doc), fullKey };
};

const rotateWebhookSecret = async () => {
  const doc = await getSettingsDoc(uid());
  const secret = `whsec_${ids.secret(10)}`;
  doc.webhookSecret = secret;
  doc.webhookSecretRotatedAt = new Date();
  await doc.save();
  return secret;
};

const saveProjectWebhook = async (projectId, url) => {
  const doc = await models.Project.findOne({ _id: projectId, userId: uid() });
  if (!doc) return null;
  doc.webhookUrl = url || '';
  await doc.save();
  return serializeProject(doc);
};

/* ═══════════════════ QRIS ═══════════════════ */

const listQris = async () => {
  const docs = await models.QrisAccount.find({ userId: uid() }).sort({ status: 1, createdAt: 1 });
  return docs.map(serializeQris);
};

const getActiveQrisForUser = async (userId) => {
  const doc = await models.QrisAccount.findOne({ userId, status: 'active' });
  return doc ? serializeQris(doc) : null;
};

const getActiveQris = () => getActiveQrisForUser(uid());

const saveQrisForUser = async (userId, { provider, merchantName, merchantCity, qrisString, imagePath = null, makeActive = true }) => {
  if (makeActive) {
    await models.QrisAccount.updateMany({ userId, status: 'active' }, { $set: { status: 'standby' } });
  }

  const qrisType = Boolean(qrisString) && qrisString.length > 40 ? 'static' : 'dynamic';
  const patch = {
    merchantName: merchantName || '',
    merchantCity: merchantCity || '',
    qrisString,
    imagePath,
    qrisType,
    status: makeActive ? 'active' : 'standby',
  };
  if (makeActive) {
    await models.QrisAccount.updateMany({ userId, status: 'active', provider: { $ne: provider } }, { $set: { status: 'standby' } });
  }
  const doc = await models.QrisAccount.findOneAndUpdate({ userId, provider }, { $set: patch }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return serializeQris(doc);
};

const saveQris = (payload) => saveQrisForUser(uid(), payload);

const removeQris = async (id) => {
  await models.QrisAccount.deleteOne({ userId: uid(), _id: id });
};

/* ═══════════════════ Provider connection ═══════════════════ */

const getProviderConnection = async (provider) =>
  serializeConnection(await models.ProviderConnection.findOne({ userId: uid(), provider }));

const connectProvider = async (provider, payload = {}) => {
  const userId = uid();
  const doc = await models.ProviderConnection.findOneAndUpdate(
    { userId, provider },
    {
      $setOnInsert: { userId, provider, status: 'disconnected', hasCredential: false },
      $set: {
        hasCredential: true,
        lastTestAt: new Date(),
        lastError: null,
        ...(payload.tokenPreview !== undefined ? { tokenPreview: payload.tokenPreview } : {}),
        ...(payload.merchantPhone !== undefined ? { merchantPhone: payload.merchantPhone } : {}),
        ...(payload.credentialsEnc !== undefined ? { credentialsEnc: payload.credentialsEnc } : {}),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return serializeConnection(doc);
};

const disconnectProvider = async (provider) => {
  const doc = await models.ProviderConnection.findOneAndUpdate(
    { userId: uid(), provider },
    {
      $set: {
        status: 'disconnected',
        hasCredential: false,
        tokenPreview: null,
        merchantPhone: null,
        credentialsEnc: null,
        lastError: null,
      },
    },
    { new: true }
  );
  return serializeConnection(doc);
};

const testProviderConnection = async (provider) => {
  const doc = await models.ProviderConnection.findOne({ userId: uid(), provider });
  if (!doc) return null;
  if (doc.hasCredential) {
    doc.status = 'connected';
    doc.lastError = null;
    if (!doc.connectedAt) doc.connectedAt = new Date();
  } else {
    doc.status = 'disconnected';
    doc.lastError = 'Kredensial belum diisi.';
  }
  doc.lastTestAt = new Date();
  await doc.save();
  return serializeConnection(doc);
};

/* ═══════════════════ Listener ═══════════════════ */

const listListenerDevicesForUser = async (userId) => {
  const docs = await models.ListenerDevice.find({ userId, revokedAt: null }).sort({ lastSeenAt: -1 });
  return docs.map(serializeDevice);
};

const listListenerDevices = () => listListenerDevicesForUser(uid());

const getListenerSummary = async () => {
  const userId = uid();
  const [devices, detection] = await Promise.all([
    models.ListenerDevice.find({ userId, revokedAt: null }),
    getDetectionForUser(userId),
  ]);
  return {
    connected: devices.length > 0,
    deviceCount: devices.length,
    qrisProvider: detection.provider,
    qrisProviderLabel: detection.providerLabel,
    detection,
    sourceCount: new Set(devices.flatMap((d) => d.enabledSources || [])).size,
  };
};

const getListenerApp = () => ({
  version: '1.0-beta.2',
  minAndroid: 'Android 7+',
  sizeMb: 6.6,
  fileName: 'malawali-listener-1.0-beta.2.apk',
});

const registerListenerDeviceForUser = async (userId, payload = {}) => {
  const existing = await models.ListenerDevice.findOne({ userId, deviceId: payload.deviceId });
  let token = null;

  if (!existing) {
    token = listenerSvc.generateToken();
    await models.ListenerDevice.create({
      userId,
      deviceId: payload.deviceId,
      name: payload.name,
      model: payload.model,
      androidVersion: payload.androidVersion,
      appVersion: payload.appVersion,
      notificationAccess: payload.notificationAccess !== false,
      enabledSources: payload.enabledSources || [],
      lastSeenAt: new Date(),
      tokenHash: listenerSvc.hashToken(token),
      tokenPreview: listenerSvc.maskToken(token),
      tokenRotatedAt: new Date(),
    });
    return {
      device: { deviceId: payload.deviceId, name: payload.name, enabledSources: payload.enabledSources || [] },
      token,
      tokenPreview: listenerSvc.maskToken(token),
    };
  }

  return {
    device: serializeDevice(existing),
    token: null,
    tokenPreview: existing.tokenPreview || null,
  };
};

const findListenerDeviceByToken = async (token) => {
  const hash = listenerSvc.hashToken(token);
  const doc = await models.ListenerDevice.findOne({ tokenHash: hash, revokedAt: null });
  if (!doc) return null;
  return { device: serializeDevice(doc), userId: doc.userId };
};

const recordListenerActivity = async (deviceId, { push = false } = {}) => {
  const update = { $set: { lastSeenAt: new Date() } };
  if (push) {
    update.$inc = { pushCount: 1 };
    update.$set.lastPushAt = new Date();
  }
  await models.ListenerDevice.updateOne({ deviceId, revokedAt: null }, update);
};

const revokeListenerDeviceForUser = async (userId, deviceId) => {
  const doc = await models.ListenerDevice.findOne({ userId, deviceId });
  if (!doc) return false;
  doc.revokedAt = new Date();
  doc.tokenHash = null;
  await doc.save();
  return true;
};

const ingestListenerPayment = (payload) => matchingService.processPayment(payload);

/* ═══════════════════ Deteksi pembayaran ═══════════════════ */

const getDetectionForUser = async (userId) => {
  const [activeQris, connections, listenerDevices] = await Promise.all([
    models.QrisAccount.findOne({ userId, status: 'active' }),
    models.ProviderConnection.find({ userId }),
    models.ListenerDevice.find({ userId, revokedAt: null }),
  ]);

  const provider = activeQris ? activeQris.provider : null;
  const connection = connections.find((c) => c.provider === provider);
  const merchantConnected = connection?.status === 'connected';
  const listenerReady = Boolean(
    provider && listenerDevices.some((d) => d.notificationAccess && (d.enabledSources || []).includes(provider))
  );

  return {
    provider,
    providerLabel:
      provider === 'shopee' ? 'Shopee Partner' : provider === 'gopay' ? 'GoPay Merchant' : null,
    merchantConnected,
    connectionStatus: connection?.status || 'disconnected',
    listenerReady,
    ready: merchantConnected || listenerReady,
    note:
      !merchantConnected && !listenerReady
        ? 'QRIS sudah tersimpan, tetapi deteksi pembayaran belum siap. Hubungkan akun merchant atau aktifkan aplikasi sumber di Malawali Listener.'
        : null,
  };
};

const getDetection = () => getDetectionForUser(uid());

/* ═══════════════════ Order ═══════════════════ */

/**
 * Buat order (3 mode nominal, QRIS dinamis EMVCo).
 * `userId` wajib atau diambil dari context request.
 */
const createOrderForUser = async ({
  userId,
  projectId = null,
  baseAmount,
  reference = null,
  ttlSeconds,
  webhookUrl = null,
  redirectUrl = null,
  provider: forcedProvider,
} = {}) => {
  const uidValue = userId || uid();
  const ttl = Number.isFinite(ttlSeconds) ? Math.round(ttlSeconds) : 600;

  const [settings, activeQris, project] = await Promise.all([
    getSettingsForUser(uidValue),
    getActiveQrisForUser(uidValue),
    projectId ? models.Project.findOne({ _id: projectId, userId: uidValue }) : ensureDefaultProject(uidValue),
  ]);

  const provider = forcedProvider || activeQris?.provider;
  if (!activeQris) return null;

  const mode = amountSvc.modeForProvider(settings, provider);
  const isTaken = async (candidate) =>
    (await models.Order.countDocuments({ userId: uidValue, provider, payAmount: candidate, status: 'pending' })) > 0;

  const buildPayload = async () => {
    const effective = amountSvc.normalizeMode(mode);
    let resolved;
    if (effective === 'hybrid') {
      resolved = await amountSvc.resolveAmount.hybrid(
        { baseAmount, feePercent: settings.feePercent },
        isTaken
      );
    } else {
      resolved = amountSvc.resolveAmount.simple({
        mode: effective,
        baseAmount,
        feePercent: settings.feePercent,
        uniqueDigits: settings.uniqueDigits,
      });
    }
    if (!resolved) throw new Error('hybrid_offset_exhausted');

    let qrisPayload = activeQris.qrisString;
    try {
      qrisPayload = qrisSvc.staticToDynamic(
        activeQris.qrisString,
        resolved.payAmount,
        effective === 'fee' ? { fee: { type: 'percentage', value: settings.feePercent } } : undefined
      );
    } catch (_) {
      // QRIS dinamis disimpan merchant → pakai apa adanya.
      qrisPayload = activeQris.qrisString;
    }

    return { resolved, qrisPayload };
  };

  const now = new Date();
  const orderId = ids.orderId();

  const createDoc = async ({ resolved, qrisPayload }) =>
    models.Order.create({
      orderId,
      userId: uidValue,
      projectId: project ? String(project._id) : null,
      project: project ? { id: String(project._id), name: project.name } : null,
      reference: reference || null,
      redirectUrl: redirectUrl || settings.redirectUrl || null,
      webhookUrl: webhookUrl || null,
      mode: 'live',
      provider,
      baseAmount: resolved.baseAmount,
      feePercent: resolved.feePercent,
      feeAmount: resolved.feeAmount,
      uniqueCode: resolved.uniqueCode,
      payAmount: resolved.payAmount,
      status: 'pending',
      qris: qrisPayload,
      checkoutUrl: `${config.baseUrl}/pay/${orderId}`,
      ttlSeconds: ttl,
      expiresAt: addMinutes(now, Math.ceil(ttl / 60)),
    });

  let resolved;
  let qrisPayload;
  let first;
  try {
    ({ resolved, qrisPayload } = await buildPayload());
    first = await createDoc({ resolved, qrisPayload });
  } catch (error) {
    // Bentrok nominal (unique index) → ulang allocator sekali.
    if (error && error.code === 11000) {
      ({ resolved, qrisPayload } = await buildPayload());
      first = await createDoc({ resolved, qrisPayload });
    } else {
      throw error;
    }
  }

  project.lastActivityAt = new Date();
  await project.save();

  return serializeOrder(first);
};

const createOrder = (params = {}) =>
  createOrderForUser({ userId: uid(), ttlSeconds: (params.ttlMinutes || 10) * 60, ...params });

const getOrderForUser = async (userId, id) => {
  const doc = await models.Order.findOne({ orderId: String(id || ''), userId });
  return doc ? serializeOrder(doc) : null;
};

const getOrder = (id) => getOrderForUser(uid(), id);

const cancelOrderForUser = async (userId, id) => {
  const doc = await models.Order.findOne({ orderId: String(id || ''), userId, status: 'pending' });
  if (!doc) {
    const any = await models.Order.findOne({ orderId: String(id || ''), userId });
    return { ok: false, reason: any ? 'not_pending' : 'not_found' };
  }
  doc.status = 'cancelled';
  doc.cancelledAt = new Date();
  await doc.save();
  return { ok: true, order: serializeOrder(doc) };
};

const cancelOrder = (id) => cancelOrderForUser(uid(), id);

const listAllOrders = async ({ limit = 25 } = {}) => {
  const docs = await models.Order.find({}).sort({ createdAt: -1 }).limit(limit);
  return docs.map(serializeOrder);
};

/* ═══════════════════ Dashboard ═══════════════════ */

const buildSeries = (orders, days = 14) => {
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const dayOrders = orders.filter((o) => new Date(o.createdAt).toISOString().slice(0, 10) === key);
    out.push({
      key,
      date: day.toISOString(),
      total: dayOrders.length,
      paid: dayOrders.filter((o) => o.status === 'paid').length,
    });
  }
  return out;
};

const getDashboardForUser = async (userId, { status = 'all', page = 1 } = {}) => {
  const filter = { userId };
  const rowFilter = { ...filter };
  if (status && status !== 'all') rowFilter.status = status;

  const [rows, total, statusCounts, revenueAgg, recentOrders, seriesRaw] = await Promise.all([
    models.Order.find(rowFilter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 10)
      .limit(10)
      .lean(),
    models.Order.countDocuments(rowFilter),
    Promise.all(
      [null, ...constants.ORDER_STATUS_LIST].map((s) =>
        models.Order.countDocuments(s ? { ...filter, status: s } : filter)
      )
    ),
    models.Order.aggregate([
      { $match: { userId, status: 'paid' } },
      { $group: { _id: null, revenue: { $sum: '$payAmount' } } },
    ]),
    models.Order.countDocuments(filter),
    models.Order.find({ userId, createdAt: { $gte: addDays(new Date(), -13) } })
      .select('createdAt status payAmount')
      .lean(),
  ]);

  const paidIndex = 1 + constants.ORDER_STATUS_LIST.indexOf('paid');
  const pendingIndex = 1 + constants.ORDER_STATUS_LIST.indexOf('pending');
  const stats = {
    total: statusCounts[0],
    paid: statusCounts[paidIndex],
    pending: statusCounts[pendingIndex],
    revenue: revenueAgg[0]?.revenue || 0,
  };

  const series = buildSeries(seriesRaw);
  const paidRecent = seriesRaw.filter((o) => o.status === 'paid');

  const pagination = {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 10)),
    perPage: 10,
    from: total === 0 ? 0 : (page - 1) * 10 + 1,
    to: Math.min(page * 10, total),
  };

  return {
    stats,
    series,
    seriesTotals: {
      total: series.reduce((s, d) => s + d.total, 0),
      paid: series.reduce((s, d) => s + d.paid, 0),
      revenue: paidRecent.reduce((sum, o) => sum + o.payAmount, 0),
    },
    rows: rows.map(serializeOrder),
    statusCounts,
    pagination,
  };
};

const getDashboard = (params) => getDashboardForUser(uid(), params);

const listOrders = async (params = {}) => {
  const { status = 'all', projectId = null, page = 1, perPage = 10, q = '' } = params;
  const filter = { userId: uid() };
  if (status && status !== 'all') filter.status = status;
  if (projectId) filter.projectId = projectId;

  const [rows, total] = await Promise.all([
    models.Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).lean(),
    models.Order.countDocuments(filter),
  ]);

  return {
    rows: rows.map(serializeOrder),
    pagination: {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / perPage)),
      perPage,
      from: total === 0 ? 0 : (page - 1) * perPage + 1,
      to: Math.min(page * perPage, total),
    },
  };
};

/* ═══════════════════ Publik & checkout ═══════════════════ */

const getPublicStats = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [volumeAgg, successToday, successTotal, merchants] = await Promise.all([
    models.Order.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, vol: { $sum: '$payAmount' } } },
    ]),
    models.Order.countDocuments({ status: 'paid', paidAt: { $gte: startOfToday } }),
    models.Order.countDocuments({ status: 'paid' }),
    models.User.countDocuments({ role: 'user' }),
  ]);

  return {
    paidVolume: volumeAgg[0]?.vol || 0,
    successToday,
    successTotal,
    merchants,
  };
};

const getPayPreview = async (orderId, forcedState) => {
  const doc = await models.Order.findOne({ orderId: String(orderId || '') });
  if (!doc) return null;

  const order = serializeOrder(doc);
  if (!forcedState) return order;

  const map = { paid: 'paid', pending: 'pending', expired: 'expired', cancelled: 'cancelled' };
  const status = map[forcedState] || order.status;
  return {
    ...order,
    status,
    paidAt: status === 'paid' ? (order.paidAt || addMinutes(new Date(order.createdAt), 7).toISOString()) : null,
  };
};

/* ═══════════════════ Langganan ═══════════════════ */

const getPlans = async () => {
  const setting = await models.AppSetting.findOne({ key: 'global' });
  const pricing = setting?.pricing || {};
  return constants.PLANS.map((plan) => {
    const price = Number.isFinite(pricing[plan.months]) ? pricing[plan.months] : plan.price;
    const priceOne = Number.isFinite(pricing[1]) ? pricing[1] : plan.price;
    return {
      ...plan,
      price,
      perMonth: Math.round(price / plan.months),
      saving: plan.months === 5 ? priceOne * 5 - price : 0,
    };
  });
};

const getSubscriptionForUser = async (userId) => {
  const [userDoc, lastPayment] = await Promise.all([
    models.User.findById(userId).select('subscriptionUntil').lean(),
    models.SubscriptionPayment.findOne({ userId, status: 'paid' }).sort({ paidAt: -1 }).lean(),
  ]);

  const until = userDoc?.subscriptionUntil || null;
  const active = Boolean(until && new Date(until).getTime() > Date.now());

  return {
    active,
    until: until ? new Date(until) : null,
    startedAt: lastPayment?.createdAt ? new Date(lastPayment.createdAt) : null,
    lastPaymentAt: lastPayment?.paidAt ? new Date(lastPayment.paidAt) : null,
    months: lastPayment?.planMonths || 0,
  };
};

const getSubscription = () => getSubscriptionForUser(uid());

const listSubscriptionPaymentsForUser = async (userId) => {
  const docs = await models.SubscriptionPayment.find({ userId }).sort({ createdAt: -1 }).lean();
  return docs.map((doc) => ({
    id: doc.paymentId,
    planMonths: doc.planMonths,
    price: doc.price,
    totalCheckout: doc.totalCheckout,
    status: doc.status,
    orderId: doc.orderId,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    paidAt: doc.paidAt ? doc.paidAt.toISOString() : null,
  }));
};

const listSubscriptionPayments = () => listSubscriptionPaymentsForUser(uid());

const createSubscriptionPaymentForUser = async (userId, months) => {
  const plans = await getPlans();
  const plan = plans.find((p) => p.months === months) || plans[0];

  const paymentId = `sub_${ids.secret(6)}`;
  const doc = await models.SubscriptionPayment.create({
    paymentId,
    userId,
    planMonths: plan.months,
    price: plan.price,
    totalCheckout: plan.price,
    status: 'pending',
  });

  return {
    id: doc.paymentId,
    planMonths: doc.planMonths,
    price: doc.price,
    totalCheckout: doc.totalCheckout,
    status: doc.status,
    orderId: null,
    createdAt: doc.createdAt.toISOString(),
    paidAt: null,
  };
};

const createSubscriptionPayment = (months) => createSubscriptionPaymentForUser(uid(), months);

/** Admin: perpanjang masa aktif user (dari tagihan / manual). */
const activateSubscription = async (userId, months, { paymentId = null } = {}) => {
  if (paymentId) {
    await models.SubscriptionPayment.updateOne(
      { paymentId, userId },
      { $set: { status: 'paid', paidAt: new Date() } }
    );
  }

  const user = await models.User.findById(userId);
  if (!user) return null;

  const base =
    user.subscriptionUntil && user.subscriptionUntil.getTime() > Date.now() ? user.subscriptionUntil : new Date();
  user.subscriptionUntil = addDays(base, Math.max(1, Number(months) || 1) * 30);
  await user.save();
  return serializeUser(user);
};

/* ═══════════════════ Admin ═══════════════════ */

const getAdminOverview = async () => {
  const [paidAgg, totalOrders, paidCount, userCount, pendingSubs, setting] = await Promise.all([
    models.Order.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, volume: { $sum: '$payAmount' } } },
    ]),
    models.Order.countDocuments(),
    models.Order.countDocuments({ status: 'paid' }),
    models.User.countDocuments(),
    models.SubscriptionPayment.countDocuments({ status: 'pending' }),
    models.AppSetting.findOne({ key: 'global' }).lean(),
  ]);

  return {
    users: userCount,
    orders: totalOrders,
    paidCount,
    paidVolume: paidAgg[0]?.volume || 0,
    pendingSubscriptions: pendingSubs,
    pricing: setting?.pricing || config.planPrices,
    disabledProviders: setting?.disabledProviders || [],
    announcement: setting?.announcement || '',
  };
};

const listAllSubscriptionPayments = async () => {
  const [docs, users] = await Promise.all([
    models.SubscriptionPayment.find({}).sort({ createdAt: -1 }).limit(50).lean(),
    models.User.find({}).select('_id email').lean(),
  ]);
  const emailByUser = new Map(users.map((u) => [String(u._id), u.email]));
  return docs.map((doc) => ({
    id: doc.paymentId,
    userEmail: emailByUser.get(String(doc.userId)) || '-',
    planMonths: doc.planMonths,
    price: doc.price,
    totalCheckout: doc.totalCheckout,
    status: doc.status,
    orderId: doc.orderId,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    paidAt: doc.paidAt ? doc.paidAt.toISOString() : null,
  }));
};

const updateGlobalSetting = async (patch = {}) =>
  models.AppSetting.findOneAndUpdate(
    { key: 'global' },
    { $set: patch },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

/* ═══════════════════ Kontrak tambahan ═══════════════════ */

module.exports = {
  // user
  getUser,
  getUserById,
  getUserByEmail,
  listUsers,
  findUserByApiKey,
  markApiKeyUsed,

  // settings
  getSettings,
  getSettingsForUser,
  updateSettings,
  updateSettingsForUser,

  // project
  listProjects,
  getProject,
  getProjectForUser,
  createProject,
  renameProject,
  deleteProject,
  rotateApiKey,
  rotateWebhookSecret,
  saveProjectWebhook,

  // qris
  listQris,
  getActiveQris,
  getActiveQrisForUser,
  saveQris,
  saveQrisForUser,
  removeQris,

  // provider
  getProviderConnection,
  connectProvider,
  disconnectProvider,
  testProviderConnection,

  // listener
  listListenerDevices,
  listListenerDevicesForUser,
  getListenerApp,
  getListenerSummary,
  registerListenerDeviceForUser,
  findListenerDeviceByToken,
  recordListenerActivity,
  revokeListenerDeviceForUser,
  ingestListenerPayment,

  // deteksi
  getDetection,
  getDetectionForUser,

  // order
  createOrder,
  createOrderForUser,
  getOrder,
  getOrderForUser,
  cancelOrder,
  cancelOrderForUser,
  listOrders,
  listAllOrders,
  getDashboard,
  getDashboardForUser,

  // publik
  getPublicStats,
  getPayPreview,
  getPlans,

  // langganan
  getSubscription,
  getSubscriptionForUser,
  listSubscriptionPayments,
  listSubscriptionPaymentsForUser,
  createSubscriptionPayment,
  createSubscriptionPaymentForUser,
  activateSubscription,

  // admin
  getAdminOverview,
  listAllSubscriptionPayments,
  updateGlobalSetting,
};
