const db = require('../config/db');

const EVIDENCE_CATEGORIES = ['Physical', 'Documentary', 'Digital', 'Forensic', 'Weapon', 'Other'];
const VALID_EVIDENCE_STATUSES = ['In Locker', 'Transferred to Lab', 'Presented in Court', 'Returned', 'Disposed'];

exports.getLedger = async (req, res, next) => {
    try {
        const user = req.session.user;
        const isCommander = user.role === 'Station Commander';
        const isAdmin = user.role === 'Admin';

        const filters = {
            status: req.query.status || '',
            category: req.query.category || '',
            q: (req.query.q || '').trim(),
            from: req.query.from || '',
            to: req.query.to || ''
        };

        const scopeConditions = (isCommander || isAdmin) ? [] : ['c.id IN (SELECT ci.case_id FROM case_investigators ci WHERE ci.investigator_id = ?)'];
        const scopeParams = (isCommander || isAdmin) ? [] : [user.id];

        const filterConditions = [];
        const filterParams = [];
        if (filters.status) {
            filterConditions.push('e.status = ?');
            filterParams.push(filters.status);
        }
        if (filters.category) {
            filterConditions.push('e.category = ?');
            filterParams.push(filters.category);
        }
        if (filters.q) {
            filterConditions.push('(e.item_number LIKE ? OR e.description LIKE ? OR e.storage_location LIKE ? OR c.ob_number LIKE ?)');
            const like = `%${filters.q}%`;
            filterParams.push(like, like, like, like);
        }
        if (filters.from) {
            filterConditions.push('DATE(e.collected_at) >= ?');
            filterParams.push(filters.from);
        }
        if (filters.to) {
            filterConditions.push('DATE(e.collected_at) <= ?');
            filterParams.push(filters.to);
        }

        const scopeWhere = ['1=1', ...scopeConditions].filter(Boolean).join(' AND ');
        const fullWhere = ['1=1', ...scopeConditions, ...filterConditions].filter(Boolean).join(' AND ');
        const listParams = [...scopeParams, ...filterParams];

        const [[kpi]] = await db.execute(`
            SELECT 
                COUNT(*) AS totalItems,
                SUM(CASE WHEN e.status = 'In Locker' THEN 1 ELSE 0 END) AS inLocker,
                SUM(CASE WHEN e.status = 'Transferred to Lab' THEN 1 ELSE 0 END) AS transferred,
                SUM(CASE WHEN e.status = 'Presented in Court' THEN 1 ELSE 0 END) AS inCourt,
                SUM(CASE WHEN e.status = 'Returned' THEN 1 ELSE 0 END) AS returned,
                SUM(CASE WHEN e.status = 'Disposed' THEN 1 ELSE 0 END) AS disposed,
                COUNT(DISTINCT e.case_id) AS trackedCases
            FROM evidence e
            JOIN cases c ON e.case_id = c.id
            WHERE ${scopeWhere}
        `, scopeParams);

        const [statusOptions] = await db.execute(`
            SELECT DISTINCT e.status
            FROM evidence e
            JOIN cases c ON e.case_id = c.id
            WHERE ${scopeWhere} AND e.status IS NOT NULL AND e.status != ''
            ORDER BY e.status
        `, scopeParams);

        const [categoryOptions] = await db.execute(`
            SELECT DISTINCT e.category
            FROM evidence e
            JOIN cases c ON e.case_id = c.id
            WHERE ${scopeWhere} AND e.category IS NOT NULL AND e.category != ''
            ORDER BY e.category
        `, scopeParams);

        const [evidenceItems] = await db.execute(`
            SELECT 
                e.id,
                e.case_id,
                e.item_number,
                e.description,
                e.category,
                e.storage_location,
                e.collected_at,
                e.status,
                c.ob_number,
                c.incident_location,
                cc.name AS crime_category,
                CONCAT(u.rank_title, ' ', u.first_name, ' ', u.last_name) AS collected_by_name
            FROM evidence e
            JOIN cases c ON e.case_id = c.id
            LEFT JOIN crime_categories cc ON c.category_id = cc.id
            LEFT JOIN users u ON e.collected_by_officer_id = u.id
            WHERE ${fullWhere}
            ORDER BY e.collected_at DESC
            LIMIT 300
        `, listParams);

        const categories = [...new Set([...EVIDENCE_CATEGORIES, ...categoryOptions.map(o => o.category)])];

        const canUpdateStatus = isCommander || isAdmin;

        res.render('general/evidence', {
            title: 'Evidence Ledger | Limbe Police CMS',
            role: user.role,
            kpi: {
                totalItems: kpi.totalItems || 0,
                inLocker: kpi.inLocker || 0,
                transferred: kpi.transferred || 0,
                inCourt: kpi.inCourt || 0,
                returned: kpi.returned || 0,
                disposed: kpi.disposed || 0,
                trackedCases: kpi.trackedCases || 0
            },
            evidenceItems,
            filters,
            statusOptions,
            categories,
            validStatuses: VALID_EVIDENCE_STATUSES,
            canUpdateStatus
        });
    } catch (err) {
        next(err);
    }
};


