


exports.isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    if (typeof req.flash === 'function') {
        req.flash('error', 'Please log in to access this page.');
    }
    return res.redirect('/auth/login');
};


exports.isAdmin = (req, res, next) => {
    if (req.session && req.session.user) {
        const role = String(req.session.user.role || '').toLowerCase();
        const roleId = req.session.user.role_id;
        if (role === 'admin' || roleId === 1) {
            return next();
        }
    }
    return res.status(403).render('errors/403', {
        title: '403 Forbidden | Limbe Police CMS',
        message: 'Access Denied. System Administrator permissions required.'
    });
};


exports.authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            if (typeof req.flash === 'function') {
                req.flash('error', 'Please log in to access this page.');
            }
            return res.redirect('/auth/login');
        }


        const userRole = req.session.user.role ? String(req.session.user.role).toUpperCase() : '';
        const normalizedAllowedRoles = allowedRoles.map(role => String(role).toUpperCase());

        if (normalizedAllowedRoles.includes(userRole)) {
            return next();
        }

        const roleIdMap = {
            1: ['ADMIN'],
            2: ['STATION COMMANDER'],
            3: ['INVESTIGATING OFFICER'],
            4: ['COUNTER/INTAKE OFFICER']
        };

        const roleId = Number(req.session.user.role_id);
        const roleIdAliases = roleIdMap[roleId] || [];
        if (roleIdAliases.some(alias => normalizedAllowedRoles.includes(alias))) {
            return next();
        }

        return res.status(403).render('errors/403', {
            title: '403 Forbidden | Limbe Police CMS',
            message: 'Access Denied. You do not have permission to view this resource.'
        });
    };
};