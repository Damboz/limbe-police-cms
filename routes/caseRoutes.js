const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');
const generalController = require('../controllers/generalController');
const { isAuthenticated } = require('../middleware/authMiddleware');


router.use(isAuthenticated);


router.get('/', caseController.getCaseList);
router.get('/new', caseController.getNewCaseForm);
router.post('/', caseController.createCase);


router.get('/:id', generalController.getCaseDetail);
router.post('/:id/notes', generalController.addCaseNote);
router.post('/:id/request-status', generalController.requestStatusChange);
router.post('/:id/evidence', generalController.addEvidence);
router.post('/:id/suspects', generalController.linkSuspect);
router.post('/:id/victims', generalController.linkVictim);

module.exports = router;