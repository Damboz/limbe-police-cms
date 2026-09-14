const db = require('../config/db');

const EVIDENCE_CATEGORIES = ['Physical', 'Documentary', 'Digital', 'Forensic', 'Weapon', 'Other'];

exports.getLedger = async (req, res, next) => {
    try {
        const user = req.session.user;
        const isCommander = user.role === 'Station Commander';

        const filters = {
            status: req.query.status || '',
            category: req.query.category || '',
            q: (req.query.q || '').trim(),
            from: req.query.from || '',
            to: req.query.to || ''
        };

        const scopeConditions = isCommander ? [] : ['c.assigned_officer_id = ?'];
        const scopeParams = isCommander ? [] : [user.id];

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
                SUM(CASE WHEN e.status = 'Released' THEN 1 ELSE 0 END) AS released,
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

        res.render('general/evidence', {
            title: 'Evidence Ledger | Limbe Police CMS',
            role: user.role,
            kpi: {
                totalItems: kpi.totalItems || 0,
                inLocker: kpi.inLocker || 0,
                released: kpi.released || 0,
                trackedCases: kpi.trackedCases || 0
            },
            evidenceItems,
            filters,
            statusOptions,
            categories
        });
    } catch (err) {
        next(err);
    }
};