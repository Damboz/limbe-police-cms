const db = require('../config/db');
const PDFDocument = require('pdfkit');
const { syncCaseInvestigators } = require('../services/assignmentService');


const OVERDUE_DAYS_THRESHOLD = 14;

const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || null;
};


exports.getDashboard = async (req, res, next) => {
    try {

const [[kpiCounts]] = await db.execute(`
            SELECT 
                SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM case_investigators ci WHERE ci.case_id = c.id) AND c.status != 'Closed' THEN 1 ELSE 0 END) AS unassignedCount,
                SUM(CASE WHEN c.requested_status IS NOT NULL THEN 1 ELSE 0 END) AS pendingApprovalsCount,
                SUM(CASE WHEN c.status = 'Under Investigation' THEN 1 ELSE 0 END) AS activeCasesCount,
                SUM(CASE WHEN c.status = 'Under Investigation' AND DATEDIFF(CURDATE(), c.created_at) > ${OVERDUE_DAYS_THRESHOLD} THEN 1 ELSE 0 END) AS overdueCount
            FROM cases c
        `);


        const [unassignedCases] = await db.execute(`
            SELECT 
                c.id, 
                c.ob_number AS case_number, 
                c.incident_details AS title, 
                cc.name AS crime_category, 
                c.priority, 
                c.created_at,
                CONCAT(u.first_name, ' ', u.last_name) AS registered_by_officer
            FROM cases c
            LEFT JOIN crime_categories cc ON c.category_id = cc.id
            LEFT JOIN users u ON c.intake_officer_id = u.id
            WHERE NOT EXISTS (SELECT 1 FROM case_investigators ci WHERE ci.case_id = c.id)
              AND c.status != 'Closed'
            ORDER BY FIELD(c.priority, 'Critical', 'High', 'Medium', 'Low'), c.created_at ASC
            LIMIT 10
        `);


        const [pendingApprovals] = await db.execute(`
            SELECT 
                c.id, 
                c.ob_number AS case_number, 
                c.incident_details AS title, 
                c.requested_status,
                c.status_request_notes,
                c.status_requested_at,
                CONCAT(inv.rank_title, ' ', inv.last_name) AS investigator_name
            FROM cases c
            LEFT JOIN case_investigators cil ON c.id = cil.case_id AND cil.is_lead = 1
            LEFT JOIN users inv ON cil.investigator_id = inv.id
            WHERE c.requested_status IS NOT NULL
            ORDER BY c.status_requested_at ASC
        `);


        const [investigatorWorkload] = await db.execute(`
            SELECT 
                u.id, 
                u.badge_number, 
                u.rank_title, 
                u.first_name, 
                u.last_name,
                COUNT(DISTINCT c.id) AS active_case_count
            FROM users u
            LEFT JOIN case_investigators ci ON u.id = ci.investigator_id
            LEFT JOIN cases c ON ci.case_id = c.id AND c.status = 'Under Investigation'
            WHERE u.role IN ('Investigating Officer', 'investigator') AND u.is_active = 1
            GROUP BY u.id
            ORDER BY active_case_count ASC
        `);


        const [assignedActiveCases] = await db.execute(`
            SELECT 
                c.id, 
                c.ob_number AS case_number, 
                c.incident_details AS title, 
                cc.name AS crime_category, 
                c.priority, 
                c.status, 
                c.created_at,
                DATEDIFF(CURDATE(), c.created_at) AS days_open,
                GROUP_CONCAT(DISTINCT inv.id ORDER BY ci.is_lead DESC, inv.last_name) AS investigator_ids,
                GROUP_CONCAT(DISTINCT CONCAT(inv.rank_title, ' ', inv.first_name, ' ', inv.last_name)
                    ORDER BY ci.is_lead DESC, inv.last_name SEPARATOR ', ') AS investigator_names
            FROM cases c
            LEFT JOIN crime_categories cc ON c.category_id = cc.id
            JOIN case_investigators ci ON c.id = ci.case_id
            LEFT JOIN users inv ON ci.investigator_id = inv.id
            WHERE c.status NOT IN ('Closed', 'Archived')
            GROUP BY c.id
            ORDER BY days_open DESC
            LIMIT 15
        `);

        res.render('supervisor/dashboard', {
            title: 'Supervisor Command Dashboard | Limbe Police CMS',
            kpi: {
                unassigned: kpiCounts.unassignedCount || 0,
                pendingApprovals: kpiCounts.pendingApprovalsCount || 0,
                activeCases: kpiCounts.activeCasesCount || 0,
                overdue: kpiCounts.overdueCount || 0
            },
            overdueDaysThreshold: OVERDUE_DAYS_THRESHOLD,
            unassignedCases,
            pendingApprovals,
            investigatorWorkload,
            assignedActiveCases
        });
    } catch (err) {
        next(err);
    }
};


