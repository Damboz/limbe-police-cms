const express = require('express');
const router = express.Router();
const evidenceController = require('../controllers/evidenceController');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

router.use(isAuthenticated, authorizeRoles('Investigating Officer', 'Station Commander'));

router.get('/', evidenceController.getLedger);

module.exports = router;