exports.updateEvidenceStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { new_status, notes } = req.body;
        const user = req.session.user;

        if (!['Station Commander', 'Admin'].includes(user.role)) {
            req.flash('error', 'Only Supervisors and Administrators can update evidence status.');
            return res.redirect('/evidence');
        }

        if (!VALID_EVIDENCE_STATUSES.includes(new_status)) {
            req.flash('error', 'Invalid evidence status.');
            return res.redirect('/evidence');
        }

        const [evidenceRows] = await db.execute(`
            SELECT e.id, e.item_number, e.status, e.case_id, c.ob_number
            FROM evidence e
            JOIN cases c ON e.case_id = c.id
            WHERE e.id = ?
        `, [id]);

        if (evidenceRows.length === 0) {
            req.flash('error', 'Evidence item not found.');
            return res.redirect('/evidence');
        }

        const evidence = evidenceRows[0];
        const oldStatus = evidence.status;

        await db.execute(
            'UPDATE evidence SET status = ? WHERE id = ?',
            [new_status, id]
        );

        const ip = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || null;
        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [
                user.id,
                'EVIDENCE_STATUS_CHANGED',
                `Evidence item "${evidence.item_number}" (Case OB ${evidence.ob_number}) status changed from "${oldStatus}" to "${new_status}".${notes ? ' Notes: ' + notes : ''}`,
                ip
            ]
        );

        req.flash('success', `Evidence item ${evidence.item_number} status updated to "${new_status}".`);
        res.redirect('/evidence');
    } catch (err) {
        next(err);
    }
};


exports.transferEvidence = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { transfer_to, transfer_notes } = req.body;
        const user = req.session.user;

        if (!['Station Commander', 'Admin'].includes(user.role)) {
            req.flash('error', 'Only Supervisors and Administrators can transfer evidence.');
            return res.redirect('/evidence');
        }

        if (!transfer_to || !transfer_to.trim()) {
            req.flash('error', 'Transfer destination is required.');
            return res.redirect('/evidence');
        }

        const [evidenceRows] = await db.execute(`
            SELECT e.id, e.item_number, e.status, e.storage_location, c.ob_number
            FROM evidence e
            JOIN cases c ON e.case_id = c.id
            WHERE e.id = ?
        `, [id]);

        if (evidenceRows.length === 0) {
            req.flash('error', 'Evidence item not found.');
            return res.redirect('/evidence');
        }

        const evidence = evidenceRows[0];
        const oldLocation = evidence.storage_location;

        await db.execute(
            `UPDATE evidence SET storage_location = ?, status = 'Transferred to Lab' WHERE id = ?`,
            [transfer_to.trim(), id]
        );

        const ip = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || null;
        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [
                user.id,
                'EVIDENCE_TRANSFERRED',
                `Evidence item "${evidence.item_number}" (Case OB ${evidence.ob_number}) transferred from "${oldLocation}" to "${transfer_to.trim()}".${transfer_notes ? ' Notes: ' + transfer_notes : ''}`,
                ip
            ]
        );

        req.flash('success', `Evidence item ${evidence.item_number} transferred to "${transfer_to.trim()}".`);
        res.redirect('/evidence');
    } catch (err) {
        next(err);
    }
};


exports.disposeEvidence = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { disposal_reason } = req.body;
        const user = req.session.user;

        if (!['Station Commander', 'Admin'].includes(user.role)) {
            req.flash('error', 'Only Supervisors and Administrators can dispose evidence.');
            return res.redirect('/evidence');
        }

        if (!disposal_reason || !disposal_reason.trim()) {
            req.flash('error', 'Disposal reason is required for audit purposes.');
            return res.redirect('/evidence');
        }

        const [evidenceRows] = await db.execute(`
            SELECT e.id, e.item_number, e.status, c.ob_number
            FROM evidence e
            JOIN cases c ON e.case_id = c.id
            WHERE e.id = ?
        `, [id]);

        if (evidenceRows.length === 0) {
            req.flash('error', 'Evidence item not found.');
            return res.redirect('/evidence');
        }

        const evidence = evidenceRows[0];

        await db.execute(
            `UPDATE evidence SET status = 'Disposed' WHERE id = ?`,
            [id]
        );

        const ip = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || null;
        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [
                user.id,
                'EVIDENCE_DISPOSED',
                `Evidence item "${evidence.item_number}" (Case OB ${evidence.ob_number}) disposed. Reason: ${disposal_reason.trim()}`,
                ip
            ]
        );

        req.flash('success', `Evidence item ${evidence.item_number} has been disposed.`);
        res.redirect('/evidence');
    } catch (err) {
        next(err);
    }
};
