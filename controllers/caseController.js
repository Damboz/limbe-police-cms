const db = require('../config/db');


async function generateObNumber() {
    const today = new Date();
    const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');

    const [[{ todayCount }]] = await db.execute(
        `SELECT COUNT(*) AS todayCount FROM cases WHERE DATE(created_at) = CURDATE()`
    );

    const sequence = String(todayCount + 1).padStart(4, '0');
    return `OB-${datePart}-${sequence}`;
}


exports.getCaseList = async (req, res, next) => {
    try {
        const user = req.session.user;
        const role = user.role;

        let query;
        let params = [];

        if (role === 'Investigating Officer') {
            query = `
                SELECT 
                    c.id, c.ob_number, c.complainant_name, c.priority, c.status, c.created_at,
                    cc.name AS crime_category,
                    su.name AS unit_name,
                    CONCAT(intake.rank_title, ' ', intake.first_name, ' ', intake.last_name) AS intake_officer_name,
                    assigned.id AS assigned_officer_id,
                    CONCAT(assigned.rank_title, ' ', assigned.first_name, ' ', assigned.last_name) AS assigned_officer_name
                FROM cases c
                LEFT JOIN crime_categories cc ON c.category_id = cc.id
                LEFT JOIN station_units su ON c.unit_id = su.id
                LEFT JOIN users intake ON c.intake_officer_id = intake.id
                LEFT JOIN users assigned ON c.assigned_officer_id = assigned.id
                WHERE c.assigned_officer_id = ?
                ORDER BY c.created_at DESC
            `;
            params = [user.id];
        } else {
            query = `
                SELECT 
                    c.id, c.ob_number, c.complainant_name, c.priority, c.status, c.created_at,
                    cc.name AS crime_category,
                    su.name AS unit_name,
                    CONCAT(intake.rank_title, ' ', intake.first_name, ' ', intake.last_name) AS intake_officer_name,
                    assigned.id AS assigned_officer_id,
                    CONCAT(assigned.rank_title, ' ', assigned.first_name, ' ', assigned.last_name) AS assigned_officer_name
                FROM cases c
                LEFT JOIN crime_categories cc ON c.category_id = cc.id
                LEFT JOIN station_units su ON c.unit_id = su.id
                LEFT JOIN users intake ON c.intake_officer_id = intake.id
                LEFT JOIN users assigned ON c.assigned_officer_id = assigned.id
                ORDER BY c.created_at DESC
            `;
        }

        const [cases] = await db.execute(query, params);

        res.render('cases/index', {
            title: 'Case Register | Limbe Police CMS',
            cases
        });
    } catch (err) {
        next(err);
    }
};


exports.getNewCaseForm = async (req, res, next) => {
    try {
        const [categories] = await db.execute('SELECT id, name, severity_level FROM crime_categories ORDER BY name ASC');
        const [units] = await db.execute('SELECT id, code, name FROM station_units ORDER BY name ASC');

        res.render('cases/register', {
            title: 'Register New Case | Limbe Police CMS',
            categories,
            units
        });
    } catch (err) {
        next(err);
    }
};


