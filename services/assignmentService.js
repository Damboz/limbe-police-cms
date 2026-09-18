const db = require('../config/db');


async function isAssignedInvestigator(caseId, userId) {
    if (!caseId || !userId) return false;
    const [rows] = await db.execute(
        `SELECT 1 FROM case_investigators WHERE case_id = ? AND investigator_id = ? LIMIT 1`,
        [caseId, userId]
    );
    return rows.length > 0;
}


async function getAssignedInvestigators(caseId) {
    const [rows] = await db.execute(`
        SELECT u.id, u.badge_number, u.rank_title, u.first_name, u.last_name,
               ci.is_lead, ci.assigned_at
        FROM case_investigators ci
        JOIN users u ON ci.investigator_id = u.id
        WHERE ci.case_id = ?
        ORDER BY ci.is_lead DESC, ci.assigned_at ASC
    `, [caseId]);
    return rows;
}


async function syncCaseInvestigators(caseId, investigatorIds, assignedBy) {
    await db.execute('DELETE FROM case_investigators WHERE case_id = ?', [caseId]);

    const ids = [...new Set((Array.isArray(investigatorIds) ? investigatorIds : [investigatorIds]).map(v => String(v)))].filter(Boolean);

    for (let i = 0; i < ids.length; i++) {
        await db.execute(
            `INSERT INTO case_investigators (case_id, investigator_id, assigned_by, is_lead)
             VALUES (?, ?, ?, ?)`,
            [caseId, ids[i], assignedBy || null, i === 0 ? 1 : 0]
        );
    }

    return ids.length;
}

module.exports = {
    isAssignedInvestigator,
    getAssignedInvestigators,
    syncCaseInvestigators
};