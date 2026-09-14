const express = require('express');
const router = express.Router();


const adminController = require('../controllers/adminController');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');


router.use(isAuthenticated, isAdmin);


router.get('/dashboard', adminController.getAdminDashboard);


router.get('/users', adminController.getUsers);
router.get('/users/create', adminController.getCreateUser);
router.post('/users/create', adminController.postCreateUser);


router.get('/users/:id/edit', adminController.getEditUser);
router.post('/users/:id/edit', adminController.postEditUser);


router.post('/users/:id/reset-password', adminController.postResetPassword);


router.post('/users/:id/toggle-status', adminController.toggleUserStatus);


router.get('/audit-logs', adminController.getAuditLogs);

module.exports = router;