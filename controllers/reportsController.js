const db = require('../config/db');
const PDFDocument = require('pdfkit');
const smsService = require('../services/smsService');


function formatDisplayDate(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = String(dateStr).split('-');
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (isNaN(date.getTime())) return String(dateStr);
    return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}


function formatSmsDate(dateStr) {
    if (!dateStr) return String(dateStr);
    const [y, m, d] = String(dateStr).split('-');
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (isNaN(date.getTime())) return String(dateStr);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}


exports.generateSuspectInvitation = async (req, res, next) => {
    try {
        const { id, suspectId } = req.params;
        const { appearance_date, appearance_time, officer_notes, send_sms } = req.body;
        const user = req.session.user;
        const wantsSms = send_sms === 'on' || send_sms === 'true' || send_sms === '1';

        if (!appearance_date) {
            req.flash('error', 'Please select the date the suspect is expected to appear.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute(`
            SELECT c.*, cc.name AS crime_category
            FROM cases c
            LEFT JOIN crime_categories cc ON c.category_id = cc.id
            WHERE c.id = ?
        `, [id]);

        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }
        const caseItem = caseRows[0];

        const [linkRows] = await db.execute(
            'SELECT cs.status AS link_status FROM case_suspects cs WHERE cs.case_id = ? AND cs.suspect_id = ?',
            [id, suspectId]
        );
        if (linkRows.length === 0) {
            req.flash('error', 'The suspect is not linked to this case.');
            return res.redirect(`/cases/${id}`);
        }

        const allowed = (user.role === 'Investigating Officer' && caseItem.assigned_officer_id === user.id)
            || ['Counter/Intake Officer', 'Station Commander', 'Admin'].includes(user.role);
        if (!allowed) {
            req.flash('error', 'You do not have permission to generate a letter for this case.');
            return res.redirect(`/cases/${id}`);
        }

        const [suspectRows] = await db.execute(
            'SELECT first_name, last_name, alias, national_id, phone_number, address FROM suspects WHERE id = ?',
            [suspectId]
        );
        if (suspectRows.length === 0) {
            req.flash('error', 'Suspect record not found.');
            return res.redirect(`/cases/${id}`);
        }
        const suspect = suspectRows[0];

        const letterDate = formatDisplayDate(appearance_date) || String(appearance_date);
        const smsDate = formatSmsDate(appearance_date) || String(appearance_date);
        const letterTime = appearance_time ? `${appearance_time} hours` : '09:00 hours';
        const smsTime = appearance_time ? appearance_time : '09:00';
        const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const incidentOn = caseItem.incident_datetime
            ? new Date(caseItem.incident_datetime).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'Not recorded';
        const suspectFullName = `${suspect.first_name} ${suspect.last_name}`;

        let smsDelivery = null;
        if (wantsSms && suspect.phone_number) {
            smsDelivery = await smsService.sendInvitationSms(suspect.phone_number, {
                obNumber: caseItem.ob_number,
                suspectName: suspectFullName,
                crimeCategory: caseItem.crime_category || 'Uncategorised',
                incidentLocation: caseItem.incident_location,
                incidentDate: incidentOn,
                incidentDetails: caseItem.incident_details,
                appearanceDate: smsDate,
                appearanceTime: smsTime,
                officerNotes: officer_notes
            });
        }

        const doc = new PDFDocument({ margin: 50, size: 'A4', compress: false });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Invitation_${caseItem.ob_number}_${suspectId}.pdf"`);
        doc.pipe(res);

        const NAVY = '#0274B0';
        const DARK = '#1E293B';
        const GREY = '#64748B';

        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text('REPUBLIC OF MALAWI', { align: 'center' });
        doc.fillColor(DARK).fontSize(18).text('MALAWI POLICE SERVICE', { align: 'center' });
        doc.fontSize(13).text('LIMBE POLICE STATION', { align: 'center' });
        doc.fillColor(GREY).font('Helvetica').fontSize(9)
            .text('Limbe, Blantyre, Malawi', { align: 'center' });
        doc.moveDown(0.4);
        doc.strokeColor('#F7C631').lineWidth(2)
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .stroke();
        doc.moveDown(1);

        doc.font('Helvetica').fontSize(9).fillColor(DARK);
        doc.text(`OUR REF: ${caseItem.ob_number}`, { align: 'right' });
        doc.text(`DATE: ${today}`, { align: 'right' });
        doc.moveDown(0.8);

        doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
            .text('INVITATION TO REPORT AT LIMBE POLICE STATION', { align: 'center' });
        doc.moveDown(1);

        doc.font('Helvetica').fontSize(10).fillColor(DARK).text('TO:');
        doc.font('Helvetica-Bold').fontSize(11).text(suspectFullName + (suspect.alias ? ` ("${suspect.alias}")` : ''));
        doc.font('Helvetica').fontSize(10);
        if (suspect.national_id) doc.text(`National ID: ${suspect.national_id}`);
        if (suspect.address) doc.text(`Address: ${suspect.address}`);
        if (suspect.phone_number) doc.text(`Phone: ${suspect.phone_number}`);
        doc.moveDown(1);

        doc.font('Helvetica').fontSize(10.5).fillColor(DARK).text(
            `You are hereby invited to report and appear before the Officer-in-Charge or the Desk Officer at Limbe Police Station on ${letterDate} at ${letterTime}, in connection with the matter described below.`
        );
        doc.moveDown(0.6);

        doc.font('Helvetica-Bold').fontSize(10.5).text('MATTER / REPORT AGAINST YOU:');
        doc.fillColor(DARK).font('Helvetica').fontSize(10);
        doc.text(`Offence Reported: ${caseItem.crime_category || 'Uncategorised'} (OB Reference ${caseItem.ob_number})`);
        doc.text(`Date & Time of Incident: ${incidentOn}`);
        doc.text(`Place of Incident: ${caseItem.incident_location}`);
        doc.text(`Complainant: ${caseItem.complainant_name}`);
        doc.moveDown(0.4);
        doc.text('Details of the report:');
        doc.text(caseItem.incident_details, { indent: 12 });
        doc.moveDown(0.6);

        doc.text(
            'You are kindly requested to bring your National Identity Card, passport, or any other means of identification, together with any documents in your possession that may assist this inquiry.'
        );
        doc.moveDown(0.4);
        doc.text(
            'If for any reason you are unable to attend at the stated time, please contact the reporting officer below so that an alternative date may be arranged.'
        );
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').text(
            'Please note that failure or refusal to honour this invitation without lawful cause may result in a warrant of arrest being issued against you.'
        );
        doc.moveDown(0.4);
        if (officer_notes && String(officer_notes).trim()) {
            doc.font('Helvetica').text(`Remarks: ${String(officer_notes).trim()}`);
            doc.moveDown(0.4);
        }

        doc.moveDown(0.8);
        doc.font('Helvetica').fontSize(10).fillColor(DARK).text(`Yours faithfully,`);
        doc.moveDown(1.6);
        doc.font('Helvetica-Bold').fontSize(11)
            .text(`${user.rank_title} ${user.first_name} ${user.last_name}`, { continued: false });
        doc.font('Helvetica').fontSize(10).fillColor(DARK)
            .text(`${user.role} — Badge No. ${user.badge_number}`)
            .text('Limbe Police Station')
            .text(`Contact: Desk Officer, Limbe Police Station`);

        doc.moveDown(1);
        doc.strokeColor('#CBD5E1').lineWidth(0.5)
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .stroke();
        doc.moveDown(0.3);
        doc.fontSize(7.5).fillColor('#94A3B8').font('Helvetica')
            .text('System-generated invitation letter — Malawi Police Service, Limbe Station.', { align: 'center' })
            .text(`Reference ${caseItem.ob_number} | Restricted — Official Use Only`, { align: 'center' });

        if (smsDelivery) {
            const smsStatusText = smsDelivery.queued
                ? 'QUEUED - no SMS provider configured'
                : (smsDelivery.ok ? 'SENT' : 'FAILED');
            doc.moveDown(0.3);
            doc.fontSize(7.5).fillColor('#0F766E').font('Helvetica')
                .text(`SMS notice dispatched to ${smsDelivery.phone || suspect.phone_number}: ${smsStatusText}`, { align: 'center' });
        }

        doc.end();

        let auditAction = 'INVITATION_LETTER_GENERATED';
        let auditDetails = `Generated invitation letter for suspect "${suspectFullName}" (ID ${suspectId}) to appear on ${appearance_date} — Case ${caseItem.ob_number}.`;
        if (wantsSms) {
            auditAction = 'INVITATION_SMS_SENT';
            auditDetails = `Sent invitation SMS to suspect "${suspectFullName}" ${smsDelivery && (smsDelivery.ok || smsDelivery.queued) ? 'OK' : 'FAILED'} (${smsDelivery ? (smsDelivery.phone || suspect.phone_number) : suspect.phone_number || 'no phone on file'}) to appear on ${appearance_date} — Case ${caseItem.ob_number}.`;
        }
        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, auditAction, auditDetails, req.ip || null]
        );
    } catch (err) {
        next(err);
    }
};


