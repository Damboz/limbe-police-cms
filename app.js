

const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const session = require('express-session');
const flash = require('connect-flash');


dotenv.config();


const app = express();
const PORT = process.env.PORT || 3000;


let dbPool;
try {
    dbPool = require('./config/db');
} catch (e) {
    const mysql = require('mysql2/promise');
    dbPool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
        database: process.env.DB_NAME || 'limbe_police_cms',
        port: process.env.DB_PORT || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
}


const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const supervisorRoutes = require('./routes/supervisorRoutes');
const caseRoutes = require('./routes/caseRoutes');
const evidenceRoutes = require('./routes/evidenceRoutes');
const reportsController = require('./controllers/reportsController');
const generalController = require('./controllers/generalController');
const { isAuthenticated, authorizeRoles } = require('./middleware/authMiddleware');




app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use(session({
    secret: process.env.SESSION_SECRET || 'limbe_police_cms_secure_session_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 8,
        httpOnly: true
    }
}));


app.use(flash());


app.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.currentUser = req.session ? req.session.user : null;
    res.locals.error = req.flash('error');
    res.locals.success = req.flash('success');
    res.locals.currentPath = req.path;
    next();
});


app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    res.redirect('/auth/login');
});


app.use('/auth', authRoutes);


app.get('/dashboard', isAuthenticated, (req, res, next) => {
    const role = (req.session.user.role || '').toLowerCase();
    const roleId = req.session.user.role_id;

    if (role === 'admin' || roleId === 1) {
        return res.redirect('/admin/dashboard');
    }
    if (role === 'station commander' || role === 'supervisor' || roleId === 2) {
        return res.redirect('/supervisor/dashboard');
    }

    


    return generalController.getDashboard(req, res, next);
});


app.use('/admin', adminRoutes);
app.use('/supervisor', supervisorRoutes);
app.use('/cases', caseRoutes);
app.use('/evidence', evidenceRoutes);

app.get('/reports/my-cases',
    isAuthenticated,
    authorizeRoles('Investigating Officer', 'Station Commander', 'Admin'),
    reportsController.exportMyCasesPDF
);
app.get('/reports/analytics',
    isAuthenticated,
    authorizeRoles('Investigating Officer', 'Counter/Intake Officer'),
    reportsController.getMyAnalytics
);


app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'UP', system: 'Limbe Police Station CMS' });
});




app.use((req, res) => {
    res.status(404).send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2>404 - Resource Not Found</h2>
            <p>The requested path <code>${req.originalUrl}</code> does not exist on this server.</p>
            <a href="/dashboard" style="color: #004085; text-decoration: none; font-weight: bold;">Return to Dashboard</a>
        </div>
    `);
});


app.use((err, req, res, next) => {
    console.error('Unhandled System Error:', err);
    res.status(500).send('An unexpected system error occurred.');
});


app.listen(PORT, () => {
    console.log(`Limbe Police Station Web Portal Live: http://localhost:${PORT}`);
});

module.exports = app;