exports.createCase = async (req, res, next) => {
    try {
        const {
            complainant_name,
            complainant_id_number,
            complainant_phone,
            complainant_address,
            complainant_gender,
            category_id,
            unit_id,
            priority,
            incident_datetime,
            incident_location,
            incident_details,
            suspect_first_name,
            suspect_last_name,
            suspect_alias,
            suspect_gender,
            suspect_national_id,
            suspect_phone_number,
            suspect_address
        } = req.body;

        const intakeOfficerId = req.session?.user?.id;


        if (!complainant_name || !complainant_phone || !category_id || !unit_id || !incident_location || !incident_details) {
            req.flash('error', 'Please complete all required fields before submitting.');
            return res.redirect('/cases/new');
        }

        const suspectFirstName = (suspect_first_name || '').trim();
        const suspectLastName = (suspect_last_name || '').trim();
        const suspectSectionUsed = suspectFirstName || suspectLastName || suspect_alias ||
            suspect_gender || suspect_national_id || suspect_phone_number || suspect_address;

        if (suspectSectionUsed && (!suspectFirstName || !suspectLastName)) {
            req.flash('error', 'To add a suspect, please provide both the first name and last name (or leave the suspect section blank).');
            return res.redirect('/cases/new');
        }

        const obNumber = await generateObNumber();

        const [caseResult] = await db.execute(
            `INSERT INTO cases (
                ob_number, complainant_name, complainant_id_number, complainant_phone,
                complainant_address, complainant_gender, category_id, unit_id, priority,
                incident_datetime, incident_location, incident_details, intake_officer_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Reported')`,
            [
                obNumber,
                complainant_name,
                complainant_id_number || null,
                complainant_phone,
                complainant_address || null,
                complainant_gender || 'Other',
                category_id,
                unit_id,
                priority || 'Medium',
                incident_datetime || null,
                incident_location,
                incident_details,
                intakeOfficerId
            ]
        );

        const ip = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || null;

        let suspectName = null;
        if (suspectSectionUsed) {
            const [suspectResult] = await db.execute(
                `INSERT INTO suspects (first_name, last_name, alias, national_id, gender, phone_number, address)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    suspectFirstName,
                    suspectLastName,
                    suspect_alias ? String(suspect_alias).trim() || null : null,
                    suspect_national_id ? String(suspect_national_id).trim() || null : null,
                    suspect_gender || 'Other',
                    suspect_phone_number ? String(suspect_phone_number).trim() || null : null,
                    suspect_address ? String(suspect_address).trim() || null : null
                ]
            );

            await db.execute(
                `INSERT INTO case_suspects (case_id, suspect_id, status) VALUES (?, ?, 'Under Investigation')`,
                [caseResult.insertId, suspectResult.insertId]
            );

            suspectName = `${suspectFirstName} ${suspectLastName}`;
            await db.execute(
                'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
                [intakeOfficerId, 'SUSPECT_LINKED', `Linked suspect "${suspectName}" to Case OB ${obNumber} during intake.`, ip]
            );
        }

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [intakeOfficerId, 'CASE_REGISTERED', `Registered new Case OB ${obNumber} for complainant ${complainant_name}.`, ip]
        );

        if (suspectName) {
            req.flash('success', `Case registered successfully with reference ${obNumber}. Suspect "${suspectName}" was added — you can now generate an invitation letter for him/her.`);
        } else {
            req.flash('success', `Case registered successfully with reference ${obNumber}.`);
        }
        res.redirect(`/cases/${caseResult.insertId}`);
    } catch (err) {
        next(err);
    }
};


exports.smartSearch = async (req, res, next) => {
    try {
        const query = (req.query.q || '').trim();
        const searchType = req.query.type || 'all';
        let results = [];

        if (query.length >= 2) {
            const like = `%${query}%`;

            if (searchType === 'all' || searchType === 'national_id') {
                const [casesByComplainantId] = await db.execute(`
                    SELECT c.id, c.ob_number, c.complainant_name, c.complainant_id_number,
                           c.priority, c.status, c.created_at, cc.name AS crime_category
                    FROM cases c
                    LEFT JOIN crime_categories cc ON c.category_id = cc.id
                    WHERE c.complainant_id_number LIKE ?
                    ORDER BY c.created_at DESC LIMIT 20
                `, [like]);
                results.push(...casesByComplainantId.map(r => ({ ...r, match_type: 'Complainant National ID' })));
            }

            if (searchType === 'all' || searchType === 'phone') {
                const [casesByPhone] = await db.execute(`
                    SELECT c.id, c.ob_number, c.complainant_name, c.complainant_phone,
                           c.priority, c.status, c.created_at, cc.name AS crime_category
                    FROM cases c
                    LEFT JOIN crime_categories cc ON c.category_id = cc.id
                    WHERE c.complainant_phone LIKE ?
                    ORDER BY c.created_at DESC LIMIT 20
                `, [like]);
                results.push(...casesByPhone.map(r => ({ ...r, match_type: 'Phone Number' })));
            }

            if (searchType === 'all' || searchType === 'suspect') {
                const [suspectCases] = await db.execute(`
                    SELECT c.id, c.ob_number, c.complainant_name, c.priority, c.status, c.created_at,
                           cc.name AS crime_category,
                           CONCAT(s.first_name, ' ', s.last_name) AS suspect_name,
                           s.national_id AS suspect_national_id
                    FROM cases c
                    JOIN case_suspects cs ON c.id = cs.case_id
                    JOIN suspects s ON cs.suspect_id = s.id
                    LEFT JOIN crime_categories cc ON c.category_id = cc.id
                    WHERE s.first_name LIKE ? OR s.last_name LIKE ? OR s.national_id LIKE ? OR s.alias LIKE ?
                    ORDER BY c.created_at DESC LIMIT 20
                `, [like, like, like, like]);
                results.push(...suspectCases.map(r => ({ ...r, match_type: 'Suspect Name/ID' })));
            }

            if (searchType === 'all' || searchType === 'victim') {
                const [victimCases] = await db.execute(`
                    SELECT c.id, c.ob_number, c.complainant_name, c.priority, c.status, c.created_at,
                           cc.name AS crime_category,
                           v.full_name AS victim_name,
                           v.national_id AS victim_national_id
                    FROM cases c
                    JOIN victims v ON c.id = v.case_id
                    LEFT JOIN crime_categories cc ON c.category_id = cc.id
                    WHERE v.full_name LIKE ? OR v.national_id LIKE ?
                    ORDER BY c.created_at DESC LIMIT 20
                `, [like, like]);
                results.push(...victimCases.map(r => ({ ...r, match_type: 'Victim Name/ID' })));
            }

            const seen = new Set();
            results = results.filter(r => {
                const key = `${r.id}-${r.match_type}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        res.render('cases/search', {
            title: 'Smart Search | Limbe Police CMS',
            results,
            query,
            searchType
        });
    } catch (err) {
        next(err);
    }
};