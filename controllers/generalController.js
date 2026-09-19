const db = require('../config/db');
const { isAssignedInvestigator, getAssignedInvestigators } = require('../services/assignmentService');

const OVERDUE_DAYS_THRESHOLD = 14;

const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || null;
};


exports.getDashboard = async (req, res, next) => {
    try {
        const user = req.session.user;
        const role = user.role;

        if (role === 'Investigating Officer') {
            const [[kpi]] = await db.execute(`
                SELECT 
                    COUNT(DISTINCT c.id) AS totalAssigned,
                    SUM(CASE WHEN c.status = 'Under Investigation' THEN 1 ELSE 0 END) AS activeCount,
                    SUM(CASE WHEN c.status = 'Under Investigation' AND CURRENT_DATE - c.created_at::date > ${OVERDUE_DAYS_THRESHOLD} THEN 1 ELSE 0 END) AS overdueCount,
                    SUM(CASE WHEN c.status = 'Closed' THEN 1 ELSE 0 END) AS closedCount,
                    SUM(CASE WHEN c.requested_status IS NOT NULL THEN 1 ELSE 0 END) AS pendingRequestCount
                FROM cases c
                JOIN case_investigators ci ON c.id = ci.case_id
                WHERE ci.investigator_id = ?
            `, [user.id]);

            const [assignedCases] = await db.execute(`
                SELECT 
                    c.id, c.ob_number, c.incident_details AS title, cc.name AS crime_category,
                    c.priority, c.status, c.requested_status, c.created_at,
                    CURRENT_DATE - c.created_at::date AS days_open
                FROM cases c
                JOIN case_investigators ci ON c.id = ci.case_id
                LEFT JOIN crime_categories cc ON c.category_id = cc.id
                WHERE ci.investigator_id = ?
                GROUP BY c.id, cc.name
                ORDER BY CASE c.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Low' THEN 4 ELSE 5 END, c.created_at ASC
            `, [user.id]);

            return res.render('general/dashboard', {
                title: 'My Cases | Limbe Police CMS',
                role,
                overdueDaysThreshold: OVERDUE_DAYS_THRESHOLD,
                kpi: {
                    totalAssigned: kpi.totalAssigned || 0,
                    active: kpi.activeCount || 0,
                    overdue: kpi.overdueCount || 0,
                    closed: kpi.closedCount || 0,
                    pendingRequest: kpi.pendingRequestCount || 0
                },
                assignedCases
            });
        }


        const [[intakeStats]] = await db.execute(`
            SELECT COUNT(*) AS totalIntake
            FROM cases
            WHERE intake_officer_id = ? AND DATE(created_at) = CURRENT_DATE
        `, [user.id]);

        const [recentIntakes] = await db.execute(`
            SELECT id, ob_number, complainant_name, priority, status, created_at
            FROM cases
            WHERE intake_officer_id = ?
            ORDER BY created_at DESC
            LIMIT 10
        `, [user.id]);

        return res.render('general/dashboard', {
            title: 'Intake Desk | Limbe Police CMS',
            role,
            todayIntakeCount: intakeStats.totalIntake || 0,
            recentIntakes
        });
    } catch (err) {
        next(err);
    }
};