exports.exportMyCasesPDF = async (req, res, next) => {
    try {
        const user = req.session.user;

        let query;
        let params;

        if (user.role === 'Investigating Officer') {
            query = `
                SELECT c.*, cc.name AS crime_category
                FROM cases c
                LEFT JOIN crime_categories cc ON c.category_id = cc.id
                WHERE c.assigned_officer_id = ?
                ORDER BY c.created_at DESC
            `;
            params = [user.id];
        } else {
            query = `
                SELECT c.*, cc.name AS crime_category
                FROM cases c
                LEFT JOIN crime_categories cc ON c.category_id = cc.id
                WHERE c.intake_officer_id = ?
                ORDER BY c.created_at DESC
            `;
            params = [user.id];
        }

        const [cases] = await db.execute(query, params);

        const activeCount = cases.filter(c => c.status === 'Under Investigation').length;
        const closedCount = cases.filter(c => c.status === 'Closed').length;
        const totalCount = cases.length;

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="My_Case_Report_${user.badge_number}_${new Date().toISOString().slice(0, 10)}.pdf"`);
        doc.pipe(res);

        doc.fillColor('#0274B0').fontSize(18).text('Limbe Police Station', { align: 'center' });
        doc.fillColor('#1E293B').fontSize(13).text('My Case Report', { align: 'center' });
        doc.fillColor('#64748B').fontSize(9)
            .text(`${user.rank_title} ${user.first_name} ${user.last_name} (${user.badge_number})`, { align: 'center' })
            .text(`Generated: ${new Date().toLocaleString('en-GB')}`, { align: 'center' });
        doc.moveDown(0.3);
        doc.strokeColor('#F7C631').lineWidth(2)
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .stroke();
        doc.moveDown(1.2);

        doc.fillColor('#0274B0').fontSize(12).font('Helvetica-Bold').text('Summary');
        doc.fillColor('#1E293B').font('Helvetica').fontSize(10);
        doc.text(`Total Cases: ${totalCount}`);
        doc.text(`Active / Under Investigation: ${activeCount}`);
        doc.text(`Closed: ${closedCount}`);
        doc.moveDown(1);

        doc.fillColor('#0274B0').fontSize(12).font('Helvetica-Bold').text('Case List');
        doc.fillColor('#1E293B').font('Helvetica').fontSize(10);
        doc.moveDown(0.3);

        if (cases.length === 0) {
            doc.text('No cases on record for this officer.');
        } else {
            cases.forEach(c => {
                doc.font('Helvetica-Bold')
                    .text(`${c.ob_number} — ${c.crime_category || 'Uncategorised'} (${c.status})`);
                doc.font('Helvetica').text(`   ${c.incident_details || ''}`);
                doc.font('Helvetica').text(`   Priority: ${c.priority} | Registered: ${c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB') : '—'}`);
                doc.moveDown(0.4);
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


exports.getMyAnalytics = async (req, res, next) => {
    try {
        const user = req.session.user;
        const isInvestigator = user.role === 'Investigating Officer';

        const whereClause = isInvestigator
            ? 'WHERE c.assigned_officer_id = ?'
            : 'WHERE c.intake_officer_id = ?';
        const params = [user.id];

        const [monthlyTrends] = await db.execute(`
            SELECT 
                DATE_FORMAT(c.created_at, '%b %Y') AS month_label,
                COUNT(*) AS total_cases,
                SUM(CASE WHEN c.priority IN ('High', 'Critical') THEN 1 ELSE 0 END) AS severe_cases
            FROM cases c
            ${whereClause}
            GROUP BY DATE_FORMAT(c.created_at, '%Y-%m'), month_label
            ORDER BY DATE_FORMAT(c.created_at, '%Y-%m') ASC
            LIMIT 12
        `, params);

        const [statusDistribution] = await db.execute(`
            SELECT status, COUNT(*) AS total_count
            FROM cases c
            ${whereClause}
            GROUP BY status
        `, params);

        const [categoryBreakdown] = await db.execute(`
            SELECT 
                cc.name AS crime_category,
                COUNT(c.id) AS total_incidents
            FROM crime_categories cc
            LEFT JOIN cases c ON cc.id = c.category_id
            ${whereClause}
            GROUP BY cc.id, cc.name
            ORDER BY total_incidents DESC
        `, params);

        const [hotspots] = await db.execute(`
            SELECT incident_location AS location, COUNT(*) AS incident_count
            FROM cases c
            ${whereClause}
            ${whereClause ? 'AND' : 'WHERE'} incident_location IS NOT NULL AND TRIM(incident_location) != ''
            GROUP BY incident_location
            ORDER BY incident_count DESC
            LIMIT 8
        `, params);

        const [pendingRequests] = await db.execute(`
            SELECT COUNT(*) AS pendingCount
            FROM cases c
            ${whereClause}
            ${whereClause ? 'AND' : 'WHERE'} requested_status IS NOT NULL
        `, params);

        const totalCases = statusDistribution.reduce((acc, s) => acc + s.total_count, 0);
        const closedCases = statusDistribution.find(s => s.status === 'Closed')?.total_count || 0;
        const resolutionRate = totalCases > 0 ? Number(((closedCases / totalCases) * 100).toFixed(1)) : 0;

        res.render('general/my-analytics', {
            title: 'My Case Analytics | Limbe Police CMS',
            role: user.role,
            metrics: {
                totalCases,
                closedCases,
                resolutionRate,
                pendingRequests: pendingRequests[0]?.pendingCount || 0
            },
            statusDistribution,
            monthlyTrends,
            categoryBreakdown,
            hotspots,
            isInvestigator
        });
    } catch (err) {
        next(err);
    }
};