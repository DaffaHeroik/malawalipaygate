'use strict';

const express = require('express');

const data = require('../data');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../lib/asyncHandler');
const validation = require('../lib/validation');

const router = express.Router();

const listView = async (req, res, extra = {}) => {
  const projects = await data.listProjects();
  const aggregate = projects.reduce(
    (acc, project) => ({
      projects: acc.projects + 1,
      transactions: acc.transactions + project.stats.total,
      paid: acc.paid + project.stats.paid,
      volume: acc.volume + project.stats.volume,
    }),
    { projects: 0, transactions: 0, paid: 0, volume: 0 }
  );

  return res.render('pages/app/projects/index', {
    layout: 'layouts/shell',
    pageTitle: 'Projects',
    pageEyebrow: 'Project Monitoring',
    metaDescription: 'Pantau transaksi setiap website, bot, atau aplikasi dari satu tempat.',
    projects,
    aggregate,
    user: req.user,
    ...extra,
  });
};

router.get('/', requireAuth, asyncHandler(async (req, res) => listView(req, res)));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const name = validation.trim(req.body.name, 60);

  if (!name) {
    req.flash('danger', 'Nama project wajib diisi.');
    return res.redirect('/projects');
  }

  const project = await data.createProject(name);
  req.flash('success', `Project "${project.name}" dibuat.`);
  return res.redirect('/projects');
}));

router.post('/:id/rename', requireAuth, asyncHandler(async (req, res) => {
  const name = validation.trim(req.body.name, 60);

  if (!name) {
    req.flash('danger', 'Nama project wajib diisi.');
    return res.redirect('/projects');
  }

  const project = await data.renameProject(req.params.id, name);
  req.flash(project ? 'success' : 'danger', project ? 'Nama project diperbarui.' : 'Project tidak ditemukan.');
  return res.redirect('/projects');
}));

router.post('/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const result = await data.deleteProject(req.params.id);

  if (!result.ok) {
    const message = result.reason === 'default'
      ? 'Project Utama tidak dapat dihapus.'
      : result.reason === 'pending'
        ? 'Project dengan transaksi PENDING tidak dapat dihapus.'
        : 'Project tidak ditemukan.';
    req.flash('danger', message);
  } else {
    req.flash('success', `Project dihapus. Riwayat dipindahkan ke ${result.movedTo}.`);
  }

  return res.redirect('/projects');
}));

module.exports = router;