exports.getCaseDetail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const user = req.session.user;

        const [rows] = await db.execute(`
            SELECT 
                c.*,
                cc.name AS crime_category,
                su.name AS unit_name,
                CONCAT(intake.rank_title, ' ', intake.first_name, ' ', intake.last_name) AS intake_officer_name,
                CONCAT(req_user.rank_title, ' ', req_user.first_name, ' ', req_user.last_name) AS status_requested_by_name
            FROM cases c
            LEFT JOIN crime_categories cc ON c.category_id = cc.id
            LEFT JOIN station_units su ON c.unit_id = su.id
            LEFT JOIN users intake ON c.intake_officer_id = intake.id
            LEFT JOIN users req_user ON c.status_requested_by = req_user.id
            WHERE c.id = ?
        `, [id]);

        if (rows.length === 0) {
            req.flash('error', 'Case record not found.');
            return res.redirect('/cases');
        }
        const caseItem = rows[0];

        const investigators = await getAssignedInvestigators(id);
        const assignedInvestigatorIds = investigators.map(inv => inv.id);
        const assignedInvestigatorNames = investigators.map(inv => `${inv.rank_title} ${inv.first_name} ${inv.last_name}`);

        const [notes] = await db.execute(`
            SELECT n.id, n.note, n.created_at, CONCAT(u.rank_title, ' ', u.first_name, ' ', u.last_name) AS officer_name
            FROM case_notes n
            LEFT JOIN users u ON n.officer_id = u.id
            WHERE n.case_id = ?
            ORDER BY n.created_at DESC
        `, [id]);

        const [evidenceItems] = await db.execute(`
            SELECT e.*, CONCAT(u.rank_title, ' ', u.first_name, ' ', u.last_name) AS collected_by_name
            FROM evidence e
            LEFT JOIN users u ON e.collected_by_officer_id = u.id
            WHERE e.case_id = ?
            ORDER BY e.collected_at DESC
        `, [id]);

        const [suspects] = await db.execute(`
            SELECT s.id, s.first_name, s.last_name, s.alias, s.national_id, s.photo_url,
                   s.phone_number, cs.status AS link_status, cs.arrest_date
            FROM case_suspects cs
            JOIN suspects s ON cs.suspect_id = s.id
            WHERE cs.case_id = ?
        `, [id]);

        const [victims] = await db.execute(`
            SELECT id, full_name, phone_number, email, national_id, statement
            FROM victims
            WHERE case_id = ?
        `, [id]);


        const isAssignedInvestigator = user.role === 'Investigating Officer' && assignedInvestigatorIds.includes(user.id);
        const isIntakeOfficer = user.role === 'Counter/Intake Officer';
        const isSupervisor = ['Station Commander', 'Admin'].includes(user.role);

        const permissions = {
            canAddNote: isAssignedInvestigator,
            canRequestStatus: isAssignedInvestigator && !caseItem.requested_status && caseItem.status === 'Under Investigation',
            canAddEvidence: isAssignedInvestigator,
            canLinkSuspectVictim: isAssignedInvestigator || isIntakeOfficer || isSupervisor
        };

        res.render('cases/detail', {
            title: `Case ${caseItem.ob_number} | Limbe Police CMS`,
            caseItem,
            investigators,
            assignedInvestigatorNames,
            notes,
            evidenceItems,
            suspects,
            victims,
            permissions
        });
    } catch (err) {
        next(err);
    }
};