exports.assignCase = async (req, res, next) => {
    try {
        const { case_id, investigator_ids, notes } = req.body;
        const supervisorId = req.session?.user?.id;
        const callerRole = req.session?.user?.role || '';

        if (!['Station Commander', 'supervisor'].includes(callerRole)) {
            req.flash('error', 'Only Station Commanders can assign cases to investigators.');
            return res.redirect('/supervisor/dashboard');
        }

        const rawIds = Array.isArray(investigator_ids) ? investigator_ids : (investigator_ids ? [investigator_ids] : []);
        const investigatorIds = [...new Set(rawIds.map(v => String(v)).filter(Boolean))];

        if (!case_id || investigatorIds.length === 0) {
            req.flash('error', 'Please select a valid case and at least one investigator.');
            return res.redirect('/supervisor/dashboard');
        }

        const placeholders = investigatorIds.map(() => '?').join(',');
        const [inv] = await db.execute(
            `SELECT id, badge_number, rank_title, first_name, last_name 
             FROM users 
             WHERE id IN (${placeholders}) AND role IN ('Investigating Officer', 'investigator') AND is_active = 1`,
            investigatorIds
        );

        if (inv.length === 0) {
            req.flash('error', 'Selected officers are not active investigators.');
            return res.redirect('/supervisor/dashboard');
        }

        const [caseRows] = await db.execute('SELECT id FROM cases WHERE id = ?', [case_id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case record not found.');
            return res.redirect('/supervisor/dashboard');
        }

        const [existing] = await db.execute(
            'SELECT COUNT(*) AS cnt FROM case_investigators WHERE case_id = ?',
            [case_id]
        );
        const hadPrevious = existing[0].cnt > 0;

        await syncCaseInvestigators(case_id, investigatorIds, supervisorId);

        await db.execute(
            `UPDATE cases 
             SET status = 'Under Investigation', updated_at = NOW() 
             WHERE id = ?`,
            [case_id]
        );

        const officerNames = inv.map(i => `${i.rank_title} ${i.last_name} (${i.badge_number})`).join(', ');

        await db.execute(
            `INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)`,
            [
                supervisorId,
                hadPrevious ? 'CASE_REASSIGNED' : 'CASE_ASSIGNED',
                `${hadPrevious ? 'Updated investigators for' : 'Assigned'} Case ID ${case_id} to Investigator(s): ${officerNames}. ${notes ? 'Note: ' + notes : ''}`,
                getClientIp(req)
            ]
        );

        const shortNames = inv.map(i => i.last_name).join(', ');
        req.flash('success', `Case assigned successfully to Officer(s): ${shortNames}.`);
        res.redirect('/supervisor/dashboard');
    } catch (err) {
        next(err);
    }
};


exports.processStatusApproval = async (req, res, next) => {
    try {
        const { case_id, decision, supervisor_notes } = req.body;
        const supervisorId = req.session?.user?.id;
        const callerRole = req.session?.user?.role || '';

        if (!['Station Commander', 'supervisor'].includes(callerRole)) {
            req.flash('error', 'Only Station Commanders can approve or reject status change requests.');
            return res.redirect('/supervisor/dashboard');
        }

        if (!['APPROVE', 'REJECT'].includes(decision)) {
            req.flash('error', 'Invalid decision provided.');
            return res.redirect('/supervisor/dashboard');
        }

        const [caseRows] = await db.execute('SELECT id, ob_number, requested_status FROM cases WHERE id = ?', [case_id]);
        if (caseRows.length === 0 || !caseRows[0].requested_status) {
            req.flash('error', 'No pending status change request found for this case.');
            return res.redirect('/supervisor/dashboard');
        }

        const currentCase = caseRows[0];

        const targetStatus = decision === 'APPROVE' ? currentCase.requested_status : 'Under Investigation';

        await db.execute(
            `UPDATE cases 
             SET status = ?, requested_status = NULL, status_request_notes = NULL, 
                 status_requested_by = NULL, status_requested_at = NULL, updated_at = NOW() 
             WHERE id = ?`,
            [targetStatus, case_id]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [
                supervisorId,
                `STATUS_APPROVAL_${decision}`,
                `Supervisor ${decision}D status change request for Case OB ${currentCase.ob_number}. New status: ${targetStatus}. ${supervisor_notes ? 'Notes: ' + supervisor_notes : ''}`,
                getClientIp(req)
            ]
        );

        req.flash('success', `Case OB ${currentCase.ob_number} status updated to ${targetStatus}.`);
        res.redirect('/supervisor/dashboard');
    } catch (err) {
        next(err);
    }
};


exports.getAnalytics = async (req, res, next) => {
    try {
        const [
            [monthlyTrends],
            [categoryBreakdown],
            [hotspots],
            [statusDistribution]
        ] = await Promise.all([

            db.execute(`
                SELECT 
                    DATE_FORMAT(created_at, '%Y-%m') AS month_key,
                    DATE_FORMAT(created_at, '%b %Y') AS month_label,
                    COUNT(*) AS total_cases,
                    SUM(CASE WHEN priority IN ('High', 'Critical') THEN 1 ELSE 0 END) AS severe_cases
                FROM cases
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY month_key, month_label
                ORDER BY month_key ASC
            `),


            db.execute(`
                SELECT 
                    cc.name AS crime_category,
                    COUNT(c.id) AS total_incidents,
                    ROUND((COUNT(c.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM cases), 0)), 1) AS percentage
                FROM crime_categories cc
                LEFT JOIN cases c ON cc.id = c.category_id
                GROUP BY cc.id, cc.name
                ORDER BY total_incidents DESC
            `),


            db.execute(`
                SELECT 
                    incident_location AS location,
                    COUNT(*) AS incident_count,
                    SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS resolved_count,
                    SUM(CASE WHEN status = 'Under Investigation' THEN 1 ELSE 0 END) AS active_count
                FROM cases
                WHERE incident_location IS NOT NULL AND TRIM(incident_location) != ''
                GROUP BY incident_location
                ORDER BY incident_count DESC
                LIMIT 10
            `),


            db.execute(`
                SELECT 
                    status,
                    COUNT(*) AS total_count
                FROM cases
                GROUP BY status
            `)
        ]);

        const totalCases = statusDistribution.reduce((acc, curr) => acc + curr.total_count, 0);
        const closedCases = statusDistribution.find(s => s.status === 'Closed')?.total_count || 0;
        const resolutionRate = totalCases > 0 ? Number(((closedCases / totalCases) * 100).toFixed(1)) : 0;

        res.render('supervisor/analytics', {
            title: 'Crime Trend Analytics & Hotspots | Limbe Police CMS',
            monthlyTrends,
            categoryBreakdown,
            hotspots,
            statusDistribution,
            metrics: {
                totalCases,
                closedCases,
                resolutionRate
            }
        });
    } catch (err) {
        next(err);
    }
};


exports.getAnalyticsData = async (req, res, next) => {
    try {
        const [[trends], [categories], [hotspots]] = await Promise.all([
            db.execute(`
                SELECT DATE_FORMAT(created_at, '%b %Y') AS label, COUNT(*) AS count 
                FROM cases 
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
                GROUP BY DATE_FORMAT(created_at, '%Y-%m'), label 
                ORDER BY DATE_FORMAT(created_at, '%Y-%m') ASC
            `),
            db.execute(`
                SELECT cc.name AS label, COUNT(c.id) AS count 
                FROM crime_categories cc
                LEFT JOIN cases c ON cc.id = c.category_id
                GROUP BY cc.id, cc.name
            `),
            db.execute(`
                SELECT incident_location AS label, COUNT(*) AS count 
                FROM cases 
                WHERE incident_location IS NOT NULL AND TRIM(incident_location) != ''
                GROUP BY incident_location 
                ORDER BY count DESC 
                LIMIT 5
            `)
        ]);

        res.json({
            success: true,
            data: { trends, categories, hotspots }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};




function drawReportHeader(doc, reportTitle) {
    doc.fillColor('#0274B0')
        .fontSize(18)
        .text('Limbe Police Station', { align: 'center' });

    doc.fillColor('#1E293B')
        .fontSize(13)
        .text(reportTitle, { align: 'center' });

    doc.fillColor('#64748B')
        .fontSize(9)
        .text(`Generated: ${new Date().toLocaleString('en-GB')}`, { align: 'center' });

    doc.moveDown(0.3);
    doc.strokeColor('#F7C631').lineWidth(2)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
    doc.moveDown(1.2);
}

function drawSectionTitle(doc, text) {
    doc.moveDown(0.5);
    doc.fillColor('#0274B0').fontSize(12).font('Helvetica-Bold').text(text);
    doc.fillColor('#1E293B').font('Helvetica').fontSize(10);
    doc.moveDown(0.3);
}


exports.exportStationPerformancePDF = async (req, res, next) => {
    try {
        const [[totals]] = await db.execute(`
            SELECT 
                COUNT(*) AS totalCases,
                SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closedCases,
                SUM(CASE WHEN status NOT IN ('Closed', 'Archived') THEN 1 ELSE 0 END) AS activeCases,
                SUM(CASE WHEN status = 'Under Investigation' AND DATEDIFF(CURDATE(), created_at) > ${OVERDUE_DAYS_THRESHOLD} THEN 1 ELSE 0 END) AS overdueCases
            FROM cases
        `);

        const [categoryBreakdown] = await db.execute(`
            SELECT cc.name, COUNT(c.id) AS total
            FROM crime_categories cc
            LEFT JOIN cases c ON cc.id = c.category_id
            GROUP BY cc.id, cc.name
            ORDER BY total DESC
        `);

        const [workload] = await db.execute(`
            SELECT u.rank_title, u.first_name, u.last_name, u.badge_number,
                COUNT(DISTINCT c.id) AS active_cases
            FROM users u
            LEFT JOIN case_investigators ci ON u.id = ci.investigator_id
            LEFT JOIN cases c ON ci.case_id = c.id AND c.status = 'Under Investigation'
            WHERE u.role IN ('Investigating Officer', 'investigator') AND u.is_active = 1
            GROUP BY u.id
            ORDER BY active_cases DESC
        `);

        const resolutionRate = totals.totalCases > 0
            ? ((totals.closedCases / totals.totalCases) * 100).toFixed(1)
            : '0.0';

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Station_Performance_Report_${new Date().toISOString().slice(0, 10)}.pdf"`);
        doc.pipe(res);

        drawReportHeader(doc, 'Station Performance Report');

        drawSectionTitle(doc, 'Overview');
        doc.text(`Total Cases Recorded: ${totals.totalCases}`);
        doc.text(`Closed Cases: ${totals.closedCases}`);
        doc.text(`Active Cases: ${totals.activeCases}`);
        doc.text(`Overdue Cases (${OVERDUE_DAYS_THRESHOLD}+ days under investigation): ${totals.overdueCases}`);
        doc.text(`Overall Resolution Rate: ${resolutionRate}%`);

        drawSectionTitle(doc, 'Crime Category Breakdown');
        categoryBreakdown.forEach(c => {
            doc.text(`${c.name}: ${c.total} case(s)`);
        });

        drawSectionTitle(doc, 'Investigator Workload (Active Cases)');
        if (workload.length === 0) {
            doc.text('No active investigators on record.');
        } else {
            workload.forEach(o => {
                doc.text(`${o.rank_title} ${o.first_name} ${o.last_name} (${o.badge_number}) — ${o.active_cases} active case(s)`);
            });
        }

        doc.moveDown(1.5);
        doc.fontSize(8).fillColor('#94A3B8')
            .text('RESTRICTED — OFFICIAL USE ONLY | Malawi Police Service — Limbe Station', { align: 'center' });

        doc.end();
    } catch (err) {
        next(err);
    }
};


exports.exportCrimeStatsPDF = async (req, res, next) => {
    try {
        const [monthlyTrends] = await db.execute(`
            SELECT 
                DATE_FORMAT(created_at, '%b %Y') AS month_label,
                COUNT(*) AS total_cases,
                SUM(CASE WHEN priority IN ('High', 'Critical') THEN 1 ELSE 0 END) AS severe_cases
            FROM cases
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m'), month_label
            ORDER BY DATE_FORMAT(created_at, '%Y-%m') ASC
        `);

        const [hotspots] = await db.execute(`
            SELECT 
                incident_location, 
                COUNT(*) AS incident_count,
                SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS resolved_count
            FROM cases
            WHERE incident_location IS NOT NULL AND TRIM(incident_location) != ''
            GROUP BY incident_location
            ORDER BY incident_count DESC
            LIMIT 10
        `);

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Crime_Statistics_Report_${new Date().toISOString().slice(0, 10)}.pdf"`);
        doc.pipe(res);

        drawReportHeader(doc, 'Monthly Crime Statistics Report');

        drawSectionTitle(doc, 'Monthly Case Volume (Last 12 Months)');
        if (monthlyTrends.length === 0) {
            doc.text('No case data available for the selected period.');
        } else {
            monthlyTrends.forEach(m => {
                doc.text(`${m.month_label}: ${m.total_cases} case(s) — ${m.severe_cases} High/Critical priority`);
            });
        }

        drawSectionTitle(doc, 'Top Incident Hotspots');
        if (hotspots.length === 0) {
            doc.text('No location data available.');
        } else {
            hotspots.forEach((h, i) => {
                doc.text(`${i + 1}. ${h.incident_location} — ${h.incident_count} incident(s), ${h.resolved_count} resolved`);
            });
        }

        doc.moveDown(1.5);
        doc.fontSize(8).fillColor('#94A3B8')
            .text('RESTRICTED — OFFICIAL USE ONLY | Malawi Police Service — Limbe Station', { align: 'center' });

        doc.end();
    } catch (err) {
        next(err);
    }
};


exports.exportOfficerProductivityPDF = async (req, res, next) => {
    try {
        const [officers] = await db.execute(`
            SELECT 
                u.badge_number, u.rank_title, u.first_name, u.last_name,
                COUNT(ci.case_id) AS total_assigned,
                SUM(CASE WHEN c.status = 'Closed' THEN 1 ELSE 0 END) AS total_closed,
                SUM(CASE WHEN c.status = 'Under Investigation' THEN 1 ELSE 0 END) AS total_active
            FROM users u
            LEFT JOIN case_investigators ci ON u.id = ci.investigator_id
            LEFT JOIN cases c ON ci.case_id = c.id
            WHERE u.role IN ('Investigating Officer', 'investigator') AND u.is_active = 1
            GROUP BY u.id
            ORDER BY total_assigned DESC
        `);

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Officer_Productivity_Report_${new Date().toISOString().slice(0, 10)}.pdf"`);
        doc.pipe(res);

        drawReportHeader(doc, 'Officer Productivity Report');

        drawSectionTitle(doc, 'Investigator Case Metrics');
        if (officers.length === 0) {
            doc.text('No active investigators on record.');
        } else {
            officers.forEach(o => {
                const rate = o.total_assigned > 0
                    ? ((o.total_closed / o.total_assigned) * 100).toFixed(1)
                    : '0.0';
                doc.font('Helvetica-Bold').text(`${o.rank_title} ${o.first_name} ${o.last_name} (${o.badge_number})`);
                doc.font('Helvetica').text(
                    `   Total Assigned: ${o.total_assigned}  |  Closed: ${o.total_closed}  |  Active: ${o.total_active}  |  Resolution Rate: ${rate}%`
                );
                doc.moveDown(0.4);
            });
        }

        doc.moveDown(1);
        doc.fontSize(8).fillColor('#94A3B8')
            .text('RESTRICTED — OFFICIAL USE ONLY | Malawi Police Service — Limbe Station', { align: 'center' });

        doc.end();
    } catch (err) {
        next(err);
    }
};