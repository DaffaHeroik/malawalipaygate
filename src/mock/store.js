'use strict';

const dataset = require('./dataset');
const ids = require('../lib/ids');
const { addDays, addMinutes } = require('../lib/datetime');
const constants = require('../config/constants');

/**
 * Store in-memory untuk Fase UI (DATA_SOURCE=mock).
 * Mutasi (bikin project, rotate key, cancel order, dsb) disimpan di memori
 * supaya UI-nya terasa hidup. Reset tiap kali server restart.
 *
 * Semua method di sini adalah "kontrak" yang nanti dipenuhi implementasi DB,
 * jadi route tidak perlu diubah saat pindah ke MongoDB.
 */
class MockStore {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = dataset.build();
  }

  /* ─────────── User & pengaturan ─────────── */

  getUser() {
    return { ...this.state.user };
  }

  getSettings() {
    return { ...this.state.merchantSettings };
  }

  updateSettings(patch = {}) {
    this.state.merchantSettings = { ...this.state.merchantSettings, ...patch };
    if (this.state.merchantSettings.shopeeUniqueEnabled === false) {
      this.state.merchantSettings.shopeeMode = 'hybrid';
    }
    if (this.state.merchantSettings.gopayUniqueEnabled === false) {
      this.state.merchantSettings.gopayMode = 'hybrid';
    }
    return this.getSettings();
  }

  /* ─────────── Projects ─────────── */

  listProjects() {
    return this.state.projects.map((p) => {
      const projectOrders = this.state.orders.filter((o) => o.projectId === p.id);
      const paid = projectOrders.filter((o) => o.status === 'paid');
      return {
        ...p,
        stats: {
          total: projectOrders.length,
          paid: paid.length,
          pending: projectOrders.filter((o) => o.status === 'pending').length,
          volume: paid.reduce((sum, o) => sum + o.payAmount, 0),
        },
      };
    });
  }

  getProject(id) {
    return this.state.projects.find((p) => p.id === id) || null;
  }

  getDefaultProject() {
    return this.state.projects.find((p) => p.isDefault) || this.state.projects[0] || null;
  }

  createProject(name) {
    const project = {
      id: ids.secret(12).slice(0, 24),
      name,
      isDefault: false,
      apiKeyMasked: null,
      hasApiKey: false,
      webhookUrl: '',
      apiKeyLastUsedAt: null,
      apiKeyRotatedAt: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: null,
    };
    this.state.projects.push(project);
    return project;
  }

  renameProject(id, name) {
    const project = this.getProject(id);
    if (!project) return null;
    project.name = name;
    return project;
  }

  deleteProject(id) {
    const project = this.getProject(id);
    if (!project || project.isDefault) return { ok: false, reason: 'default' };
    const pending = this.state.orders.some((o) => o.projectId === id && o.status === 'pending');
    if (pending) return { ok: false, reason: 'pending' };

    const fallback = this.getDefaultProject();
    // riwayat dipindah ke Project Utama
    this.state.orders.forEach((order) => {
      if (order.projectId === id) {
        order.projectId = fallback.id;
        order.project = { id: fallback.id, name: fallback.name };
      }
    });
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    return { ok: true, movedTo: fallback.name };
  }

  /* ─────────── API key ─────────── */

  rotateApiKey(projectId) {
    const project = this.getProject(projectId);
    if (!project) return null;
    const full = ids.apiKey();
    project.apiKeyMasked = `pk_live_${'•'.repeat(12)}${full.slice(-4)}`;
    project.hasApiKey = true;
    project.apiKeyRotatedAt = new Date().toISOString();
    project.apiKeyLastUsedAt = null;
    return { project, fullKey: full };
  }

  /* ─────────── Webhook ─────────── */

  rotateWebhookSecret() {
    const secret = `whsec_${ids.secret(10)}`;
    this.state.merchantSettings.webhookSecret = secret;
    this.state.merchantSettings.webhookSecretRotatedAt = new Date().toISOString();
    return secret;
  }

  saveProjectWebhook(projectId, url) {
    const project = this.getProject(projectId);
    if (!project) return null;
    project.webhookUrl = url;
    return project;
  }

  /* ─────────── QRIS ─────────── */

  listQris() {
    return this.state.qrisAccounts.map((q) => ({ ...q }));
  }

  getActiveQris() {
    const active = this.state.qrisAccounts.find((q) => q.status === 'active');
    return active ? { ...active } : null;
  }

  saveQris({ provider, merchantName, merchantCity, qrisString, imagePath = null, makeActive = true }) {
    if (makeActive) {
      this.state.qrisAccounts.forEach((q) => {
        q.status = 'standby';
      });
    }
    const existing = this.state.qrisAccounts.find((q) => q.provider === provider);
    const isStatic = Boolean(qrisString) && qrisString.length > 40;

    if (existing) {
      Object.assign(existing, {
        provider,
        merchantName,
        merchantCity,
        qrisString,
        imagePath,
        qrisType: isStatic ? 'static' : 'dynamic',
        status: makeActive ? 'active' : existing.status,
      });
      return { ...existing };
    }

    const account = {
      id: `q_${this.state.qrisAccounts.length + 1}`,
      provider,
      merchantName,
      merchantCity,
      qrisString,
      imagePath,
      qrisType: isStatic ? 'static' : 'dynamic',
      status: makeActive ? 'active' : 'standby',
      createdAt: new Date().toISOString(),
    };
    this.state.qrisAccounts.push(account);
    return { ...account };
  }

  removeQris(id) {
    this.state.qrisAccounts = this.state.qrisAccounts.filter((q) => q.id !== id);
  }

  /* ─────────── Koneksi provider ─────────── */

  getProviderConnection(provider) {
    const found = this.state.providerConnections.find((c) => c.provider === provider);
    return found ? { ...found } : null;
  }

  listProviderConnections() {
    return this.state.providerConnections.map((c) => ({ ...c }));
  }

  connectProvider(provider, payload = {}) {
    let conn = this.state.providerConnections.find((c) => c.provider === provider);
    if (!conn) {
      conn = { provider, status: 'disconnected', lastTestAt: null, lastError: null, hasCredential: false };
      this.state.providerConnections.push(conn);
    }
    Object.assign(conn, payload, {
      hasCredential: true,
      lastTestAt: new Date().toISOString(),
      lastError: null,
      connectedAt: conn.connectedAt || new Date().toISOString(),
    });
    return { ...conn };
  }

  disconnectProvider(provider) {
    const conn = this.state.providerConnections.find((c) => c.provider === provider);
    if (!conn) return null;
    Object.assign(conn, {
      status: 'disconnected',
      hasCredential: false,
      lastError: null,
      tokenPreview: null,
      merchantPhone: null,
    });
    return { ...conn };
  }

  testProviderConnection(provider) {
    const conn = this.state.providerConnections.find((c) => c.provider === provider);
    if (!conn) return null;
    conn.lastTestAt = new Date().toISOString();
    if (!conn.hasCredential) {
      conn.status = 'disconnected';
      conn.lastError = 'Kredensial belum diisi.';
    } else {
      conn.status = 'connected';
      conn.lastError = null;
    }
    return { ...conn };
  }

  /* ─────────── Listener ─────────── */

  listListenerDevices() {
    return this.state.listenerDevices.map((d) => ({ ...d }));
  }

  getListenerApp() {
    return { ...this.state.listenerApp };
  }

  getListenerSummary() {
    const devices = this.listListenerDevices();
    const detection = this.getDetection();
    return {
      connected: devices.length > 0,
      deviceCount: devices.length,
      qrisProvider: detection.provider,
      qrisProviderLabel: detection.providerLabel,
      detection,
      sourceCount: new Set(devices.flatMap((d) => d.enabledSources)).size,
    };
  }

  /* Parity kontrak dengan DbStore (mode mock tidak melayani REST API). */

  registerListenerDeviceForUser(_userId, payload = {}) {
    return { device: { ...payload, deviceId: payload.deviceId }, token: null, tokenPreview: null };
  }

  listListenerDevicesForUser() {
    return this.listListenerDevices();
  }

  findListenerDeviceByToken() {
    return null;
  }

  recordListenerActivity() {}

  revokeListenerDeviceForUser(_userId, deviceId) {
    const before = this.state.listenerDevices.length;
    this.state.listenerDevices = this.state.listenerDevices.filter((d) => d.deviceId !== deviceId);
    return this.state.listenerDevices.length < before;
  }

  ingestListenerPayment() {
    return { matched: false, reason: 'mock_mode' };
  }

  /* ─────────── Order ─────────── */

  listOrders({ status = 'all', projectId = null, page = 1, perPage = 10, q = '' } = {}) {
    let rows = [...this.state.orders];
    if (status && status !== 'all') rows = rows.filter((o) => o.status === status);
    if (projectId) rows = rows.filter((o) => o.projectId === projectId);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (o) =>
          o.id.toLowerCase().includes(needle) ||
          String(o.reference || '').toLowerCase().includes(needle)
      );
    }
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const current = Math.min(Math.max(1, page), pages);
    const start = (current - 1) * perPage;

    return {
      rows: rows.slice(start, start + perPage).map((o) => ({ ...o })),
      pagination: {
        total,
        page: current,
        pages,
        perPage,
        from: total === 0 ? 0 : start + 1,
        to: Math.min(start + perPage, total),
      },
    };
  }

  getOrder(id) {
    const found = this.state.orders.find((o) => o.id === id);
    return found ? { ...found } : null;
  }

  cancelOrder(id) {
    const order = this.state.orders.find((o) => o.id === id);
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status !== 'pending') return { ok: false, reason: 'not_pending' };
    order.status = 'cancelled';
    order.cancelledAt = new Date().toISOString();
    return { ok: true, order };
  }

  createOrder({ projectId, baseAmount, reference, ttlMinutes = 10 }) {
    const project = this.getProject(projectId) || this.getDefaultProject();
    const settings = this.getSettings();
    const feeAmount = 0;
    let uniqueCode = 0;

    // Mode Hybrid: mulai dari nominal asli, tambah minimum kalau bentrok
    let payAmount = baseAmount + feeAmount + uniqueCode;
    const taken = new Set(
      this.state.orders
        .filter((o) => o.status === 'pending')
        .map((o) => o.payAmount)
    );
    while (taken.has(payAmount)) {
      uniqueCode += 1;
      payAmount = baseAmount + feeAmount + uniqueCode;
    }

    const now = new Date();
    const order = {
      id: ids.orderId(),
      project: { id: project.id, name: project.name },
      projectId: project.id,
      reference: reference || null,
      redirectUrl: settings.redirectUrl || null,
      webhookUrl: null,
      mode: 'live',
      provider: this.getActiveQris()?.provider || 'shopee',
      baseAmount,
      feePercent: settings.feePercent,
      feeAmount,
      uniqueCode,
      payAmount,
      status: 'pending',
      qris: this.getActiveQris()?.qrisString || '',
      checkoutUrl: '',
      ttlSeconds: ttlMinutes * 60,
      createdAt: now.toISOString(),
      expiresAt: addMinutes(now, ttlMinutes).toISOString(),
      paidAt: null,
      cancelledAt: null,
      matchedTransaction: null,
      webhookDeliveries: [],
    };
    order.checkoutUrl = `/pay/${order.id}`;
    this.state.orders.unshift(order);
    if (project) project.lastActivityAt = order.createdAt;
    return { ...order };
  }

  /* ─────────── Dashboard ─────────── */

  getStatusCounts() {
    const counts = { all: this.state.orders.length };
    constants.ORDER_STATUS_LIST.forEach((status) => {
      counts[status] = this.state.orders.filter((o) => o.status === status).length;
    });
    return counts;
  }

  getDashboard({ status = 'all', page = 1 } = {}) {
    const listing = this.listOrders({ status, page, perPage: 10 });
    const paid = this.state.orders.filter((o) => o.status === 'paid');
    return {
      stats: {
        total: this.state.orders.length,
        paid: paid.length,
        pending: this.state.orders.filter((o) => o.status === 'pending').length,
        revenue: paid.reduce((sum, o) => sum + o.payAmount, 0),
      },
      series: this.state.series.map((d) => ({ ...d })),
      seriesTotals: {
        total: this.state.series.reduce((s, d) => s + d.total, 0),
        paid: this.state.series.reduce((s, d) => s + d.paid, 0),
        revenue: paid
          .filter((o) => new Date(o.createdAt).getTime() > Date.now() - 14 * 86400000)
          .reduce((sum, o) => sum + o.payAmount, 0),
      },
      ...listing,
      statusCounts: this.getStatusCounts(),
    };
  }

  /* ─────────── Langganan ─────────── */

  getSubscription() {
    const sub = this.state.subscription;
    const until = sub.until ? new Date(sub.until) : null;
    return {
      ...sub,
      until,
      daysLeft: until ? Math.max(0, Math.ceil((until.getTime() - Date.now()) / 86400000)) : 0,
    };
  }

  listSubscriptionPayments() {
    return this.state.subscriptionPayments.map((p) => ({ ...p }));
  }

  createSubscriptionPayment(months) {
    const plan = constants.PLANS.find((p) => p.months === months) || constants.PLANS[0];
    const payment = {
      id: `sub_${ids.secret(6)}`,
      planMonths: plan.months,
      price: plan.price,
      totalCheckout: plan.price,
      status: 'pending',
      orderId: null,
      createdAt: new Date().toISOString(),
      paidAt: null,
    };
    this.state.subscriptionPayments.unshift(payment);
    return payment;
  }

  /* ─────────── Deteksi pembayaran ─────────── */

  getDetection() {
    const shopee = this.getProviderConnection('shopee');
    const gopay = this.getProviderConnection('gopay');
    const active = this.getActiveQris();
    const provider = active ? active.provider : null;
    const connection = provider === 'shopee' ? shopee : provider === 'gopay' ? gopay : null;

    const merchantConnected = connection?.status === 'connected';
    const listenerReady = Boolean(
      provider &&
        this.state.listenerDevices.some(
          (d) => d.notificationAccess && d.enabledSources.includes(provider)
        )
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
  }

  /* ─────────── Publik ─────────── */

  getPublicStats() {
    return { ...this.state.publicStats };
  }

  getPayPage(orderId) {
    const order = this.getOrder(orderId);
    if (order) return order;
    // fallback: halaman checkout tetap bisa dipreview walau id nggak ketemu
    const first = this.state.orders[0];
    return first ? { ...first, id: orderId, checkoutUrl: `/pay/${orderId}` } : null;
  }

  /** Data preview checkout dengan status yang dipaksa (buat demo UI). */
  getPayPreview(orderId, forcedState) {
    const order = this.getPayPage(orderId);
    if (!order) return null;
    if (!forcedState) return order;

    const map = { paid: 'paid', pending: 'pending', expired: 'expired', cancelled: 'cancelled' };
    const status = map[forcedState] || order.status;
    return {
      ...order,
      status,
      paidAt: status === 'paid' ? addMinutes(new Date(order.createdAt), 7).toISOString() : null,
    };
  }

  /* ─────────── NFC / util ─────────── */

  getPlans() {
    return constants.PLANS.map((p) => ({ ...p }));
  }

  getSeriesWithWindow(days = 14) {
    return this.state.series.slice(-days).map((d) => ({ ...d }));
  }

  touch() {
    this.state.user.lastLoginAt = new Date().toISOString();
  }

  /** Dipakai halaman profil biar tanggal bergabungnya masuk akal. */
  subscriptionEndLabel() {
    const sub = this.getSubscription();
    return sub.until ? addDays(sub.until, 0) : null;
  }
}

module.exports = new MockStore();