exports.addCaseNote = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { note } = req.body;
        const user = req.session.user;

        if (!note || !note.trim()) {
            req.flash('error', 'Note cannot be empty.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute('SELECT id FROM cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }
        const isAssigned = await isAssignedInvestigator(id, user.id);
        if (user.role !== 'Investigating Officer' || !isAssigned) {
            req.flash('error', 'Only investigators assigned to this case can add notes.');
            return res.redirect(`/cases/${id}`);
        }

        await db.execute(
            'INSERT INTO case_notes (case_id, officer_id, note) VALUES (?, ?, ?)',
            [id, user.id, note.trim()]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'CASE_NOTE_ADDED', `Added investigation note to Case ID ${id}.`, getClientIp(req)]
        );

        req.flash('success', 'Investigation note added.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};


exports.requestStatusChange = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { requested_status, status_request_notes } = req.body;
        const user = req.session.user;

        if (!['Closed', 'Court Pending'].includes(requested_status)) {
            req.flash('error', 'Invalid status request.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute(
            'SELECT status, requested_status FROM cases WHERE id = ?',
            [id]
        );
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }
        const current = caseRows[0];

        const isAssigned = await isAssignedInvestigator(id, user.id);
        if (user.role !== 'Investigating Officer' || !isAssigned) {
            req.flash('error', 'Only investigators assigned to this case can request a status change.');
            return res.redirect(`/cases/${id}`);
        }
        if (current.requested_status) {
            req.flash('error', 'A status change request is already pending supervisor review.');
            return res.redirect(`/cases/${id}`);
        }

        await db.execute(
            `UPDATE cases 
             SET requested_status = ?, status_request_notes = ?, status_requested_by = ?, status_requested_at = NOW() 
             WHERE id = ?`,
            [requested_status, status_request_notes || null, user.id, id]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'STATUS_CHANGE_REQUESTED', `Requested status change to "${requested_status}" for Case ID ${id}.`, getClientIp(req)]
        );

        req.flash('success', 'Status change request submitted for supervisor review.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};


exports.addEvidence = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { item_number, description, category, storage_location, collected_at } = req.body;
        const user = req.session.user;

        const [caseRows] = await db.execute('SELECT id FROM cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }
        const isAssigned = await isAssignedInvestigator(id, user.id);
        if (user.role !== 'Investigating Officer' || !isAssigned) {
            req.flash('error', 'Only investigators assigned to this case can log evidence.');
            return res.redirect(`/cases/${id}`);
        }

        if (!item_number || !description || !storage_location || !collected_at) {
            req.flash('error', 'Please complete all required evidence fields.');
            return res.redirect(`/cases/${id}`);
        }

        await db.execute(
            `INSERT INTO evidence (case_id, item_number, description, category, storage_location, collected_by_officer_id, collected_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'In Locker')`,
            [id, item_number, description, category || 'Physical', storage_location, user.id, collected_at]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'EVIDENCE_LOGGED', `Logged evidence item "${item_number}" for Case ID ${id}.`, getClientIp(req)]
        );

        req.flash('success', 'Evidence item logged successfully.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};


exports.linkSuspect = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { first_name, last_name, alias, national_id, gender, phone_number, photo_url, notes } = req.body;
        const user = req.session.user;

        if (!first_name || !last_name || !gender) {
            req.flash('error', 'Suspect first name, last name, and gender are required.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute('SELECT id FROM cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }

        const isAssigned = await isAssignedInvestigator(id, user.id);
        const allowed = (user.role === 'Investigating Officer' && isAssigned)
            || ['Counter/Intake Officer', 'Station Commander', 'Admin'].includes(user.role);
        if (!allowed) {
            req.flash('error', 'You do not have permission to link suspects to this case.');
            return res.redirect(`/cases/${id}`);
        }

        const [suspectResult] = await db.execute(
            `INSERT INTO suspects (first_name, last_name, alias, national_id, gender, phone_number, photo_url, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [first_name, last_name, alias || null, national_id || null, gender, phone_number || null, photo_url || null, notes || null]
        );

        await db.execute(
            `INSERT INTO case_suspects (case_id, suspect_id, status) VALUES (?, ?, 'Under Investigation')`,
            [id, suspectResult.insertId]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'SUSPECT_LINKED', `Linked suspect "${first_name} ${last_name}" to Case ID ${id}.`, getClientIp(req)]
        );

        req.flash('success', 'Suspect linked to case successfully.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};


exports.linkVictim = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { full_name, phone_number, email, national_id, address, statement } = req.body;
        const user = req.session.user;

        if (!full_name) {
            req.flash('error', 'Victim full name is required.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute('SELECT id FROM cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }

        const isAssigned = await isAssignedInvestigator(id, user.id);
        const allowed = (user.role === 'Investigating Officer' && isAssigned)
            || ['Counter/Intake Officer', 'Station Commander', 'Admin'].includes(user.role);
        if (!allowed) {
            req.flash('error', 'You do not have permission to link victims to this case.');
            return res.redirect(`/cases/${id}`);
        }

        await db.execute(
            `INSERT INTO victims (case_id, full_name, phone_number, email, national_id, address, statement)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, full_name, phone_number || null, email || null, national_id || null, address || null, statement || null]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'VICTIM_LINKED', `Linked victim "${full_name}" to Case ID ${id}.`, getClientIp(req)]
        );

        req.flash('success', 'Victim information added to case.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};