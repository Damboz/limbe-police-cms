const express = require('express');
const router = express.Router();
const evidenceController = require('../controllers/evidenceController');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

router.use(isAuthenticated, authorizeRoles('Investigating Officer', 'Station Commander', 'Admin'));

router.get('/', evidenceController.getLedger);
router.post('/:id/status', evidenceController.updateEvidenceStatus);
router.post('/:id/transfer', evidenceController.transferEvidence);
router.post('/:id/dispose', evidenceController.disposeEvidence);

module.exports = router;