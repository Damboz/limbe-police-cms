const db = require('../config/db');
const bcrypt = require('bcryptjs');


const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || null;
};


const getRoleMapping = (roleInput) => {
    const input = (roleInput || '').toString().toLowerCase().trim();

    switch (input) {
        case 'admin':
            return { role: 'Admin', role_id: 1 };
        case 'station commander':
        case 'supervisor':
            return { role: 'Station Commander', role_id: 2 };
        case 'investigating officer':
        case 'investigator':
            return { role: 'Investigating Officer', role_id: 3 };
        case 'counter/intake officer':
        case 'officer':
        default:
            return { role: 'Counter/Intake Officer', role_id: 4 };
    }
};


exports.getAdminDashboard = async (req, res, next) => {
    try {
        const [[{ totalUsers }]] = await db.execute('SELECT COUNT(*) AS totalUsers FROM users');
        const [[{ activeUsers }]] = await db.execute('SELECT COUNT(*) AS activeUsers FROM users WHERE is_active = 1');
        const [[{ totalLogins }]] = await db.execute('SELECT COUNT(*) AS totalLogins FROM audit_logs WHERE action = "USER_LOGIN"');

        const [[caseStats]] = await db.execute(`
            SELECT 
                COUNT(*) AS totalCases,
                SUM(CASE WHEN status = 'Reported' THEN 1 ELSE 0 END) AS reportedCount,
                SUM(CASE WHEN status = 'Under Investigation' THEN 1 ELSE 0 END) AS underInvestigation,
                SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closedCount,
                SUM(CASE WHEN status = 'Court Pending' THEN 1 ELSE 0 END) AS courtPending,
                SUM(CASE WHEN assigned_officer_id IS NULL THEN 1 ELSE 0 END) AS unassignedCount
            FROM cases
        `);

        const [[evidenceStats]] = await db.execute(`
            SELECT 
                COUNT(*) AS totalEvidence,
                SUM(CASE WHEN status = 'In Locker' THEN 1 ELSE 0 END) AS inLocker,
                SUM(CASE WHEN status = 'Disposed' THEN 1 ELSE 0 END) AS disposed
            FROM evidence
        `);

        const [users] = await db.execute(`
            SELECT id, badge_number, rank_title, first_name, last_name, email, role, role_id, is_active 
            FROM users 
            ORDER BY created_at DESC 
            LIMIT 5
        `);

        const [recentLogs] = await db.execute(`
            SELECT a.*, u.badge_number, u.first_name, u.last_name 
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC 
            LIMIT 10
        `);

        res.render('admin/dashboard', {
            title: 'Admin Dashboard | Limbe Police CMS',
            stats: { totalUsers, activeUsers, totalLogins },
            caseStats: {
                totalCases: caseStats.totalCases || 0,
                reported: caseStats.reportedCount || 0,
                underInvestigation: caseStats.underInvestigation || 0,
                closed: caseStats.closedCount || 0,
                courtPending: caseStats.courtPending || 0,
                unassigned: caseStats.unassignedCount || 0
            },
            evidenceStats: {
                totalEvidence: evidenceStats.totalEvidence || 0,
                inLocker: evidenceStats.inLocker || 0,
                disposed: evidenceStats.disposed || 0
            },
            users,
            recentLogs,
            success: req.flash ? req.flash('success') : null,
            error: req.flash ? req.flash('error') : null
        });
    } catch (err) {
        next(err);
    }
};


exports.getUsers = async (req, res, next) => {
    try {
        const search = req.query.search ? `%${req.query.search.trim()}%` : '%';
        const roleFilter = req.query.role || '';

        let query = `
            SELECT u.id, u.badge_number, u.rank_title, u.first_name, u.last_name, u.email, 
                   u.role, u.role_id, u.phone_number, u.is_active, u.created_at,
                   su.name AS unit_name
            FROM users u
            LEFT JOIN station_units su ON u.unit_id = su.id
            WHERE (u.badge_number LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)
        `;
        let params = [search, search, search, search];

        if (roleFilter) {
            query += ` AND u.role_id = ?`;
            params.push(roleFilter);
        }

        query += ` ORDER BY u.created_at DESC`;

        const [users] = await db.execute(query, params);

        res.render('admin/users/index', {
            title: 'User Management | Limbe Police CMS',
            users,
            searchQuery: req.query.search || '',
            roleFilter,
            success: req.flash ? req.flash('success') : null,
            error: req.flash ? req.flash('error') : null
        });
    } catch (err) {
        next(err);
    }
};


