


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
    if (req.session && req.session.user && req.session.user.role === 'Admin') {
        return next();
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

        return res.status(403).render('errors/403', {
            title: '403 Forbidden | Limbe Police CMS',
            message: 'Access Denied. You do not have permission to view this resource.'
        });
    };
};