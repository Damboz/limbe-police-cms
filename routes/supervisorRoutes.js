const express = require('express');
const router = express.Router();
const supervisorController = require('../controllers/supervisorController');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');


router.use(isAuthenticated, authorizeRoles('Station Commander', 'Admin'));


router.get('/dashboard', supervisorController.getDashboard);
router.post('/cases/assign', supervisorController.assignCase);
router.post('/cases/approve-status', supervisorController.processStatusApproval);


router.get('/analytics', supervisorController.getAnalytics);
router.get('/api/analytics-data', supervisorController.getAnalyticsData);


router.get('/reports/station-performance', supervisorController.exportStationPerformancePDF);
router.get('/reports/crime-statistics', supervisorController.exportCrimeStatsPDF);
router.get('/reports/officer-productivity', supervisorController.exportOfficerProductivityPDF);

module.exports = router;