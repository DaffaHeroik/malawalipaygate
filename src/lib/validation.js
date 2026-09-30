'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isEmail = (value) => EMAIL_RE.test(String(value || '').trim());

/** Hanya boleh https + host valid (dipakai webhook & redirect URL). */
const isHttpsUrl = (value, { maxLength = 2048 } = {}) => {
  const raw = String(value || '').trim();
  if (!raw || raw.length > maxLength) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const isHttpUrl = (value, options) => {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && raw.length <= (options?.maxLength ?? 2048);
  } catch {
    return false;
  }
};

const clampInt = (value, { min, max, fallback }) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const trim = (value, maxLength = 255) => String(value ?? '').trim().slice(0, maxLength);

/** Reference order: maksimal 120 karakter sesuai spec API. */
const reference = (value) => trim(value, 120);

const passwordIssues = (password) => {
  const value = String(password || '');
  const issues = [];
  if (value.length < 8) issues.push('Minimal 8 karakter.');
  if (!/[A-Za-z]/.test(value)) issues.push('Harus memuat huruf.');
  if (!/\d/.test(value)) issues.push('Harus memuat angka.');
  return issues;
};

const isStrongPassword = (password) => passwordIssues(password).length === 0;

/** Normalisasi email supaya unik & case-insensitive. */
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/** Inisial untuk avatar: "kizu" -> "K" */
const initials = (name, fallback = '?') => {
  const value = String(name || '').trim();
  if (!value) return fallback;
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
};

module.exports = {
  isEmail,
  isHttpsUrl,
  isHttpUrl,
  clampInt,
  trim,
  reference,
  passwordIssues,
  isStrongPassword,
  normalizeEmail,
  initials,
};