exports.getCreateUser = async (req, res, next) => {
    try {
        const [roles] = await db.execute('SELECT * FROM roles ORDER BY id ASC');
        const [units] = await db.execute('SELECT * FROM station_units ORDER BY name ASC');

        res.render('admin/users/create', {
            title: 'Register Personnel | Limbe Police CMS',
            roles,
            units,
            error: null,
            formData: {}
        });
    } catch (err) {
        next(err);
    }
};


exports.postCreateUser = async (req, res, next) => {
    try {
        const { badge_number, rank_title, first_name, last_name, email, phone_number, role, unit_id, password } = req.body;

        const [roles] = await db.execute('SELECT * FROM roles ORDER BY id ASC');
        const [units] = await db.execute('SELECT * FROM station_units ORDER BY name ASC');

        if (!badge_number || !first_name || !last_name || !email || !role || !password) {
            return res.render('admin/users/create', {
                title: 'Register Personnel | Limbe Police CMS',
                roles,
                units,
                error: 'Please complete all required fields.',
                formData: req.body
            });
        }

        const [existing] = await db.execute(
            'SELECT id FROM users WHERE badge_number = ? OR email = ?',
            [badge_number.trim(), email.trim().toLowerCase()]
        );

        if (existing.length > 0) {
            return res.render('admin/users/create', {
                title: 'Register Personnel | Limbe Police CMS',
                roles,
                units,
                error: 'An officer with this Badge Number or Email already exists.',
                formData: req.body
            });
        }


        const roleMap = getRoleMapping(role);
        const hashedPassword = await bcrypt.hash(password, 10);
        const parsedUnitId = unit_id ? parseInt(unit_id, 10) : null;

        await db.execute(`
            INSERT INTO users (
                badge_number, rank_title, first_name, last_name, email, 
                phone_number, role, role_id, unit_id, password_hash, is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
            badge_number.trim(),
            rank_title ? rank_title.trim() : null,
            first_name.trim(),
            last_name.trim(),
            email.trim().toLowerCase(),
            phone_number ? phone_number.trim() : null,
            roleMap.role,
            roleMap.role_id,
            parsedUnitId,
            hashedPassword
        ]);

        const adminId = (req.session && req.session.user) ? req.session.user.id : (req.user ? req.user.id : null);

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [adminId, 'USER_CREATED', `Created user ${badge_number.trim()} with role ${roleMap.role} (Role ID: ${roleMap.role_id})`, getClientIp(req)]
        );

        if (req.flash) {
            req.flash('success', `Officer ${first_name.trim()} ${last_name.trim()} (${badge_number.trim()}) registered successfully.`);
        }

        res.redirect('/admin/users');
    } catch (err) {
        next(err);
    }
};


exports.getEditUser = async (req, res, next) => {
    try {
        const userId = req.params.id;
        const [users] = await db.execute(
            'SELECT id, badge_number, rank_title, first_name, last_name, email, phone_number, role, role_id, unit_id, is_active FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            if (req.flash) req.flash('error', 'User account not found.');
            return res.redirect('/admin/users');
        }

        const [roles] = await db.execute('SELECT * FROM roles ORDER BY id ASC');
        const [units] = await db.execute('SELECT * FROM station_units ORDER BY name ASC');

        res.render('admin/users/edit', {
            title: 'Edit Officer Profile | Limbe Police CMS',
            userToEdit: users[0],
            roles,
            units,
            success: req.flash ? req.flash('success') : null,
            error: req.flash ? req.flash('error') : null
        });
    } catch (err) {
        next(err);
    }
};


exports.postEditUser = async (req, res, next) => {
    try {
        const userId = req.params.id;
        const { rank_title, first_name, last_name, email, phone_number, role, unit_id } = req.body;

        if (!first_name || !last_name || !email || !role) {
            if (req.flash) req.flash('error', 'First Name, Last Name, Email, and Role are required fields.');
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ? AND id != ?',
            [email.trim().toLowerCase(), userId]
        );

        if (existing.length > 0) {
            if (req.flash) req.flash('error', 'The provided email is already registered to another account.');
            return res.redirect(`/admin/users/${userId}/edit`);
        }


        const roleMap = getRoleMapping(role);
        const parsedUnitId = unit_id ? parseInt(unit_id, 10) : null;

        await db.execute(`
            UPDATE users 
            SET rank_title = ?, first_name = ?, last_name = ?, email = ?, phone_number = ?, role = ?, role_id = ?, unit_id = ?
            WHERE id = ?
        `, [
            rank_title ? rank_title.trim() : null,
            first_name.trim(),
            last_name.trim(),
            email.trim().toLowerCase(),
            phone_number ? phone_number.trim() : null,
            roleMap.role,
            roleMap.role_id,
            parsedUnitId,
            userId
        ]);

        const adminId = (req.session && req.session.user) ? req.session.user.id : (req.user ? req.user.id : null);

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [adminId, 'USER_UPDATED', `Updated details for User ID ${userId} (${first_name} ${last_name}). Assigned Role: ${roleMap.role}`, getClientIp(req)]
        );

        if (req.flash) {
            req.flash('success', `User profile for ${first_name} ${last_name} updated successfully.`);
        }

        res.redirect('/admin/users');
    } catch (err) {
        next(err);
    }
};


exports.postResetPassword = async (req, res, next) => {
    try {
        const userId = req.params.id;
        const { new_password, confirm_password } = req.body;

        if (!new_password || new_password.length < 6) {
            if (req.flash) req.flash('error', 'Password must be at least 6 characters long.');
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        if (new_password !== confirm_password) {
            if (req.flash) req.flash('error', 'Passwords do not match.');
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        const hashedPassword = await bcrypt.hash(new_password, 10);

        await db.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [hashedPassword, userId]
        );

        const adminId = (req.session && req.session.user) ? req.session.user.id : (req.user ? req.user.id : null);

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [adminId, 'PASSWORD_RESET', `Admin reset password for User ID ${userId}`, getClientIp(req)]
        );

        if (req.flash) {
            req.flash('success', 'User password reset successfully.');
        }

        res.redirect(`/admin/users/${userId}/edit`);
    } catch (err) {
        next(err);
    }
};


exports.toggleUserStatus = async (req, res, next) => {
    try {
        const userId = req.params.id;
        const currentUserId = (req.session && req.session.user) ? req.session.user.id : (req.user ? req.user.id : null);

        if (currentUserId && parseInt(userId, 10) === parseInt(currentUserId, 10)) {
            if (req.flash) {
                req.flash('error', 'You cannot deactivate your own active account.');
            }
            return res.redirect('/admin/users');
        }

        const [users] = await db.execute('SELECT is_active, badge_number, first_name, last_name FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            if (req.flash) req.flash('error', 'User account not found.');
            return res.redirect('/admin/users');
        }

        const newStatus = users[0].is_active ? 0 : 1;
        await db.execute('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, userId]);

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [currentUserId, 'STATUS_CHANGE', `Toggled status for ${users[0].badge_number} to ${newStatus ? 'Active' : 'Inactive'}`, getClientIp(req)]
        );

        if (req.flash) {
            req.flash('success', `Account for ${users[0].first_name} ${users[0].last_name} (${users[0].badge_number}) updated to ${newStatus ? 'Active' : 'Inactive'}.`);
        }

        res.redirect('/admin/users');
    } catch (err) {
        next(err);
    }
};


exports.getAuditLogs = async (req, res, next) => {
    try {
        const search = req.query.search ? `%${req.query.search.trim()}%` : '';
        const actionFilter = req.query.action || '';
        const roleFilter = req.query.role || '';
        const dateFrom = req.query.date_from || '';
        const dateTo = req.query.date_to || '';

        let conditions = ['1=1'];
        let params = [];

        if (search) {
            conditions.push('(a.details LIKE ? OR u.badge_number LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)');
            params.push(search, search, search, search);
        }
        if (actionFilter) {
            conditions.push('a.action = ?');
            params.push(actionFilter);
        }
        if (roleFilter) {
            conditions.push('u.role = ?');
            params.push(roleFilter);
        }
        if (dateFrom) {
            conditions.push('DATE(a.created_at) >= ?');
            params.push(dateFrom);
        }
        if (dateTo) {
            conditions.push('DATE(a.created_at) <= ?');
            params.push(dateTo);
        }

        const whereClause = conditions.join(' AND ');

        const [logs] = await db.execute(`
            SELECT a.*, u.badge_number, u.rank_title, u.first_name, u.last_name, u.role
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE ${whereClause}
            ORDER BY a.created_at DESC
            LIMIT 500
        `, params);

        const [actionTypes] = await db.execute(`
            SELECT DISTINCT action FROM audit_logs ORDER BY action ASC
        `);

        const [roleTypes] = await db.execute(`
            SELECT DISTINCT role FROM users WHERE role IS NOT NULL ORDER BY role ASC
        `);

        res.render('admin/audit-logs', {
            title: 'Audit Logs | Limbe Police CMS',
            logs,
            actionTypes: actionTypes.map(r => r.action),
            roleTypes: roleTypes.map(r => r.role),
            filters: {
                search: req.query.search || '',
                action: actionFilter,
                role: roleFilter,
                date_from: dateFrom,
                date_to: dateTo
            }
        });
    } catch (err) {
        next(err);
    }
};